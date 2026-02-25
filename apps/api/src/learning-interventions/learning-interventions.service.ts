import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../rag/llm.service';
import type { InterventionType, Prisma } from '@prisma/client';
import type {
  CreateSavedReviewDto,
  UpdateSavedReviewDto,
  GeneratePracticeTestDto,
  SubmitPracticeTestAnswersDto,
  GenerateElaborationDto,
  SubmitElaborationDto,
} from './dto';
import { DEFAULT_PROMPTS } from './prompts/default-prompts';
import { buildPracticeTestingPrompt } from './prompts/practice-testing.prompt';
import {
  buildElaborationQuestionsPrompt,
  buildElaborationEvaluationPrompt,
} from './prompts/interrogative-elaboration.prompt';

// ─── Practice Testing Interfaces ─────────────────────────

interface PracticeQuestion {
  question: string;
  type: 'mcq' | 'short_answer';
  options?: string[];
  correctAnswer: string;
  explanation: string;
  keywords?: string[];
}

interface PracticeTestResult {
  interventionId: string;
  questions: Array<Omit<PracticeQuestion, 'correctAnswer' | 'explanation' | 'keywords'>>;
}

interface GradedAnswer {
  questionIndex: number;
  question: string;
  type: 'mcq' | 'short_answer';
  userAnswer: string;
  correctAnswer: string;
  correct: boolean;
  explanation: string;
  options?: string[];
}

interface GradedResult {
  interventionId: string;
  score: number;
  totalQuestions: number;
  results: GradedAnswer[];
}

// ─── Interrogative Elaboration Interfaces ───────────────

interface ElaborationQuestion {
  question: string;
  type: 'why' | 'how';
  keyPoints: string[];
}

interface ElaborationSessionData {
  questions: ElaborationQuestion[];
  selectedText: string;
  userElaborations: Array<{
    questionIndex: number;
    elaboration: string;
    rating: string;
    addressedPoints: string[];
    missedPoints: string[];
    feedback: string;
    modelElaboration: string;
  }>;
}

interface ElaborationSessionResult {
  interventionId: string;
  questions: Array<{ question: string; type: string }>;
}

interface ElaborationEvaluation {
  rating: string;
  addressedPoints: string[];
  missedPoints: string[];
  feedback: string;
  modelElaboration: string;
}

