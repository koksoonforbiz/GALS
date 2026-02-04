import * as crypto from 'crypto';
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { RagService, ChunkWithScore } from '../rag/rag.service';

/* ------------------------------------------------------------------ */
/*  Interfaces                                                         */
/* ------------------------------------------------------------------ */

export interface GenerateQuestionsInput {
  courseId: string;
  userId: string;
  types: ('MCQ_SINGLE' | 'MCQ_MULTI' | 'STRUCTURED')[];
  quantity: number;
  difficultyDistribution: { easy: number; medium: number; hard: number };
  bloomsDistribution?: Record<string, number>;
  kcFocus?: string[];
  sourceMode: 'lesson_based' | 'question_material' | 'mixed';
  selectedPageIds?: string[];
  selectedSourceIds?: string[];
  strictSource: boolean;
  customPrompt?: string;
}

export interface GeneratedQuestion {
  type: 'MCQ_SINGLE' | 'MCQ_MULTI' | 'STRUCTURED';
  stem: string;
  options?: { id: string; text: string; isCorrect: boolean }[];
  structuredAnswer?: { expectedAnswer: string; rubric: string[] };
  explanation: string;
  tags: {
    difficulty: 'easy' | 'medium' | 'hard';
    bloomsLevel: string;
    kcNames: string[];
    curriculumOutcomeRefs?: string[];
  };
  provenance: {
    sourceMode: string;
    sourceIds: string[];
    chunkIds: string[];
    citations?: { sourceId: string; pageStart: number; pageEnd: number }[];
  };
}

interface ResolvedKc {
  id: string | null;
  name: string;
  isExisting: boolean;
}

interface LessonChunk {
  title: string;
  content: string;
}

/* ------------------------------------------------------------------ */
/*  Service                                                            */
/* ------------------------------------------------------------------ */

@Injectable()
export class QuestionGenerationService {
  private readonly logger = new Logger(QuestionGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragService: RagService,
  ) {}

  /* ================================================================ */
  /*  MAIN: generateQuestions                                          */
  /* ================================================================ */

  async generateQuestions(input: GenerateQuestionsInput): Promise<GeneratedQuestion[]> {
    const startTime = Date.now();

    // 1. Get user LLM credentials
    const credentials = await this.getLlmCredentials(input.userId);
    if (!credentials) {
      throw new BadRequestException(
        'No LLM API key configured. Please add your API key in settings.',
      );
    }

    // 2. Retrieve RAG chunks based on sourceMode
    const { lessonChunks, materialChunks } = await this.retrieveSourceChunks(input);

    // 3. Resolve KC focus names if IDs are provided
    let kcFocusNames: string[] = [];
    if (input.kcFocus && input.kcFocus.length > 0) {
      const kcs = await this.prisma.knowledgeComponent.findMany({
        where: { id: { in: input.kcFocus } },
        select: { label: true },
      });
      kcFocusNames = kcs.map((kc: { label: string }) => kc.label);
    }

    // 4. Build prompts
    const systemPrompt = this.buildQuestionGenSystemPrompt(input.strictSource);
    const userPrompt = this.buildQuestionGenUserPrompt(
      input,
      lessonChunks,
      materialChunks,
      kcFocusNames,
    );

    // 5. Call LLM
    const llmResult = await this.callOpenAiApi(
      systemPrompt,
      userPrompt,
      credentials.apiKey,
      credentials.model,
      8192,
    );

    const durationMs = Date.now() - startTime;

    // 6. Audit log
    await this.createAuditLog(
      input.courseId,
      input.userId,
      credentials.model,
      systemPrompt,
      userPrompt,
      llmResult,
      durationMs,
    );

    // 7. Parse JSON response
    const parsed = this.parseQuestionsResponse(llmResult, input, lessonChunks, materialChunks);

    // 8. Validate each question
    const validated = parsed
      .map((q) => this.validateGeneratedQuestion(q))
      .filter((q): q is GeneratedQuestion => q !== null);

    this.logger.log(
      `Generated ${validated.length}/${input.quantity} valid questions in ${durationMs}ms`,
    );

    return validated;
  }

