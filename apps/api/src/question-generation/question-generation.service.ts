import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { RagService } from '../rag/rag.service';
import { LlmService } from '../rag/llm.service';
import { QUESTION_GENERATION_PROMPT } from './prompts/question-generation.prompt';
import { DEFAULT_FEEDBACK_PROMPTS } from './prompts/feedback.prompt';
import type {
  GenerateQuestionsDto,
  ReviewQuestionDto,
  GradeOpenEndedDto,
  RegenerateDto,
} from './dto';
import { Prisma } from '@prisma/client';
import type { HattieFeedbackLevel } from '@prisma/client';

// Map difficulty string to integer (1-5 scale)
function difficultyToInt(d: string): number {
  switch (d.toLowerCase()) {
    case 'easy':
      return 2;
    case 'medium':
      return 3;
    case 'hard':
      return 5;
    default:
      return 3;
  }
}

// Map question type from AI output to QuestionType enum
function mapQuestionType(t: string): string {
  switch (t.toLowerCase()) {
    case 'mcq':
      return 'MCQ_SINGLE';
    case 'true_false':
      return 'MCQ_SINGLE'; // True/False implemented as MCQ with 2 options
    case 'short_answer':
      return 'text';
    case 'open_ended':
      return 'STRUCTURED';
    default:
      return 'text';
  }
}

@Injectable()
export class QuestionGenerationService {
  private readonly logger = new Logger(QuestionGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragService: RagService,
    private readonly llmService: LlmService,
  ) {}

  // ─── Job Management ──────────────────────────────────────

  async createJob(teacherId: string, dto: GenerateQuestionsDto) {
    // Validate
    if (!dto.sourceDocumentIds?.length) {
      throw new BadRequestException('At least one source document is required');
    }
    if (dto.questionCount < 1 || dto.questionCount > 30) {
      throw new BadRequestException('Question count must be between 1 and 30');
    }
    if (!dto.questionTypes?.length) {
      throw new BadRequestException('At least one question type is required');
    }

    // Verify teacher owns the course
    const course = await this.prisma.course.findUnique({
      where: { id: dto.courseId },
      select: { id: true, teacherId: true, title: true },
    });
    if (!course || course.teacherId !== teacherId) {
      throw new NotFoundException('Course not found');
    }

    // Verify documents belong to the course
    const docs = await this.prisma.sourceDocument.findMany({
      where: { id: { in: dto.sourceDocumentIds }, courseId: dto.courseId },
      select: { id: true },
    });
    if (docs.length !== dto.sourceDocumentIds.length) {
      throw new BadRequestException('One or more documents not found in this course');
    }

    const job = await this.prisma.questionGenerationJob.create({
      data: {
        courseId: dto.courseId,
        teacherId,
        sourceDocumentIds: dto.sourceDocumentIds,
        questionTypes: dto.questionTypes,
        questionCount: dto.questionCount,
        difficultyMix: dto.difficultyMix ?? Prisma.DbNull,
        additionalInstructions: dto.additionalInstructions ?? null,
      },
    });

    // Start generation asynchronously
    this.runGeneration(job.id).catch((err) => {
      this.logger.error(`Generation job ${job.id} failed: ${err.message}`);
    });

    return { jobId: job.id, status: 'PENDING' };
  }

