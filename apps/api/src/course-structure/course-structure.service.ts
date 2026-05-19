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
import {
  buildStructureSystemPrompt,
  buildStructureUserPrompt,
  buildRetrievalQuery,
  StructurePromptInput,
} from './prompts';

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
  selectedSourceIds: string[];
  retrieval_mode: 'selected_only' | 'selected_then_course';
}

export interface OutlineTopic {
  title: string;
  rationale: string;
  sourceEvidence: Array<{
    sourceId: string;
    pageStart: number;
    pageEnd: number;
    chunkIds?: string[];
  }>;
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
    sourcesSelected: Array<{ sourceId: string; name: string }>;
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

    // 2. Resolve selected source names for prompts and audit
    const selectedSources = await this.resolveSourceNames(input.courseId, input.selectedSourceIds);

    // 3. Create job record
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
          selectedSourceIds: input.selectedSourceIds,
          retrieval_mode: input.retrieval_mode,
        },
      },
    });

    try {
      // 4. Retrieve RAG chunks using source-filtered retrieval
      const retrievalQuery = buildRetrievalQuery(
        course.title,
        course.description,
        input.mode,
        input.admin_prompt,
      );

      let chunks: ChunkWithScore[];
      if (input.retrieval_mode === 'selected_only' && input.selectedSourceIds.length > 0) {
        chunks = await this.ragService.queryChunksFiltered(
          input.courseId,
          retrievalQuery,
          input.selectedSourceIds,
          30,
        );
      } else if (
        input.retrieval_mode === 'selected_then_course' &&
        input.selectedSourceIds.length > 0
      ) {
        // First try selected sources, then fall back to all course sources if not enough
        chunks = await this.ragService.queryChunksFiltered(
          input.courseId,
          retrievalQuery,
          input.selectedSourceIds,
          30,
        );
        if (chunks.length < 5) {
          const allChunks = await this.ragService.queryChunks(input.courseId, retrievalQuery, 30);
          // Merge: selected chunks first, then additional course chunks
          const selectedIds = new Set(chunks.map((c) => c.id));
          const additional = allChunks.filter((c) => !selectedIds.has(c.id));
          chunks = [...chunks, ...additional].slice(0, 30);
        }
      } else {
        // No sources selected — get all course chunks
        chunks = await this.ragService.queryChunks(input.courseId, retrievalQuery, 30);
      }

      this.logger.log(
        `Retrieved ${chunks.length} chunks for structure generation (course: ${course.title})`,
      );

      // 5. Check strict mode feasibility
      if (input.strict_sources && chunks.length === 0) {
        const notEnoughDraft = this.buildNotEnoughInfoDraft(
          course.title,
          input.mode,
          selectedSources,
        );

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

      // 6. Check LLM credentials — require an API key (no fake generation)
      const credentials = await this.getLlmCredentials(input.userId);
      if (!credentials) {
        throw new BadRequestException(
          'No LLM API key configured. Please add your OpenAI API key in AI Settings before generating a course structure.',
        );
      }

      // 7. Build prompts from templates
      const promptInput: StructurePromptInput = {
        courseTitle: course.title,
        courseDescription: course.description,
        mode: input.mode,
        desiredTopics: input.desired_topics,
        subtopicsPerTopic: input.subtopics_per_topic,
        lessonsPerSubtopic: input.lessons_per_subtopic,
        strictSources: input.strict_sources,
        adminPrompt: input.admin_prompt,
        chunks,
        selectedSourceNames: selectedSources,
      };

      const systemPrompt = buildStructureSystemPrompt(promptInput);
      const userPrompt = buildStructureUserPrompt(promptInput);

      // 8. Call LLM
      const llmResult = await this.callOpenAiApi(
        systemPrompt,
        userPrompt,
        credentials.apiKey,
        credentials.model,
      );

      // 9. Parse the LLM output
      const outlineDraft = this.parseLlmOutput(
        llmResult.content,
        course.title,
        input,
        selectedSources,
      );

      // 10. Store results
      const durationMs = Date.now() - startTime;
      await this.prisma.llmGenerationJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          outputPayload: outlineDraft as any,
          retrievedChunkIds: chunks.map((c) => c.id),
          model: credentials.model,
          promptTokens: llmResult.promptTokens,
          completionTokens: llmResult.completionTokens,
          durationMs,
          completedAt: new Date(),
        },
      });

      // 11. Audit log
      await this.createAuditLog({
        courseId: input.courseId,
        userId: input.userId,
        action: 'generate_course_structure',
        model: credentials.model,
        promptTokens: llmResult.promptTokens,
        completionTokens: llmResult.completionTokens,
        durationMs,
        inputPayload: {
          mode: input.mode,
          desired_topics: input.desired_topics,
          strict_sources: input.strict_sources,
          admin_prompt: input.admin_prompt,
          selectedSourceIds: input.selectedSourceIds,
          retrieval_mode: input.retrieval_mode,
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

    this.logger.log(`Applied structure for course ${courseId}: ${result.length} topics created`);

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

  // ─── Private: Source Resolution ─────────────────────────

  private async resolveSourceNames(
    courseId: string,
    selectedSourceIds: string[],
  ): Promise<Array<{ sourceId: string; name: string }>> {
    if (selectedSourceIds.length === 0) return [];

    const docs = await this.prisma.sourceDocument.findMany({
      where: {
        courseId,
        id: { in: selectedSourceIds },
      },
      select: { id: true, title: true, filename: true },
    });

    return docs.map((d) => ({
      sourceId: d.id,
      name: d.title || d.filename,
    }));
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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require('crypto');
    const secret = process.env.JWT_SECRET || 'dev-secret-change-in-production';
    const key = crypto.scryptSync(secret, 'llm-key-salt', 32);
    const parts = encrypted.split(':');
    const iv = Buffer.from(parts[0]!, 'hex');
    const authTag = Buffer.from(parts[1]!, 'hex');
    const encryptedBuf = Buffer.from(parts[2]!, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encryptedBuf) + decipher.final('utf8');
  }

  private async callOpenAiApi(
    systemPrompt: string,
    userPrompt: string,
    apiKey: string,
    model: string,
  ): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
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
      throw new BadRequestException(
        `LLM API error (${response.status}). Check your API key and try again.`,
      );
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
  }

  // ─── Private: Parse LLM Output ────────────────────────

  private parseLlmOutput(
    raw: string,
    courseTitle: string,
    input: GenerateStructureInput,
    selectedSources: Array<{ sourceId: string; name: string }>,
  ): OutlineDraft {
    let jsonStr = raw.trim();

    // Strip markdown code fences if present
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1]!.trim();
    }

    try {
      const parsed = JSON.parse(jsonStr);
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
          sourcesSelected:
            parsed.coverage?.sourcesSelected ||
            selectedSources.map((s) => ({
              sourceId: s.sourceId,
              name: s.name,
            })),
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
    selectedSources: Array<{ sourceId: string; name: string }>,
  ): OutlineDraft {
    return {
      status: 'NOT_ENOUGH_INFO',
      courseStructure: {
        courseTitle,
        mode,
        topics: [],
      },
      coverage: {
        sourcesSelected: selectedSources,
        sourcesUsed: [],
        gaps: [
          'No source documents have been uploaded or indexed for this course.',
          'Please upload curriculum files in the Sources tab, then try again.',
        ],
      },
      _notes:
        'Strict source mode is enabled but no indexed content was found in the selected sources.',
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