  /* ================================================================ */
  /*  SOURCE RETRIEVAL                                                 */
  /* ================================================================ */

  private async retrieveSourceChunks(input: GenerateQuestionsInput): Promise<{
    lessonChunks: LessonChunk[];
    materialChunks: ChunkWithScore[];
  }> {
    let lessonChunks: LessonChunk[] = [];
    let materialChunks: ChunkWithScore[] = [];

    if (input.sourceMode === 'lesson_based' || input.sourceMode === 'mixed') {
      // Get content from ModuleItem (type=PAGE) where id IN selectedPageIds
      if (input.selectedPageIds && input.selectedPageIds.length > 0) {
        const pages = await this.prisma.moduleItem.findMany({
          where: {
            id: { in: input.selectedPageIds },
            type: 'PAGE',
          },
          select: {
            id: true,
            title: true,
            contentMdx: true,
          },
        });

        lessonChunks = pages
          .filter(
            (p: { contentMdx: string | null }) => p.contentMdx && p.contentMdx.trim().length > 0,
          )
          .map((p: { title: string; contentMdx: string | null }) => ({
            title: p.title,
            content: p.contentMdx!,
          }));
      }

      // Also use filtered RAG chunks if selectedSourceIds provided
      if (input.selectedSourceIds && input.selectedSourceIds.length > 0) {
        const ragChunks = await this.ragService.queryChunksFiltered(
          input.courseId,
          'question generation',
          input.selectedSourceIds,
          20,
        );
        materialChunks = [...materialChunks, ...ragChunks];
      }
    }

    if (input.sourceMode === 'question_material' || input.sourceMode === 'mixed') {
      const sourceIds = input.selectedSourceIds || [];
      const ragChunks = await this.ragService.queryChunksFiltered(
        input.courseId,
        'question generation',
        sourceIds,
        20,
      );

      // Avoid duplicates if mixed mode already added some
      const existingIds = new Set(materialChunks.map((c) => c.id));
      for (const chunk of ragChunks) {
        if (!existingIds.has(chunk.id)) {
          materialChunks.push(chunk);
        }
      }
    }

    return { lessonChunks, materialChunks };
  }

  /* ================================================================ */
  /*  PROMPT BUILDING                                                  */
  /* ================================================================ */

  private buildQuestionGenSystemPrompt(strictSource: boolean): string {
    return `You are an expert educational content creator and assessment designer.
Your task is to generate high-quality assessment questions based on the provided source material.

RULES:
1. Output ONLY valid JSON matching the specified schema. No markdown fences, no extra text.
2. difficulty MUST be exactly one of: "easy", "medium", "hard". No other values.
3. bloomsLevel MUST be one of: "remember", "understand", "apply", "analyze", "evaluate", "create"
4. For MCQ_SINGLE: exactly 1 option must have isCorrect=true. Include at least 4 options.
5. For MCQ_MULTI: at least 1 option must have isCorrect=true. Stem must clearly state "select all that apply".
6. For STRUCTURED: include expectedAnswer and rubric (array of key marking points).
7. Each option must have a unique id (e.g., "opt-a", "opt-b", etc.).
8. explanation must explain WHY the correct answer is correct.
9. kcNames should be short, specific learning concept names relevant to the question.
${strictSource ? '10. STRICT SOURCE MODE: Every question MUST be directly grounded in the provided source material. If insufficient evidence, return { "status": "NOT_ENOUGH_INFO", "missingInfo": ["..."] }' : ''}`;
  }

