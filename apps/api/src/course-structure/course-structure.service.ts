import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RagService, ChunkWithScore } from '../rag/rag.service';
import { LlmService } from '../rag/llm.service';

// ─── Interfaces ─────────────────────────────────────────

export interface GenerateStructureInput {
  courseId: string;
  userId: string;
  mode: 'curriculum_based' | 'level_based';
  desired_topics: number;
  subtopics_per_topic: number;
  lessons_per_subtopic: number;
  strict_sources: boolean;
  admin_prompt?: string;
}

export interface OutlineTopic {
  title: string;
  rationale: string;
  sourceEvidence: Array<{ sourceId: string; pageStart: number; pageEnd: number }>;
  subtopics: Array<{
    title: string;
    lessonModules: Array<{
      title: string;
      learningOutcomes: string[];
      estimatedMinutes: number;
    }>;
  }>;
}

export interface OutlineDraft {
  status: 'OK' | 'NOT_ENOUGH_INFO';
  courseStructure: {
    courseTitle: string;
    mode: 'curriculum_based' | 'level_based';
    topics: OutlineTopic[];
  };
  coverage: {
    sourcesUsed: Array<{ sourceId: string; pages: string; whyUsed: string }>;
    gaps: string[];
  };
  _notes: string;
}

@Injectable()
export class CourseStructureService {
  private readonly logger = new Logger(CourseStructureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragService: RagService,
    private readonly llmService: LlmService,
  ) {}

  // ─── Generate Structure ───────────────────────────────