@Injectable()
export class LearningInterventionsService {
  private readonly logger = new Logger(LearningInterventionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

  // ─── Prompt Config ────────────────────────────────────────

  async getSystemPrompt(courseId: string, interventionType: InterventionType): Promise<string> {
    const customConfig = await this.prisma.interventionPromptConfig.findUnique({
      where: {
        courseId_interventionType: { courseId, interventionType },
      },
    });

    if (customConfig?.isCustom && customConfig.systemPrompt) {
      return customConfig.systemPrompt;
    }

    return DEFAULT_PROMPTS[interventionType].systemPrompt;
  }

  async getPromptConfig(courseId: string, interventionType: InterventionType) {
    const customConfig = await this.prisma.interventionPromptConfig.findUnique({
      where: {
        courseId_interventionType: { courseId, interventionType },
      },
    });

    const defaults = DEFAULT_PROMPTS[interventionType];

    return {
      interventionType,
      courseId,
      isCustom: !!customConfig?.isCustom,
      systemPrompt: customConfig?.isCustom ? customConfig.systemPrompt : defaults.systemPrompt,
      defaultSystemPrompt: defaults.systemPrompt,
      userPromptTemplate: defaults.userPromptTemplate,
      label: defaults.label,
      description: defaults.description,
    };
  }

  async getAllPromptConfigs(courseId: string) {
    const types: InterventionType[] = [
      'PRACTICE_TESTING',
      'DISTRIBUTED_PRACTICE',
      'STEPWISE_LEARNING',
      'INTERROGATIVE_ELABORATION',
    ];

    return Promise.all(types.map((t) => this.getPromptConfig(courseId, t)));
  }

  async updatePromptConfig(
    courseId: string,
    interventionType: InterventionType,
    teacherId: string,
    systemPrompt: string,
  ) {
    if (!systemPrompt || systemPrompt.trim().length < 50) {
      throw new BadRequestException('System prompt must be at least 50 characters');
    }

    if (systemPrompt.length > 10000) {
      throw new BadRequestException('System prompt must be less than 10000 characters');
    }

    const hasJsonInstruction =
      systemPrompt.toLowerCase().includes('json') && systemPrompt.toLowerCase().includes('format');

    await this.prisma.interventionPromptConfig.upsert({
      where: {
        courseId_interventionType: { courseId, interventionType },
      },
      create: {
        courseId,
        interventionType,
        teacherId,
        systemPrompt: systemPrompt.trim(),
        isCustom: true,
      },
      update: {
        systemPrompt: systemPrompt.trim(),
        isCustom: true,
      },
    });

    const config = await this.getPromptConfig(courseId, interventionType);
    return {
      ...config,
      warning: hasJsonInstruction
        ? null
        : 'Your prompt may not include JSON formatting instructions. The intervention may not work correctly.',
    };
  }

  async deletePromptConfig(courseId: string, interventionType: InterventionType) {
    await this.prisma.interventionPromptConfig
      .delete({
        where: {
          courseId_interventionType: { courseId, interventionType },
        },
      })
      .catch(() => {
        // If it doesn't exist, that's fine — already default
      });

    return this.getPromptConfig(courseId, interventionType);
  }

  async previewPrompt(
    userId: string,
    systemPrompt: string,
    sampleText: string,
    interventionType: InterventionType,
  ) {
    const defaults = DEFAULT_PROMPTS[interventionType];
    const userPrompt = defaults.userPromptTemplate
      .replace(/\{\{questionCount\}\}/g, '3')
      .replace(/\{\{cardCount\}\}/g, '3')
      .replace(/\{\{selectedText\}\}/g, sampleText);

    const resolvedSystem = systemPrompt
      .replace(/\{\{questionCount\}\}/g, '3')
      .replace(/\{\{cardCount\}\}/g, '3');

    const result = await this.llmService.callLlmForUser(userId, resolvedSystem, userPrompt);

    return {
      output: result.content,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    };
  }

  // ─── Practice Testing ─────────────────────────────────────

  async generatePracticeTest(
    userId: string,
    dto: GeneratePracticeTestDto,
  ): Promise<PracticeTestResult> {
    if (!dto.selectedText || dto.selectedText.trim().length < 20) {
      throw new BadRequestException('Selected text must be at least 20 characters');
    }

    if (!dto.courseId) {
      throw new BadRequestException('courseId is required');
    }

    const hasKey = await this.llmService.hasApiKey(userId);
    if (!hasKey) {
      throw new BadRequestException(
        'Please configure your OpenAI API key in Settings to use learning strategies.',
      );
    }

    const questionCount = Math.min(Math.max(dto.questionCount || 5, 1), 10);

    // Get system prompt (custom or default)
    const systemPrompt = await this.getSystemPrompt(dto.courseId, 'PRACTICE_TESTING');

    const { system, user } = buildPracticeTestingPrompt(
      systemPrompt,
      dto.selectedText,
      questionCount,
    );

    // Call LLM with retry on malformed JSON
    let questions: PracticeQuestion[];
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const result = await this.llmService.callLlmForUser(userId, system, user);
        const parsed = this.parseLlmJson(result.content);
        questions = this.validatePracticeTestResponse(parsed);
        break;
      } catch (err) {
        if (attempts >= maxAttempts) {
          this.logger.error('Practice test generation failed after retries', err);
          throw new BadRequestException('Failed to generate practice test. Please try again.');
        }
        this.logger.warn(`Practice test generation attempt ${attempts} failed, retrying...`);
      }
    }