  private buildQuestionGenUserPrompt(
    input: GenerateQuestionsInput,
    lessonChunks: LessonChunk[],
    materialChunks: ChunkWithScore[],
    kcFocusNames: string[],
  ): string {
    const {
      quantity,
      types,
      difficultyDistribution,
      bloomsDistribution,
      kcFocus,
      customPrompt,
      sourceMode,
    } = input;
    const { easy, medium, hard } = difficultyDistribution;

    let prompt = `Generate ${quantity} assessment questions with this distribution:
- Types: ${types.join(', ')}
- Difficulty: ${easy} easy, ${medium} medium, ${hard} hard
${bloomsDistribution ? `- Bloom's levels: ${JSON.stringify(bloomsDistribution)}` : ''}
${kcFocus?.length ? `- Focus on these knowledge concepts: ${kcFocusNames.join(', ')}` : '- Auto-detect relevant knowledge concepts'}
${customPrompt ? `- Additional instructions: ${customPrompt}` : ''}

SOURCE MATERIAL:
`;

    if (sourceMode === 'lesson_based' || sourceMode === 'mixed') {
      prompt += `
--- LESSON CONTENT ---
${lessonChunks.map((c, i) => `[Lesson ${i + 1}] (Source: ${c.title})\n${c.content}`).join('\n\n')}
`;
    }

    if (sourceMode === 'question_material' || sourceMode === 'mixed') {
      prompt += `
--- QUESTION MATERIAL (mimic style and difficulty) ---
${materialChunks.map((c, i) => `[Material ${i + 1}] (Source: ${c.documentTitle})\n${c.content}`).join('\n\n')}
`;
    }

    if (sourceMode === 'mixed') {
      prompt +=
        '\nIMPORTANT: Knowledge must match lesson content facts. Style and wording should resemble the question material patterns.\n';
    }

    prompt += `
Return JSON matching this exact schema:
{
  "questions": [
    {
      "type": "MCQ_SINGLE" | "MCQ_MULTI" | "STRUCTURED",
      "stem": "question text",
      "options": [{"id": "opt-a", "text": "...", "isCorrect": true/false}, ...],
      "structuredAnswer": {"expectedAnswer": "...", "rubric": ["point1", ...]},
      "explanation": "why the answer is correct",
      "tags": {"difficulty": "easy"|"medium"|"hard", "bloomsLevel": "remember"|"understand"|..., "kcNames": ["..."]}
    }
  ]
}
IMPORTANT: Every question object MUST include the "type" field with one of: "MCQ_SINGLE", "MCQ_MULTI", "STRUCTURED".`;

    return prompt;
  }

  /* ================================================================ */
  /*  RESPONSE PARSING                                                 */
  /* ================================================================ */

  private parseQuestionsResponse(
    raw: string,
    input: GenerateQuestionsInput,
    lessonChunks: LessonChunk[],
    materialChunks: ChunkWithScore[],
  ): GeneratedQuestion[] {
    try {
      let jsonStr = raw.trim();

      // Strip markdown fences if present
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1]!.trim();

      const parsed = JSON.parse(jsonStr);

      // Handle strict-source NOT_ENOUGH_INFO response
      if (parsed.status === 'NOT_ENOUGH_INFO') {
        this.logger.warn(`LLM returned NOT_ENOUGH_INFO: ${JSON.stringify(parsed.missingInfo)}`);
        return [];
      }

      const questions = parsed.questions || [];
      if (!Array.isArray(questions)) {
        this.logger.error('LLM response "questions" is not an array');
        return [];
      }

      // Attach provenance to each question
      const sourceIds = [
        ...lessonChunks.map((_, i) => `lesson-${i}`),
        ...materialChunks.map((c) => c.documentId),
      ];
      const chunkIds = materialChunks.map((c) => c.id);

      return questions.reduce<GeneratedQuestion[]>((acc, q: any) => {
        const type = this.normalizeQuestionType(q, input.types);
        if (!type) return acc;
        acc.push({
          type,
          stem: q.stem || '',
          options: q.options || undefined,
          structuredAnswer: q.structuredAnswer || undefined,
          explanation: q.explanation || '',
          tags: {
            difficulty: q.tags?.difficulty || q.difficulty || 'medium',
            bloomsLevel: q.tags?.bloomsLevel || q.bloomsLevel || 'understand',
            kcNames: q.tags?.kcNames || q.kcNames || [],
            curriculumOutcomeRefs: q.tags?.curriculumOutcomeRefs || undefined,
          },
          provenance: {
            sourceMode: input.sourceMode,
            sourceIds: q.provenance?.sourceIds || sourceIds,
            chunkIds: q.provenance?.chunkIds || chunkIds,
            citations: q.provenance?.citations || undefined,
          },
        });
        return acc;
      }, []);
    } catch (err: any) {
      this.logger.error(`Failed to parse question generation response: ${err.message}`);
      return [];
    }
  }

  /**
   * Normalise the `type` field coming back from the LLM.
   *
   * The model may return the type in many forms (lowercase, snake_case,
   * camelCase, descriptive strings like "multiple_choice", etc.) or omit
   * it entirely.  This helper maps them back to the canonical enum values
   * MCQ_SINGLE | MCQ_MULTI | STRUCTURED, falling back to heuristic
   * detection based on the question shape and the requested types.
   */
  private normalizeQuestionType(
    q: any,
    requestedTypes: string[],
  ): 'MCQ_SINGLE' | 'MCQ_MULTI' | 'STRUCTURED' | undefined {
    const raw: string | undefined = q.type ?? q.questionType ?? q.question_type;

    if (raw) {
      const t = raw.toUpperCase().replace(/[\s-]+/g, '_');

      // Direct canonical match
      if (t === 'MCQ_SINGLE' || t === 'MCQ_MULTI' || t === 'STRUCTURED') return t;

      // Common LLM aliases
      if (t.includes('SINGLE') || t === 'MCQ' || t === 'MULTIPLE_CHOICE') return 'MCQ_SINGLE';
      if (t.includes('MULTI') && !t.includes('MULTIPLE_CHOICE')) return 'MCQ_MULTI';
      if (
        t.includes('STRUCT') ||
        t.includes('FREE') ||
        t.includes('OPEN') ||
        t.includes('SHORT_ANSWER') ||
        t.includes('ESSAY')
      )
        return 'STRUCTURED';
    }

    // Heuristic: infer from question shape
    if (q.structuredAnswer || q.structured_answer || q.expectedAnswer) return 'STRUCTURED';

    if (Array.isArray(q.options) && q.options.length > 0) {
      const correctCount = q.options.filter((o: any) => o.isCorrect || o.is_correct).length;
      if (correctCount > 1) return 'MCQ_MULTI';
      return 'MCQ_SINGLE';
    }

    // Last resort: if only one type was requested, assume that type
    if (requestedTypes.length === 1)
      return requestedTypes[0] as 'MCQ_SINGLE' | 'MCQ_MULTI' | 'STRUCTURED';

    return undefined;
  }

  /* ================================================================ */
  /*  VALIDATION                                                       */
  /* ================================================================ */

  private validateGeneratedQuestion(q: GeneratedQuestion): GeneratedQuestion | null {
    // Validate type
    const validTypes = ['MCQ_SINGLE', 'MCQ_MULTI', 'STRUCTURED'];
    if (!validTypes.includes(q.type)) {
      this.logger.warn(`Invalid question type "${q.type}" — skipping`);
      return null;
    }

    // Validate difficulty
    const validDifficulties = ['easy', 'medium', 'hard'];
    if (!validDifficulties.includes(q.tags.difficulty)) {
      this.logger.warn(`Invalid difficulty "${q.tags.difficulty}" — defaulting to "medium"`);
      q.tags.difficulty = 'medium';
    }

    // Validate bloomsLevel
    const validBlooms = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];
    if (!validBlooms.includes(q.tags.bloomsLevel)) {
      this.logger.warn(`Invalid bloomsLevel "${q.tags.bloomsLevel}" — defaulting to "understand"`);
      q.tags.bloomsLevel = 'understand';
    }

    // MCQ_SINGLE validations
    if (q.type === 'MCQ_SINGLE') {
      if (!q.options || q.options.length === 0) {
        this.logger.warn('MCQ_SINGLE has no options — skipping');
        return null;
      }

      // Ensure unique option IDs
      q.options = this.ensureOptionIds(q.options);

      const correctCount = q.options.filter((o) => o.isCorrect).length;
      if (correctCount !== 1) {
        this.logger.warn(`MCQ_SINGLE has ${correctCount} correct options (expected 1) — skipping`);
        return null;
      }

      if (q.options.length < 4) {
        this.logger.warn(`MCQ_SINGLE has only ${q.options.length} options (recommended >= 4)`);
      }
    }

    // MCQ_MULTI validations
    if (q.type === 'MCQ_MULTI') {
      if (!q.options || q.options.length === 0) {
        this.logger.warn('MCQ_MULTI has no options — skipping');
        return null;
      }

      q.options = this.ensureOptionIds(q.options);

      const correctCount = q.options.filter((o) => o.isCorrect).length;
      if (correctCount < 1) {
        this.logger.warn('MCQ_MULTI has no correct options — skipping');
        return null;
      }

      if (
        !q.stem.toLowerCase().includes('select all') &&
        !q.stem.toLowerCase().includes('choose all')
      ) {
        this.logger.warn('MCQ_MULTI stem should contain "select all that apply"');
      }
    }

    // STRUCTURED validations
    if (q.type === 'STRUCTURED') {
      if (!q.structuredAnswer) {
        this.logger.warn('STRUCTURED question missing structuredAnswer — skipping');
        return null;
      }
      if (!q.structuredAnswer.expectedAnswer) {
        this.logger.warn('STRUCTURED question missing expectedAnswer — skipping');
        return null;
      }
      if (!q.structuredAnswer.rubric || !Array.isArray(q.structuredAnswer.rubric)) {
        this.logger.warn('STRUCTURED question missing rubric array — skipping');
        return null;
      }
    }

    return q;
  }

  private ensureOptionIds(
    options: { id: string; text: string; isCorrect: boolean }[],
  ): { id: string; text: string; isCorrect: boolean }[] {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    return options.map((opt, i) => ({
      ...opt,
      id: opt.id || `opt-${alphabet[i] || i}`,
    }));
  }

  /* ================================================================ */
  /*  KC RESOLUTION                                                    */
  /* ================================================================ */

  async resolveKcTags(courseId: string, kcNames: string[]): Promise<ResolvedKc[]> {
    // Fetch existing ProposedKCs for the course
    const proposedKcs = await this.prisma.proposedKC.findMany({
      where: { courseId },
      select: { id: true, name: true },
    });

    // Fetch existing KnowledgeComponents for the course
    const existingKcs = await this.prisma.knowledgeComponent.findMany({
      where: { topic: { courseId } },
      select: { id: true, label: true },
    });

    const allKcs = [
      ...existingKcs.map((kc: { id: string; label: string }) => ({ id: kc.id, name: kc.label })),
      ...proposedKcs.map((kc: { id: string; name: string }) => ({ id: kc.id, name: kc.name })),
    ];

    return kcNames.map((name) => {
      const match = this.findSimilarKc(name, allKcs);
      if (match) {
        return { id: match.id, name: match.name, isExisting: true };
      }
      return { id: null, name, isExisting: false };
    });
  }

  private findSimilarKc(
    name: string,
    existing: Array<{ id: string; name: string }>,
  ): { id: string; name: string } | null {
    const normalized = name.toLowerCase().trim();

    for (const kc of existing) {
      const existingNorm = kc.name.toLowerCase().trim();

      // Exact match
      if (existingNorm === normalized) return kc;

      // High similarity: one is substring of the other
      if (existingNorm.includes(normalized) || normalized.includes(existingNorm)) {
        return kc;
      }

      // Simple word overlap ratio (Jaccard similarity)
      const wordsA = new Set(normalized.split(/\s+/));
      const wordsB = new Set(existingNorm.split(/\s+/));
      const intersection = [...wordsA].filter((w) => wordsB.has(w));
      const union = new Set([...wordsA, ...wordsB]);
      const jaccard = intersection.length / union.size;
      if (jaccard >= 0.7) return kc;
    }

    return null;
  }

  /* ================================================================ */
  /*  SAVE GENERATED QUESTIONS                                         */
  /* ================================================================ */

  async saveGeneratedQuestions(
    courseId: string,
    userId: string,
    questions: GeneratedQuestion[],
    assessmentId?: string,
  ): Promise<string[]> {
    const createdIds: string[] = [];

    for (const q of questions) {
      // Map difficulty string to numeric value
      const difficultyMap: Record<string, number> = {
        easy: 1,
        medium: 3,
        hard: 5,
      };

      // Resolve KC tags
      const resolvedKcs = await this.resolveKcTags(courseId, q.tags.kcNames || []);

      // Create ProposedKC entries for unmatched KCs
      const kcIds: string[] = [];
      for (const kc of resolvedKcs) {
        if (kc.isExisting && kc.id) {
          kcIds.push(kc.id);
        } else {
          // Create a new ProposedKC
          const proposed = await this.prisma.proposedKC.create({
            data: {
              courseId,
              name: kc.name,
              description: `Auto-created from question generation`,
              status: 'PROPOSED',
              confidenceLevel: 'MEDIUM',
              createdBy: 'ai',
              evidence: {} as any,
              pageIds: [],
            },
          });
          // ProposedKC id cannot be used in QuestionKc join (needs KnowledgeComponent id)
          // Store the proposed KC ID in tags for reference
          this.logger.log(
            `Created ProposedKC "${kc.name}" (${proposed.id}) for course ${courseId}`,
          );
        }
      }

      // Build options for MCQ types
      const optionsJson = q.options && q.options.length > 0 ? q.options : null;
      const correctOptionId =
        q.type === 'MCQ_SINGLE' ? q.options?.find((o) => o.isCorrect)?.id || null : null;

      // Build correctAnswer for STRUCTURED
      const correctAnswer = q.structuredAnswer ? q.structuredAnswer : null;

      // Create the Question record
      const question = await this.prisma.question.create({
        data: {
          courseId,
          prompt: q.stem,
          stem: q.stem as any,
          type: q.type as any,
          maxScore: q.type === 'STRUCTURED' ? 10 : 1,
          options: optionsJson as any,
          correctOptionId,
          correctAnswer: correctAnswer as any,
          explanation: q.explanation as any,
          difficulty: difficultyMap[q.tags.difficulty] || 3,
          bloomsLevel: q.tags.bloomsLevel || null,
          kcIds,
          pageIds: [],
          tags: {
            kcNames: q.tags.kcNames,
            curriculumOutcomeRefs: q.tags.curriculumOutcomeRefs,
          } as any,
          status: 'draft',
          createdBy: 'ai',
          sourceType: 'ai_generated',
          provenance: q.provenance as any,
        },
      });

      // Create QuestionKc join records for matched KCs
      if (kcIds.length > 0) {
        await this.prisma.questionKc.createMany({
          data: kcIds.map((kcId) => ({
            questionId: question.id,
            kcId,
          })),
        });
      }

      createdIds.push(question.id);
    }

    // Link to assessment if provided
    if (assessmentId && createdIds.length > 0) {
      const lastItem = await this.prisma.assessmentQuestion.findFirst({
        where: { assessmentId },
        orderBy: { orderIndex: 'desc' },
      });
      let nextIndex = lastItem ? lastItem.orderIndex + 1 : 0;

      await this.prisma.assessmentQuestion.createMany({
        data: createdIds.map((questionId) => ({
          assessmentId,
          questionId,
          orderIndex: nextIndex++,
          points: 1,
        })),
      });
    }

    this.logger.log(`Saved ${createdIds.length} generated questions for course ${courseId}`);

    return createdIds;
  }

  /* ================================================================ */
  /*  AUDIT LOGGING                                                    */
  /* ================================================================ */

  private async createAuditLog(
    courseId: string,
    userId: string,
    model: string,
    systemPrompt: string,
    userPrompt: string,
    response: string,
    durationMs: number,
  ): Promise<void> {
    try {
      // Estimate token counts (rough: 1 token ≈ 4 chars)
      const promptTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4);
      const completionTokens = Math.ceil(response.length / 4);

      await this.prisma.llmAuditLog.create({
        data: {
          courseId,
          userId,
          action: 'question_generation',
          model,
          promptTokens,
          completionTokens,
          durationMs,
          inputPayload: {
            systemPromptLength: systemPrompt.length,
            userPromptLength: userPrompt.length,
          } as any,
          outputPayload: {
            responseLength: response.length,
          } as any,
        },
      });
    } catch (err: any) {
      // Non-blocking: log and continue
      this.logger.error(`Failed to create audit log: ${err.message}`, err.stack);
    }
  }

  /* ================================================================ */
  /*  LLM CREDENTIALS & API CALL                                       */
  /* ================================================================ */

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
    maxTokens: number = 8192,
  ): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
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
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content || '';
  }
}