  async generateStructure(input: GenerateStructureInput): Promise<{
    jobId: string;
    outlineDraft: OutlineDraft;
  }> {
    const startTime = Date.now();

    // 1. Verify course exists and user is the teacher
    const course = await this.prisma.course.findUnique({
      where: { id: input.courseId },
      select: { id: true, title: true, description: true, teacherId: true },
    });
    if (!course) throw new NotFoundException(`Course ${input.courseId} not found`);
    if (course.teacherId !== input.userId) {
      throw new ForbiddenException('Only the course teacher can generate structure');
    }

    // 2. Create job record
    const job = await this.prisma.llmGenerationJob.create({
      data: {
        courseId: input.courseId,
        userId: input.userId,
        jobType: 'course_structure',
        status: 'RUNNING',
        startedAt: new Date(),
        inputPayload: {
          mode: input.mode,
          desired_topics: input.desired_topics,
          subtopics_per_topic: input.subtopics_per_topic,
          lessons_per_subtopic: input.lessons_per_subtopic,
          strict_sources: input.strict_sources,
          admin_prompt: input.admin_prompt || null,
        },
      },
    });

    try {
      // 3. Retrieve RAG chunks (course-scoped)
      const retrievalQuery = this.buildRetrievalQuery(course, input);
      const chunks = await this.ragService.queryChunks(
        input.courseId,
        retrievalQuery,
        20, // get more chunks for structure generation
      );

      this.logger.log(
        `Retrieved ${chunks.length} chunks for structure generation (course: ${course.title})`,
      );

      // 4. Check strict mode feasibility
      if (input.strict_sources && chunks.length === 0) {
        const notEnoughDraft = this.buildNotEnoughInfoDraft(course.title, input.mode);

        await this.prisma.llmGenerationJob.update({
          where: { id: job.id },
          data: {
            status: 'COMPLETED',
            outputPayload: notEnoughDraft as any,
            completedAt: new Date(),
            durationMs: Date.now() - startTime,
          },
        });

        return { jobId: job.id, outlineDraft: notEnoughDraft };
      }

      // 5. Build prompt and call LLM
      const { systemPrompt, userPrompt } = this.buildPrompts(course, input, chunks);

      const credentials = await this.getLlmCredentials(input.userId);
      const llmResult = await this.callLlm(systemPrompt, userPrompt, credentials);

      // 6. Parse the LLM output
      const outlineDraft = this.parseLlmOutput(llmResult.content, course.title, input);

      // 7. Store results
      const durationMs = Date.now() - startTime;
      await this.prisma.llmGenerationJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          outputPayload: outlineDraft as any,
          retrievedChunkIds: chunks.map((c) => c.id),
          model: credentials?.model || 'template',
          promptTokens: llmResult.promptTokens,
          completionTokens: llmResult.completionTokens,
          durationMs,
          completedAt: new Date(),
        },
      });

      // 8. Audit log
      await this.createAuditLog({
        courseId: input.courseId,
        userId: input.userId,
        action: 'generate_course_structure',
        model: credentials?.model || 'template',
        promptTokens: llmResult.promptTokens,
        completionTokens: llmResult.completionTokens,
        durationMs,
        inputPayload: {
          mode: input.mode,
          desired_topics: input.desired_topics,
          strict_sources: input.strict_sources,
          admin_prompt: input.admin_prompt,
          chunkCount: chunks.length,
        },
        outputPayload: {
          jobId: job.id,
          status: outlineDraft.status,
          topicCount: outlineDraft.courseStructure.topics.length,
        },
      });

      return { jobId: job.id, outlineDraft };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      await this.prisma.llmGenerationJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          errorMessage: err.message || 'Unknown error',
          durationMs,
          completedAt: new Date(),
        },
      });
      this.logger.error(`Structure generation failed for job ${job.id}`, err.stack);
      throw err;
    }
  }

  // ─── Apply Structure ──────────────────────────────────

  async applyStructure(
    courseId: string,
    userId: string,
    jobId: string,
    editedStructure: OutlineDraft,
  ) {
    // Verify course ownership
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, teacherId: true },
    });
    if (!course) throw new NotFoundException(`Course ${courseId} not found`);
    if (course.teacherId !== userId) {
      throw new ForbiddenException('Only the course teacher can apply structure');
    }

    // Verify job exists
    const job = await this.prisma.llmGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);
    if (job.courseId !== courseId) {
      throw new BadRequestException('Job does not belong to this course');
    }

    const structure = editedStructure.courseStructure;

    // Create all records in a transaction
    const result = await this.prisma.$transaction(async (tx: any) => {
      const createdTopics: Array<{
        id: string;
        title: string;
        subtopics: Array<{
          id: string;
          title: string;
          lessons: Array<{ id: string; title: string }>;
        }>;
      }> = [];

      for (let ti = 0; ti < structure.topics.length; ti++) {
        const topicData = structure.topics[ti]!;

        // Create Topic
        const topic = await tx.topic.create({
          data: {
            courseId,
            title: topicData.title,
            description: topicData.rationale || '',
            orderIndex: ti,
            generationJobId: jobId,
          },
        });

        const createdSubtopics: Array<{
          id: string;
          title: string;
          lessons: Array<{ id: string; title: string }>;
        }> = [];

        for (let si = 0; si < topicData.subtopics.length; si++) {
          const subtopicData = topicData.subtopics[si]!;

          // Create CourseModule as subtopic (linked to topic)
          const mod = await tx.courseModule.create({
            data: {
              courseId,
              topicId: topic.id,
              title: subtopicData.title,
              orderIndex: si,
              generationJobId: jobId,
            },
          });

          const createdLessons: Array<{ id: string; title: string }> = [];

          for (let li = 0; li < subtopicData.lessonModules.length; li++) {
            const lessonData = subtopicData.lessonModules[li]!;

            // Create ModuleItem as lesson module
            const item = await tx.moduleItem.create({
              data: {
                moduleId: mod.id,
                type: 'PAGE',
                title: lessonData.title,
                orderIndex: li,
                learningOutcomes: lessonData.learningOutcomes,
                estimatedMinutes: lessonData.estimatedMinutes,
                generationJobId: jobId,
              },
            });

            createdLessons.push({ id: item.id, title: item.title });
          }

          createdSubtopics.push({
            id: mod.id,
            title: mod.title,
            lessons: createdLessons,
          });
        }

        createdTopics.push({
          id: topic.id,
          title: topic.title,
          subtopics: createdSubtopics,
        });
      }

      return createdTopics;
    });

    // Audit log for apply action
    await this.createAuditLog({
      courseId,
      userId,
      action: 'apply_course_structure',
      model: 'n/a',
      promptTokens: 0,
      completionTokens: 0,
      durationMs: 0,
      inputPayload: {
        jobId,
        topicCount: structure.topics.length,
      },
      outputPayload: {
        createdTopics: result.length,
        createdSubtopics: result.reduce((sum: number, t: any) => sum + t.subtopics.length, 0),
        createdLessons: result.reduce(
          (sum: number, t: any) =>
            sum + t.subtopics.reduce((s2: number, st: any) => s2 + st.lessons.length, 0),
          0,
        ),
      },
    });

    this.logger.log(
      `Applied structure for course ${courseId}: ${result.length} topics created`,
    );

    return { applied: true, topics: result };
  }

  // ─── Job Retrieval ────────────────────────────────────

  async getJob(jobId: string) {
    const job = await this.prisma.llmGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);
    return job;
  }

  async listJobs(courseId: string) {
    return this.prisma.llmGenerationJob.findMany({
      where: { courseId, jobType: 'course_structure' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        status: true,
        jobType: true,
        model: true,
        durationMs: true,
        errorMessage: true,
        createdAt: true,
        completedAt: true,
      },
    });
  }

  // ─── Private: Prompt Building ─────────────────────────

  private buildRetrievalQuery(
    course: { title: string; description: string },
    input: GenerateStructureInput,
  ): string {
    const parts = [
      `Course: ${course.title}`,
      `Description: ${course.description}`,
    ];
    if (input.mode === 'level_based') {
      parts.push('Generate structure from beginner to advanced level');
    } else {
      parts.push('Extract curriculum structure, topics, and syllabus');
    }
    if (input.admin_prompt) {
      parts.push(`Focus: ${input.admin_prompt}`);
    }
    return parts.join('. ');
  }

  private buildPrompts(
    course: { title: string; description: string },
    input: GenerateStructureInput,
    chunks: ChunkWithScore[],
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = this.buildSystemPrompt(input);
    const contextBlock = this.buildContextBlock(chunks);
    const userPrompt = this.buildUserPrompt(course, input, contextBlock);
    return { systemPrompt, userPrompt };
  }

  private buildSystemPrompt(input: GenerateStructureInput): string {
    let prompt = `You are an expert curriculum designer. Your task is to generate a structured course outline as valid JSON.

IMPORTANT RULES:
- Output ONLY valid JSON. No markdown fences, no explanation text outside JSON.
- The output must match the exact schema specified.
- Every topic must have a rationale explaining why it is included.
- Subtopics break each topic into teachable units.
- Each lesson module should have clear learning outcomes and realistic time estimates.`;

    if (input.mode === 'curriculum_based') {
      prompt += `

CURRICULUM-BASED MODE:
- Prioritize alignment with the curriculum structure found in the provided sources.
- Each topic must cite source evidence (document ID + page ranges).
- Do NOT add topics that are not supported by the source materials unless absolutely necessary for coherence.`;
    } else {
      prompt += `

LEVEL-BASED MODE:
- Build a logical progression from beginner to advanced concepts.
- Use the provided source materials when possible for content grounding.
- You may add topics beyond the sources to create a complete learning path.`;
    }

    if (input.strict_sources) {
      prompt += `

STRICT SOURCE MODE:
- Every topic MUST have at least one sourceEvidence entry.
- If the sources do not contain enough information to build a coherent outline, return status="NOT_ENOUGH_INFO" with coverage.gaps listing what is missing.
- NEVER hallucinate or invent topics not supported by sources.`;
    }

    prompt += `

OUTPUT SCHEMA (JSON only):
{
  "status": "OK" | "NOT_ENOUGH_INFO",
  "courseStructure": {
    "courseTitle": string,
    "mode": "${input.mode}",
    "topics": [
      {
        "title": string,
        "rationale": string,
        "sourceEvidence": [{ "sourceId": string, "pageStart": number, "pageEnd": number }],
        "subtopics": [
          {
            "title": string,
            "lessonModules": [
              { "title": string, "learningOutcomes": [string], "estimatedMinutes": number }
            ]
          }
        ]
      }
    ]
  },
  "coverage": {
    "sourcesUsed": [{ "sourceId": string, "pages": string, "whyUsed": string }],
    "gaps": [string]
  },
  "_notes": string
}`;

    return prompt;
  }

  private buildContextBlock(chunks: ChunkWithScore[]): string {
    if (chunks.length === 0) return 'No source documents available.';
    return chunks
      .map(
        (chunk, i) =>
          `[Source ${i + 1}] Document: "${chunk.documentTitle}" (ID: ${chunk.documentId}), Page: ${chunk.pageNumber ?? 'N/A'}\n${chunk.content}`,
      )
      .join('\n\n---\n\n');
  }

  private buildUserPrompt(
    course: { title: string; description: string },
    input: GenerateStructureInput,
    contextBlock: string,
  ): string {
    return `COURSE INFORMATION:
- Title: ${course.title}
- Description: ${course.description}
- Mode: ${input.mode}
- Target: ${input.desired_topics} topics, ${input.subtopics_per_topic} subtopics per topic, ${input.lessons_per_subtopic} lessons per subtopic
${input.admin_prompt ? `- Admin instructions: ${input.admin_prompt}` : ''}

SOURCE MATERIALS:
${contextBlock}

Generate the course structure now. Output JSON only.`;
  }

  // ─── Private: LLM Interaction ─────────────────────────

  private async getLlmCredentials(
    userId: string,
  ): Promise<{ apiKey: string; model: string } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { llmProvider: true, llmModel: true, encryptedApiKey: true },
    });
    if (!user?.encryptedApiKey) return null;
    try {
      const apiKey = this.decryptApiKey(user.encryptedApiKey);
      return { apiKey, model: user.llmModel || 'gpt-4o-mini' };
    } catch {
      return null;
    }
  }

  private decryptApiKey(encrypted: string): string {
    // Reuse the same encryption approach from LlmService
    const crypto = require('crypto');
    const secret =
      process.env.JWT_SECRET || 'dev-secret-change-in-production';
    const key = crypto.scryptSync(secret, 'llm-key-salt', 32);
    const parts = encrypted.split(':');
    const iv = Buffer.from(parts[0]!, 'hex');
    const authTag = Buffer.from(parts[1]!, 'hex');
    const encryptedBuf = Buffer.from(parts[2]!, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encryptedBuf) + decipher.final('utf8');
  }

  private async callLlm(
    systemPrompt: string,
    userPrompt: string,
    credentials: { apiKey: string; model: string } | null,
  ): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
    if (credentials) {
      return this.callOpenAiApi(systemPrompt, userPrompt, credentials.apiKey, credentials.model);
    }
    return this.generateTemplateStructure(userPrompt);
  }

  private async callOpenAiApi(
    systemPrompt: string,
    userPrompt: string,
    apiKey: string,
    model: string,
  ): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 8192,
          temperature: 0.3,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`OpenAI API error: ${response.status} ${errorText}`);
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      return {
        content: data.choices?.[0]?.message?.content || '',
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
      };
    } catch (error: any) {
      this.logger.error('OpenAI API call failed, using template fallback', error.message);
      return this.generateTemplateStructure(userPrompt);
    }
  }

  // ─── Private: Template Fallback ───────────────────────

  private async generateTemplateStructure(
    userPrompt: string,
  ): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
    // Extract parameters from the user prompt
    const titleMatch = userPrompt.match(/Title:\s*(.+)/);
    const topicCountMatch = userPrompt.match(/(\d+)\s*topics/);
    const subtopicCountMatch = userPrompt.match(/(\d+)\s*subtopics/);
    const lessonCountMatch = userPrompt.match(/(\d+)\s*lessons/);
    const modeMatch = userPrompt.match(/Mode:\s*(\w+)/);

    const courseTitle = titleMatch?.[1]?.trim() || 'Course';
    const topicCount = parseInt(topicCountMatch?.[1] || '5', 10);
    const subtopicCount = parseInt(subtopicCountMatch?.[1] || '3', 10);
    const lessonCount = parseInt(lessonCountMatch?.[1] || '2', 10);
    const mode = modeMatch?.[1] || 'curriculum_based';

    // Extract source info from the prompt
    const sourcePattern = /\[Source \d+\] Document: "([^"]+)" \(ID: ([^)]+)\)/g;
    const sources: Array<{ title: string; id: string }> = [];
    let match;
    while ((match = sourcePattern.exec(userPrompt)) !== null) {
      sources.push({ title: match[1]!, id: match[2]! });
    }

    // Build a template structure based on available sources
    const topics: any[] = [];
    for (let t = 0; t < topicCount; t++) {
      const subtopics: any[] = [];
      for (let s = 0; s < subtopicCount; s++) {
        const lessons: any[] = [];
        for (let l = 0; l < lessonCount; l++) {
          lessons.push({
            title: `Lesson ${t + 1}.${s + 1}.${l + 1}`,
            learningOutcomes: [
              `Understand key concepts of topic ${t + 1}, subtopic ${s + 1}`,
              `Apply learned principles in practice exercises`,
            ],
            estimatedMinutes: 30,
          });
        }
        subtopics.push({
          title: `Subtopic ${t + 1}.${s + 1}`,
          lessonModules: lessons,
        });
      }

      const sourceEvidence =
        sources.length > 0
          ? [{ sourceId: sources[t % sources.length]!.id, pageStart: 1, pageEnd: 5 }]
          : [];

      topics.push({
        title: `Topic ${t + 1}: ${courseTitle} Part ${t + 1}`,
        rationale: `Core area ${t + 1} of the course curriculum.`,
        sourceEvidence,
        subtopics,
      });
    }

    const draft: OutlineDraft = {
      status: sources.length > 0 || mode !== 'curriculum_based' ? 'OK' : 'NOT_ENOUGH_INFO',
      courseStructure: {
        courseTitle,
        mode: mode as 'curriculum_based' | 'level_based',
        topics,
      },
      coverage: {
        sourcesUsed: sources.map((s) => ({
          sourceId: s.id,
          pages: '1-5',
          whyUsed: `Content from "${s.title}" used for topic structure`,
        })),
        gaps:
          sources.length === 0
            ? ['No source documents uploaded. Upload curriculum files for better results.']
            : [],
      },
      _notes:
        'This is a template-generated structure. Configure an LLM API key in AI Settings for AI-powered generation.',
    };

    const content = JSON.stringify(draft);
    return {
      content,
      promptTokens: Math.ceil(userPrompt.length / 4),
      completionTokens: Math.ceil(content.length / 4),
    };
  }

  // ─── Private: Parse LLM Output ────────────────────────

  private parseLlmOutput(
    raw: string,
    courseTitle: string,
    input: GenerateStructureInput,
  ): OutlineDraft {
    // Try to extract JSON from the response
    let jsonStr = raw.trim();

    // Strip markdown code fences if present
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1]!.trim();
    }

    try {
      const parsed = JSON.parse(jsonStr);
      // Validate minimal shape
      if (!parsed.courseStructure?.topics || !Array.isArray(parsed.courseStructure.topics)) {
        throw new Error('Missing courseStructure.topics array');
      }
      return {
        status: parsed.status || 'OK',
        courseStructure: {
          courseTitle: parsed.courseStructure.courseTitle || courseTitle,
          mode: parsed.courseStructure.mode || input.mode,
          topics: parsed.courseStructure.topics.map((t: any, ti: number) => ({
            title: t.title || `Topic ${ti + 1}`,
            rationale: t.rationale || '',
            sourceEvidence: Array.isArray(t.sourceEvidence) ? t.sourceEvidence : [],
            subtopics: Array.isArray(t.subtopics)
              ? t.subtopics.map((st: any, si: number) => ({
                  title: st.title || `Subtopic ${ti + 1}.${si + 1}`,
                  lessonModules: Array.isArray(st.lessonModules)
                    ? st.lessonModules.map((lm: any, li: number) => ({
                        title: lm.title || `Lesson ${li + 1}`,
                        learningOutcomes: Array.isArray(lm.learningOutcomes)
                          ? lm.learningOutcomes
                          : [],
                        estimatedMinutes:
                          typeof lm.estimatedMinutes === 'number' ? lm.estimatedMinutes : 30,
                      }))
                    : [],
                }))
              : [],
          })),
        },
        coverage: {
          sourcesUsed: Array.isArray(parsed.coverage?.sourcesUsed)
            ? parsed.coverage.sourcesUsed
            : [],
          gaps: Array.isArray(parsed.coverage?.gaps) ? parsed.coverage.gaps : [],
        },
        _notes: parsed._notes || '',
      };
    } catch (err: any) {
      this.logger.error(`Failed to parse LLM JSON output: ${err.message}`);
      this.logger.debug(`Raw LLM output: ${raw.slice(0, 500)}`);
      throw new BadRequestException(
        `LLM output was not valid JSON. Please try again. Parse error: ${err.message}`,
      );
    }
  }

  private buildNotEnoughInfoDraft(
    courseTitle: string,
    mode: 'curriculum_based' | 'level_based',
  ): OutlineDraft {
    return {
      status: 'NOT_ENOUGH_INFO',
      courseStructure: {
        courseTitle,
        mode,
        topics: [],
      },
      coverage: {
        sourcesUsed: [],
        gaps: [
          'No source documents have been uploaded or indexed for this course.',
          'Please upload curriculum files in the Sources tab, then try again.',
        ],
      },
      _notes: 'Strict source mode is enabled but no sources are available.',
    };
  }

  // ─── Private: Audit ───────────────────────────────────

  private async createAuditLog(data: {
    courseId: string;
    userId: string;
    action: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    durationMs: number;
    inputPayload?: any;
    outputPayload?: any;
    errorMessage?: string;
  }) {
    try {
      await this.prisma.llmAuditLog.create({ data });
    } catch (err) {
      this.logger.error('Failed to create audit log', err);
    }
  }
}