    // Create LearningIntervention record
    const intervention = await this.prisma.learningIntervention.create({
      data: {
        userId,
        courseId: dto.courseId,
        contentId: dto.contentId || null,
        pageType: dto.pageType || null,
        type: 'PRACTICE_TESTING',
        status: 'IN_PROGRESS',
        selectedText: dto.selectedText,
        sessionData: { questions: questions! } as unknown as Prisma.InputJsonValue,
      },
    });

    // Return questions without answers
    return {
      interventionId: intervention.id,
      questions: questions!.map((q) => ({
        question: q.question,
        type: q.type,
        options: q.options,
      })),
    };
  }

  async submitPracticeTestAnswers(
    userId: string,
    interventionId: string,
    dto: SubmitPracticeTestAnswersDto,
  ): Promise<GradedResult> {
    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: interventionId },
    });

    if (!intervention) {
      throw new NotFoundException('Practice test not found');
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException('Cannot submit answers for another user');
    }

    if (intervention.status === 'COMPLETED') {
      throw new BadRequestException('Practice test already completed');
    }

    const sessionData = intervention.sessionData as unknown as {
      questions: PracticeQuestion[];
    };
    const questions = sessionData?.questions;

    if (!questions || !Array.isArray(questions)) {
      throw new BadRequestException('Invalid practice test data');
    }

    // Grade answers
    const results: GradedAnswer[] = questions.map((q, index) => {
      const submission = dto.answers.find((a) => a.questionIndex === index);
      const userAnswer = submission?.answer || '';
      const correct = this.gradeAnswer(q, userAnswer);

      return {
        questionIndex: index,
        question: q.question,
        type: q.type,
        userAnswer,
        correctAnswer: q.correctAnswer,
        correct,
        explanation: q.explanation,
        options: q.options,
      };
    });

    const correctCount = results.filter((r) => r.correct).length;
    const score = Math.round((correctCount / questions.length) * 100);

    // Update intervention status
    await this.prisma.learningIntervention.update({
      where: { id: interventionId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        sessionData: {
          questions,
          userAnswers: dto.answers,
          results,
          score,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      interventionId,
      score,
      totalQuestions: questions.length,
      results,
    };
  }

  async getPracticeTest(userId: string, interventionId: string) {
    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: interventionId },
    });

    if (!intervention) {
      throw new NotFoundException('Practice test not found');
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException("Cannot access another user's practice test");
    }

    const sessionData = intervention.sessionData as unknown as {
      questions: PracticeQuestion[];
      results?: GradedAnswer[];
      score?: number;
    };

    if (intervention.status === 'COMPLETED') {
      return {
        interventionId: intervention.id,
        status: intervention.status,
        questions: sessionData.questions,
        results: sessionData.results,
        score: sessionData.score,
        completedAt: intervention.completedAt,
      };
    }

    // In progress — don't reveal answers
    return {
      interventionId: intervention.id,
      status: intervention.status,
      questions: sessionData.questions.map((q) => ({
        question: q.question,
        type: q.type,
        options: q.options,
      })),
    };
  }

  // ─── Interrogative Elaboration ───────────────────────────

  async generateElaborationQuestions(
    userId: string,
    dto: GenerateElaborationDto,
  ): Promise<ElaborationSessionResult> {
    if (!dto.selectedText || dto.selectedText.trim().length < 20) {
      throw new BadRequestException('Selected text must be at least 20 characters');
    }

    if (!dto.courseId) {
      throw new BadRequestException('courseId is required');
    }

    const hasKey = await this.llmService.hasApiKey(userId);
    if (!hasKey) {
      throw new BadRequestException(
        'Please configure your OpenAI API key in Settings to use learning strategies.',
      );
    }

    const questionCount = Math.min(Math.max(dto.questionCount || 4, 2), 8);

    // Get system prompt (custom or default)
    const systemPrompt = await this.getSystemPrompt(dto.courseId, 'INTERROGATIVE_ELABORATION');

    const { system, user } = buildElaborationQuestionsPrompt(
      systemPrompt,
      dto.selectedText,
      questionCount,
    );

    // Call LLM with retry on malformed JSON
    let questions: ElaborationQuestion[];
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const result = await this.llmService.callLlmForUser(userId, system, user);
        const parsed = this.parseLlmJson(result.content);
        questions = this.validateElaborationResponse(parsed);
        break;
      } catch (err) {
        if (attempts >= maxAttempts) {
          this.logger.error('Elaboration question generation failed after retries', err);
          throw new BadRequestException(
            'Failed to generate elaboration questions. Please try again.',
          );
        }
        this.logger.warn(`Elaboration question generation attempt ${attempts} failed, retrying...`);
      }
    }

    // Create LearningIntervention record
    const intervention = await this.prisma.learningIntervention.create({
      data: {
        userId,
        courseId: dto.courseId,
        contentId: dto.contentId || null,
        pageType: dto.pageType || null,
        type: 'INTERROGATIVE_ELABORATION',
        status: 'IN_PROGRESS',
        selectedText: dto.selectedText,
        sessionData: {
          questions: questions!,
          selectedText: dto.selectedText,
          userElaborations: [],
        } as unknown as Prisma.InputJsonValue,
      },
    });

    // Return questions without key points (don't reveal expected answers)
    return {
      interventionId: intervention.id,
      questions: questions!.map((q) => ({
        question: q.question,
        type: q.type,
      })),
    };
  }

  async evaluateElaboration(
    userId: string,
    sessionId: string,
    dto: SubmitElaborationDto,
  ): Promise<ElaborationEvaluation> {
    if (!dto.elaboration || dto.elaboration.trim().length < 50) {
      throw new BadRequestException('Elaboration must be at least 50 characters');
    }

    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: sessionId },
    });

    if (!intervention) {
      throw new NotFoundException('Elaboration session not found');
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException('Cannot submit elaboration for another user');
    }

    if (intervention.type !== 'INTERROGATIVE_ELABORATION') {
      throw new BadRequestException('Invalid intervention type');
    }

    const sessionData = intervention.sessionData as unknown as ElaborationSessionData;
    const questions = sessionData?.questions;

    if (!questions || !Array.isArray(questions)) {
      throw new BadRequestException('Invalid elaboration session data');
    }

    if (dto.questionIndex < 0 || dto.questionIndex >= questions.length) {
      throw new BadRequestException('Invalid question index');
    }

    const question = questions[dto.questionIndex]!;

    // Call LLM with the evaluation prompt (fixed, not teacher-customizable)
    const { system, user } = buildElaborationEvaluationPrompt({
      question: question.question,
      userElaboration: dto.elaboration,
      keyPoints: question.keyPoints,
      sourceText: sessionData.selectedText,
    });

    let evaluation: ElaborationEvaluation;
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const result = await this.llmService.callLlmForUser(userId, system, user);
        const parsed = this.parseLlmJson(result.content);
        evaluation = this.validateElaborationEvaluation(parsed);
        break;
      } catch (err) {
        if (attempts >= maxAttempts) {
          this.logger.error('Elaboration evaluation failed after retries', err);
          throw new BadRequestException('Failed to evaluate elaboration. Please try again.');
        }
        this.logger.warn(`Elaboration evaluation attempt ${attempts} failed, retrying...`);
      }
    }

    // Update session data with user's elaboration
    const updatedElaborations = [...sessionData.userElaborations];
    // Replace existing elaboration for this question (supports revision)
    const existingIdx = updatedElaborations.findIndex((e) => e.questionIndex === dto.questionIndex);
    const elaborationEntry = {
      questionIndex: dto.questionIndex,
      elaboration: dto.elaboration,
      rating: evaluation!.rating,
      addressedPoints: evaluation!.addressedPoints,
      missedPoints: evaluation!.missedPoints,
      feedback: evaluation!.feedback,
      modelElaboration: evaluation!.modelElaboration,
    };

    if (existingIdx >= 0) {
      updatedElaborations[existingIdx] = elaborationEntry;
    } else {
      updatedElaborations.push(elaborationEntry);
    }

    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: {
        sessionData: {
          ...sessionData,
          userElaborations: updatedElaborations,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return evaluation!;
  }

  async completeElaborationSession(userId: string, sessionId: string) {
    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: sessionId },
    });

    if (!intervention) {
      throw new NotFoundException('Elaboration session not found');
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException("Cannot complete another user's session");
    }

    if (intervention.type !== 'INTERROGATIVE_ELABORATION') {
      throw new BadRequestException('Invalid intervention type');
    }

    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    const sessionData = intervention.sessionData as unknown as ElaborationSessionData;

    return {
      interventionId: sessionId,
      status: 'COMPLETED',
      questions: sessionData.questions.map((q) => ({
        question: q.question,
        type: q.type,
      })),
      userElaborations: sessionData.userElaborations,
    };
  }

  async getElaborationSession(userId: string, sessionId: string) {
    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: sessionId },
    });

    if (!intervention) {
      throw new NotFoundException('Elaboration session not found');
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException("Cannot access another user's elaboration session");
    }

    if (intervention.type !== 'INTERROGATIVE_ELABORATION') {
      throw new BadRequestException('Invalid intervention type');
    }

    const sessionData = intervention.sessionData as unknown as ElaborationSessionData;

    return {
      interventionId: intervention.id,
      status: intervention.status,
      questions: sessionData.questions.map((q) => ({
        question: q.question,
        type: q.type,
      })),
      userElaborations: sessionData.userElaborations,
      completedAt: intervention.completedAt,
    };
  }

  // ─── Private Helpers ──────────────────────────────────────

  private parseLlmJson(content: string): unknown {
    // Try to extract JSON from possibly markdown-wrapped response
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

  private validatePracticeTestResponse(parsed: unknown): PracticeQuestion[] {
    const data = parsed as { questions?: unknown[] };

    if (!data?.questions || !Array.isArray(data.questions) || data.questions.length === 0) {
      throw new Error('LLM response missing questions array');
    }

    return data.questions.map((q: unknown) => {
      const item = q as Record<string, unknown>;
      if (!item.question || !item.type || !item.correctAnswer) {
        throw new Error('Invalid question structure in LLM response');
      }

      return {
        question: String(item.question),
        type: item.type === 'short_answer' ? 'short_answer' : 'mcq',
        options: Array.isArray(item.options) ? item.options.map(String) : undefined,
        correctAnswer: String(item.correctAnswer),
        explanation: String(item.explanation || ''),
        keywords: Array.isArray(item.keywords) ? item.keywords.map(String) : undefined,
      } as PracticeQuestion;
    });
  }

  private validateElaborationResponse(parsed: unknown): ElaborationQuestion[] {
    const data = parsed as { questions?: unknown[] };

    if (!data?.questions || !Array.isArray(data.questions) || data.questions.length === 0) {
      throw new Error('LLM response missing questions array');
    }

    return data.questions.map((q: unknown) => {
      const item = q as Record<string, unknown>;
      if (!item.question || !item.type) {
        throw new Error('Invalid elaboration question structure in LLM response');
      }

      const type = String(item.type).toLowerCase();

      return {
        question: String(item.question),
        type: type === 'how' ? 'how' : 'why',
        keyPoints: Array.isArray(item.keyPoints) ? item.keyPoints.map(String) : [],
      } as ElaborationQuestion;
    });
  }

  private validateElaborationEvaluation(parsed: unknown): ElaborationEvaluation {
    const data = parsed as Record<string, unknown>;

    if (!data?.rating || !data?.feedback) {
      throw new Error('Invalid elaboration evaluation response');
    }

    return {
      rating: String(data.rating),
      addressedPoints: Array.isArray(data.addressedPoints) ? data.addressedPoints.map(String) : [],
      missedPoints: Array.isArray(data.missedPoints) ? data.missedPoints.map(String) : [],
      feedback: String(data.feedback),
      modelElaboration: String(data.modelElaboration || ''),
    };
  }

  private gradeAnswer(question: PracticeQuestion, userAnswer: string): boolean {
    if (!userAnswer.trim()) return false;

    if (question.type === 'mcq') {
      // Extract just the letter (A, B, C, D) for comparison
      const normalize = (s: string) =>
        s
          .trim()
          .toUpperCase()
          .replace(/[^A-D]/g, '')
          .charAt(0);
      return normalize(userAnswer) === normalize(question.correctAnswer);
    }

    // Short answer: keyword matching
    if (question.keywords && question.keywords.length > 0) {
      const answerLower = userAnswer.toLowerCase();
      const matchedKeywords = question.keywords.filter((kw) =>
        answerLower.includes(kw.toLowerCase()),
      );
      // Require at least half the keywords
      return matchedKeywords.length >= Math.ceil(question.keywords.length / 2);
    }

    // Fallback: simple string similarity
    const answerLower = userAnswer.toLowerCase().trim();
    const correctLower = question.correctAnswer.toLowerCase().trim();
    return answerLower.includes(correctLower) || correctLower.includes(answerLower);
  }

  // ─── Saved Reviews CRUD ──────────────────────────────────

  async createSavedReview(userId: string, dto: CreateSavedReviewDto) {
    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: dto.interventionId },
    });

    if (!intervention) {
      throw new NotFoundException(`Intervention ${dto.interventionId} not found`);
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException('Cannot save a review for another user');
    }

    return this.prisma.savedInterventionReview.create({
      data: {
        userId,
        interventionId: dto.interventionId,
        interventionType: dto.interventionType,
        courseId: dto.courseId,
        contentId: dto.contentId || null,
        pageType: dto.pageType || null,
        title: dto.title,
        selectedText: dto.selectedText,
        savedData: dto.savedData as Prisma.InputJsonValue,
        notes: dto.notes || null,
      },
    });
  }

  async findAllSavedReviews(
    userId: string,
    filters: {
      interventionType?: InterventionType;
      courseId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.SavedInterventionReviewWhereInput = { userId };

    if (filters.interventionType) {
      where.interventionType = filters.interventionType;
    }

    if (filters.courseId) {
      where.courseId = filters.courseId;
    }

    const [items, total] = await Promise.all([
      this.prisma.savedInterventionReview.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          interventionId: true,
          interventionType: true,
          courseId: true,
          contentId: true,
          pageType: true,
          title: true,
          selectedText: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.savedInterventionReview.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOneSavedReview(userId: string, id: string) {
    const review = await this.prisma.savedInterventionReview.findUnique({
      where: { id },
    });

    if (!review) {
      throw new NotFoundException(`Saved review ${id} not found`);
    }

    if (review.userId !== userId) {
      throw new ForbiddenException("Cannot access another user's review");
    }

    return review;
  }

  async updateSavedReview(userId: string, id: string, dto: UpdateSavedReviewDto) {
    const review = await this.prisma.savedInterventionReview.findUnique({
      where: { id },
    });

    if (!review) {
      throw new NotFoundException(`Saved review ${id} not found`);
    }

    if (review.userId !== userId) {
      throw new ForbiddenException("Cannot update another user's review");
    }

    const data: Prisma.SavedInterventionReviewUpdateInput = {};
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.title !== undefined) data.title = dto.title;

    return this.prisma.savedInterventionReview.update({
      where: { id },
      data,
    });
  }

  async deleteSavedReview(userId: string, id: string) {
    const review = await this.prisma.savedInterventionReview.findUnique({
      where: { id },
    });

    if (!review) {
      throw new NotFoundException(`Saved review ${id} not found`);
    }

    if (review.userId !== userId) {
      throw new ForbiddenException("Cannot delete another user's review");
    }

    await this.prisma.savedInterventionReview.delete({ where: { id } });

    return { deleted: true };
  }
}