  async getJob(jobId: string, teacherId: string) {
    const job = await this.prisma.questionGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.teacherId !== teacherId) {
      throw new NotFoundException('Job not found');
    }
    return job;
  }

  async getJobsForCourse(courseId: string, teacherId: string) {
    // Verify teacher owns course
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });
    if (!course || course.teacherId !== teacherId) {
      throw new NotFoundException('Course not found');
    }

    return this.prisma.questionGenerationJob.findMany({
      where: { courseId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Generation Pipeline ─────────────────────────────────

  private async runGeneration(jobId: string) {
    try {
      // Step 1: RETRIEVING
      await this.prisma.questionGenerationJob.update({
        where: { id: jobId },
        data: { status: 'RETRIEVING', startedAt: new Date() },
      });

      const job = await this.prisma.questionGenerationJob.findUniqueOrThrow({
        where: { id: jobId },
      });

      const sourceDocIds = job.sourceDocumentIds as string[];
      const course = await this.prisma.course.findUniqueOrThrow({
        where: { id: job.courseId },
        select: { id: true, title: true, description: true },
      });

      // Retrieve relevant chunks from selected documents
      const query = `${course.title} ${course.description}`;
      const chunks = await this.ragService.queryChunksFiltered(
        job.courseId,
        query,
        sourceDocIds,
        30, // get more chunks for question generation
      );

      if (chunks.length === 0) {
        throw new Error(
          'No content found in the selected documents. Ensure documents are chunked.',
        );
      }

      const retrievedContent = chunks.map((c) => c.content).join('\n\n---\n\n');

      // Store chunks for audit
      await this.prisma.questionGenerationJob.update({
        where: { id: jobId },
        data: {
          sourceChunks: chunks.map((c) => ({
            id: c.id,
            documentTitle: c.documentTitle,
            chunkIndex: c.chunkIndex,
            pageNumber: c.pageNumber,
          })),
        },
      });

      // Step 2: GENERATING
      await this.prisma.questionGenerationJob.update({
        where: { id: jobId },
        data: { status: 'GENERATING' },
      });

      // Fetch knowledge components for this course (via topics)
      const kcs = await this.prisma.knowledgeComponent.findMany({
        where: { topic: { courseId: job.courseId } },
        select: { id: true, code: true, label: true, description: true },
      });

      const kcListStr =
        kcs.length > 0
          ? kcs
              .map(
                (kc) =>
                  `- ${kc.id}: ${kc.label} (${kc.code})${kc.description ? ' — ' + kc.description : ''}`,
              )
              .join('\n')
          : 'No knowledge components defined. Generate questions without KC tags.';

      const questionTypes = job.questionTypes as string[];
      const difficultyMix = job.difficultyMix as Record<string, number> | null;

      const difficultyStr = difficultyMix
        ? `Easy: ${difficultyMix.easy || 0}, Medium: ${difficultyMix.medium || 0}, Hard: ${difficultyMix.hard || 0}`
        : 'Let AI decide based on content complexity';

      const typeStr = questionTypes.join(', ');

      // Build prompts
      const systemPrompt = QUESTION_GENERATION_PROMPT.systemPrompt
        .replace(/\{\{questionCount\}\}/g, String(job.questionCount))
        .replace(/\{\{questionTypes\}\}/g, typeStr)
        .replace(/\{\{difficultyMix\}\}/g, difficultyStr);

      const userPrompt = QUESTION_GENERATION_PROMPT.userPromptTemplate
        .replace(/\{\{questionCount\}\}/g, String(job.questionCount))
        .replace(/\{\{questionTypes\}\}/g, typeStr)
        .replace(/\{\{difficultyMix\}\}/g, difficultyStr)
        .replace(/\{\{knowledgeComponents\}\}/g, kcListStr)
        .replace(/\{\{retrievedContent\}\}/g, retrievedContent)
        .replace(
          /\{\{additionalInstructions\}\}/g,
          job.additionalInstructions
            ? `Additional instructions: ${job.additionalInstructions}`
            : '',
        );

      // Call LLM
      const teacherId = job.teacherId;
      const llmResult = await this.llmService.callLlmForUser(teacherId, systemPrompt, userPrompt);

      // Parse response
      const parsed = this.parseLlmJson(llmResult.content);
      const data = parsed as { questions?: unknown[] };

      if (!data?.questions || !Array.isArray(data.questions)) {
        throw new Error('LLM response missing questions array');
      }

      // Annotate questions with review status
      const questions = data.questions.map((q: any, i: number) => ({
        ...q,
        index: i,
        reviewStatus: 'pending' as const, // pending | approved | rejected | edited
      }));

      // Step 3: REVIEW_READY
      await this.prisma.questionGenerationJob.update({
        where: { id: jobId },
        data: {
          status: 'REVIEW_READY',
          generatedQuestions: questions as any,
          completedAt: new Date(),
        },
      });

      this.logger.log(`Generation job ${jobId} completed: ${questions.length} questions generated`);
    } catch (error: any) {
      this.logger.error(`Generation job ${jobId} failed: ${error.message}`);
      await this.prisma.questionGenerationJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          error: error.message,
          completedAt: new Date(),
        },
      });
    }
  }

  // ─── Review & Approve/Reject ──────────────────────────────

  async reviewQuestion(
    jobId: string,
    questionIndex: number,
    teacherId: string,
    dto: ReviewQuestionDto,
  ) {
    const job = await this.prisma.questionGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.teacherId !== teacherId) {
      throw new NotFoundException('Job not found');
    }
    if (job.status !== 'REVIEW_READY' && job.status !== 'COMPLETED') {
      throw new BadRequestException('Job is not ready for review');
    }

    const questions = (job.generatedQuestions as any[]) || [];
    if (questionIndex < 0 || questionIndex >= questions.length) {
      throw new BadRequestException('Invalid question index');
    }

    const question = questions[questionIndex];

    if (dto.action === 'reject') {
      question.reviewStatus = 'rejected';
      await this.prisma.questionGenerationJob.update({
        where: { id: jobId },
        data: {
          generatedQuestions: questions as any,
          rejectedCount: { increment: 1 },
        },
      });
      return { status: 'rejected', index: questionIndex };
    }

    // For edit, apply modifications
    if (dto.action === 'edit' && dto.editedQuestion) {
      if (dto.editedQuestion.questionText) question.questionText = dto.editedQuestion.questionText;
      if (dto.editedQuestion.difficulty) question.difficulty = dto.editedQuestion.difficulty;
      if (dto.editedQuestion.knowledgeTags)
        question.knowledgeTags = dto.editedQuestion.knowledgeTags;
      if (dto.editedQuestion.options) question.options = dto.editedQuestion.options;
      if (dto.editedQuestion.answerKey) question.answerKey = dto.editedQuestion.answerKey;
      question.reviewStatus = 'edited';
    }

    // Approve (or approve after edit)
    const created = await this.approveQuestion(job.courseId, question, dto.action === 'edit');

    question.reviewStatus = dto.action === 'edit' ? 'edited' : 'approved';
    question.approvedQuestionId = created.id;

    await this.prisma.questionGenerationJob.update({
      where: { id: jobId },
      data: {
        generatedQuestions: questions as any,
        approvedCount: { increment: 1 },
      },
    });

    return { status: 'approved', index: questionIndex, questionId: created.id };
  }

  async approveAll(jobId: string, teacherId: string) {
    const job = await this.prisma.questionGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.teacherId !== teacherId) {
      throw new NotFoundException('Job not found');
    }

    const questions = (job.generatedQuestions as any[]) || [];
    const pending = questions.filter((q) => q.reviewStatus === 'pending');

    let approvedCount = 0;
    for (const question of pending) {
      const created = await this.approveQuestion(job.courseId, question, false);
      question.reviewStatus = 'approved';
      question.approvedQuestionId = created.id;
      approvedCount++;
    }

    await this.prisma.questionGenerationJob.update({
      where: { id: jobId },
      data: {
        generatedQuestions: questions as any,
        approvedCount: { increment: approvedCount },
        status: 'COMPLETED',
      },
    });

    return { approvedCount };
  }

  async regenerateRejected(jobId: string, teacherId: string, dto: RegenerateDto) {
    const job = await this.prisma.questionGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.teacherId !== teacherId) {
      throw new NotFoundException('Job not found');
    }

    const count = Math.min(dto.count, 10);

    // Re-use same source chunks
    const chunks = job.sourceChunks as any[];
    if (!chunks?.length) {
      throw new BadRequestException('No source chunks available for regeneration');
    }

    // Retrieve full chunk content again
    const chunkIds = chunks.map((c: any) => c.id);
    const fullChunks = await this.prisma.documentChunk.findMany({
      where: { id: { in: chunkIds } },
      select: { content: true },
    });
    const retrievedContent = fullChunks.map((c) => c.content).join('\n\n---\n\n');

    const kcs = await this.prisma.knowledgeComponent.findMany({
      where: { topic: { courseId: job.courseId } },
      select: { id: true, code: true, label: true },
    });
    const kcListStr =
      kcs.length > 0
        ? kcs.map((kc) => `- ${kc.id}: ${kc.label} (${kc.code})`).join('\n')
        : 'No knowledge components defined.';

    const questionTypes = job.questionTypes as string[];

    const systemPrompt = QUESTION_GENERATION_PROMPT.systemPrompt
      .replace(/\{\{questionCount\}\}/g, String(count))
      .replace(/\{\{questionTypes\}\}/g, questionTypes.join(', '))
      .replace(/\{\{difficultyMix\}\}/g, 'Let AI decide');

    const userPrompt = QUESTION_GENERATION_PROMPT.userPromptTemplate
      .replace(/\{\{questionCount\}\}/g, String(count))
      .replace(/\{\{questionTypes\}\}/g, questionTypes.join(', '))
      .replace(/\{\{difficultyMix\}\}/g, 'Let AI decide')
      .replace(/\{\{knowledgeComponents\}\}/g, kcListStr)
      .replace(/\{\{retrievedContent\}\}/g, retrievedContent)
      .replace(
        /\{\{additionalInstructions\}\}/g,
        'Generate NEW questions different from previously generated ones.',
      );

    const llmResult = await this.llmService.callLlmForUser(job.teacherId, systemPrompt, userPrompt);

    const parsed = this.parseLlmJson(llmResult.content) as { questions?: unknown[] };
    const newQuestions = (parsed.questions || []).map((q: any, i: number) => ({
      ...q,
      index: (job.generatedQuestions as any[]).length + i,
      reviewStatus: 'pending',
    }));

    const existingQuestions = (job.generatedQuestions as any[]) || [];
    const allQuestions = [...existingQuestions, ...newQuestions];

    await this.prisma.questionGenerationJob.update({
      where: { id: jobId },
      data: {
        generatedQuestions: allQuestions as any,
        status: 'REVIEW_READY',
      },
    });

    return { newCount: newQuestions.length, totalCount: allQuestions.length };
  }

  // ─── AI Grading for Open-Ended ───────────────────────────

  async gradeOpenEnded(teacherId: string, dto: GradeOpenEndedDto) {
    const question = await this.prisma.question.findUnique({
      where: { id: dto.questionId },
      include: { course: { select: { teacherId: true } } },
    });
    if (!question) {
      throw new NotFoundException('Question not found');
    }

    const answerKey = (question.answerKey || question.correctAnswer || question.rubricJson) as any;
    if (!answerKey) {
      throw new BadRequestException('Question has no answer key for AI grading');
    }

    const feedbackLevels = dto.feedbackLevels as HattieFeedbackLevel[];
    const feedback: Record<string, any> = {};
    let overallScore: number | null = null;
    const maxScore = answerKey.maxScore || question.maxScore;

    // Get the teacher whose API key to use
    const apiKeyUserId = question.course?.teacherId || teacherId;

    for (const level of feedbackLevels) {
      const systemPrompt = await this.getFeedbackPrompt(dto.courseId, level);

      // Build the prompt with context
      const filledPrompt = systemPrompt
        .replace(/\{\{question\}\}/g, question.prompt)
        .replace(/\{\{rubric\}\}/g, answerKey.rubric || '')
        .replace(/\{\{sampleAnswer\}\}/g, answerKey.sampleAnswer || '')
        .replace(/\{\{keyPoints\}\}/g, JSON.stringify(answerKey.keyPoints || []))
        .replace(/\{\{maxScore\}\}/g, String(maxScore))
        .replace(/\{\{studentAnswer\}\}/g, dto.studentAnswer);

      try {
        const result = await this.llmService.callLlmForUser(
          apiKeyUserId,
          filledPrompt,
          `Grade this student answer:\n\n${dto.studentAnswer}`,
        );

        const parsed = this.parseLlmJson(result.content) as Record<string, any>;
        feedback[level.toLowerCase()] = parsed;

        // Task-level feedback determines the overall score
        if (level === 'TASK' && parsed.score != null) {
          overallScore = parsed.score;
        }
      } catch (error: any) {
        this.logger.warn(`Failed to generate ${level} feedback: ${error.message}`);
        feedback[level.toLowerCase()] = {
          error: 'Failed to generate feedback',
          feedback: 'AI feedback could not be generated. Please contact your instructor.',
        };
      }
    }

    return {
      questionId: dto.questionId,
      overallScore: overallScore ?? 0,
      maxScore,
      feedback,
    };
  }

  // ─── Feedback Prompt Config ──────────────────────────────

  async getFeedbackPrompt(courseId: string, feedbackLevel: HattieFeedbackLevel): Promise<string> {
    const custom = await this.prisma.feedbackPromptConfig.findUnique({
      where: {
        courseId_feedbackLevel: { courseId, feedbackLevel },
      },
    });

    if (custom?.isCustom && custom.systemPrompt) {
      return custom.systemPrompt;
    }

    return DEFAULT_FEEDBACK_PROMPTS[feedbackLevel].systemPrompt;
  }

  async getAllFeedbackConfigs(courseId: string) {
    const levels: HattieFeedbackLevel[] = ['TASK', 'PROCESS', 'SELF_REGULATION', 'SELF'];

    return Promise.all(
      levels.map(async (level) => {
        const custom = await this.prisma.feedbackPromptConfig.findUnique({
          where: { courseId_feedbackLevel: { courseId, feedbackLevel: level } },
        });

        const defaults = DEFAULT_FEEDBACK_PROMPTS[level];
        return {
          feedbackLevel: level,
          courseId,
          isCustom: !!custom?.isCustom,
          systemPrompt: custom?.isCustom ? custom.systemPrompt : defaults.systemPrompt,
          defaultSystemPrompt: defaults.systemPrompt,
          label: defaults.label,
          description: defaults.description,
        };
      }),
    );
  }

  async updateFeedbackConfig(
    courseId: string,
    feedbackLevel: HattieFeedbackLevel,
    teacherId: string,
    systemPrompt: string,
  ) {
    if (!systemPrompt || systemPrompt.trim().length < 50) {
      throw new BadRequestException('System prompt must be at least 50 characters');
    }
    if (systemPrompt.length > 10000) {
      throw new BadRequestException('System prompt must be less than 10000 characters');
    }

    await this.prisma.feedbackPromptConfig.upsert({
      where: {
        courseId_feedbackLevel: { courseId, feedbackLevel },
      },
      create: {
        courseId,
        feedbackLevel,
        teacherId,
        systemPrompt: systemPrompt.trim(),
        isCustom: true,
      },
      update: {
        systemPrompt: systemPrompt.trim(),
        isCustom: true,
      },
    });

    return this.getAllFeedbackConfigs(courseId);
  }

  async deleteFeedbackConfig(courseId: string, feedbackLevel: HattieFeedbackLevel) {
    await this.prisma.feedbackPromptConfig
      .delete({
        where: { courseId_feedbackLevel: { courseId, feedbackLevel } },
      })
      .catch(() => {
        /* config may not exist */
      });

    return this.getAllFeedbackConfigs(courseId);
  }

  // ─── Feedback Settings (enabled levels) ──────────────────

  async getFeedbackSettings(courseId: string) {
    const setting = await this.prisma.courseFeedbackSetting.findUnique({
      where: { courseId },
    });
    return {
      courseId,
      enabledLevels: (setting?.enabledLevels as string[]) ?? ['TASK'],
    };
  }

  async updateFeedbackSettings(courseId: string, enabledLevels: string[]) {
    const valid: HattieFeedbackLevel[] = ['TASK', 'PROCESS', 'SELF_REGULATION', 'SELF'];
    const filtered = enabledLevels.filter((l) => valid.includes(l as HattieFeedbackLevel));

    if (filtered.length === 0) {
      throw new BadRequestException('At least one feedback level must be enabled');
    }

    await this.prisma.courseFeedbackSetting.upsert({
      where: { courseId },
      create: { courseId, enabledLevels: filtered },
      update: { enabledLevels: filtered },
    });

    return { courseId, enabledLevels: filtered };
  }

  // ─── Private Helpers ─────────────────────────────────────

  private async approveQuestion(courseId: string, generatedQ: any, isEdited: boolean) {
    const qType = mapQuestionType(generatedQ.type);
    const difficulty = difficultyToInt(generatedQ.difficulty || 'medium');

    // Build options for MCQ types
    let options = null;
    let correctOptionId = null;
    if (generatedQ.type === 'mcq' && generatedQ.options) {
      options = generatedQ.options.map((opt: any, i: number) => ({
        id: String(i + 1),
        text: opt.text || opt.label + ') ' + opt.text,
        isCorrect: !!opt.isCorrect,
      }));
      const correct = options.find((o: any) => o.isCorrect);
      correctOptionId = correct?.id || null;
    } else if (generatedQ.type === 'true_false') {
      const isTrue = generatedQ.answerKey?.correct === true;
      options = [
        { id: '1', text: 'True', isCorrect: isTrue },
        { id: '2', text: 'False', isCorrect: !isTrue },
      ];
      correctOptionId = isTrue ? '1' : '2';
    }

    // Build correct answer for structured types
    let correctAnswer = null;
    if (generatedQ.type === 'open_ended' || generatedQ.type === 'short_answer') {
      correctAnswer = generatedQ.answerKey;
    }

    const maxScore = generatedQ.answerKey?.maxScore || (generatedQ.type === 'open_ended' ? 10 : 1);

    // Build rubricJson for grading
    let rubricJson = null;
    if (generatedQ.type === 'short_answer' && generatedQ.answerKey?.keywords) {
      rubricJson = { answer_key: generatedQ.answerKey.keywords };
    }

    // Determine KC IDs
    const kcIds: string[] = generatedQ.knowledgeTags || [];

    // Verify KC IDs exist
    const validKcs =
      kcIds.length > 0
        ? await this.prisma.knowledgeComponent.findMany({
            where: { id: { in: kcIds } },
            select: { id: true },
          })
        : [];
    const validKcIds = validKcs.map((kc) => kc.id);

    const question = await this.prisma.question.create({
      data: {
        courseId,
        prompt: generatedQ.questionText,
        type: qType as any,
        maxScore,
        difficulty,
        options: options ?? undefined,
        correctOptionId,
        correctAnswer: correctAnswer ?? undefined,
        rubricJson: rubricJson ?? undefined,
        answerKey: generatedQ.answerKey ?? undefined,
        difficultyConfidence: generatedQ.difficultyConfidence ?? null,
        gradingConfig: generatedQ.type === 'open_ended' ? { feedbackLevel: 'TASK' } : Prisma.DbNull,
        status: 'approved',
        createdBy: 'ai',
        sourceType: 'uploaded',
        kcIds: validKcIds,
      },
    });

    // Create QuestionKc junction records
    if (validKcIds.length > 0) {
      await this.prisma.questionKc.createMany({
        data: validKcIds.map((kcId) => ({
          questionId: question.id,
          kcId,
          isAutoAssigned: !isEdited,
          confidence: generatedQ.difficultyConfidence ?? null,
        })),
      });
    }

    return question;
  }

  private parseLlmJson(content: string): unknown {
    let cleaned = content.trim();

    // Remove markdown code fences
    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch?.[1]) {
      cleaned = jsonMatch[1].trim();
    }

    try {
      return JSON.parse(cleaned);
    } catch {
      throw new Error(`Failed to parse LLM response as JSON: ${cleaned.slice(0, 200)}`);
    }
  }
}
