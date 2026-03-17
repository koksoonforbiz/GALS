import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../rag/llm.service';
import { ActivityLogService, ActivityAction } from '../activity-log';
import type { InterventionType, Prisma } from '@prisma/client';
import type {
  CreateSavedReviewDto,
  UpdateSavedReviewDto,
  GeneratePracticeTestDto,
  SubmitPracticeTestAnswersDto,
  GenerateSuggestionsDto,
  AskQuestionDto,
  GenerateStepwiseDto,
  SubmitStepCheckDto,
  GenerateCardsDto,
  ReviewCardDto,
  ChatRequestDto,
} from './dto';
import { RagService } from '../rag/rag.service';
import { DEFAULT_PROMPTS } from './prompts/default-prompts';
import {
  buildPracticeTestingPrompt,
  buildPracticeAnswerCheckPrompt,
} from './prompts/practice-testing.prompt';
import {
  buildQuestionSuggestionPrompt,
  buildElaborationAnswerPrompt,
  buildConversationSummaryPrompt,
} from './prompts/interrogative-elaboration.prompt';
import {
  buildStepwiseLearningPrompt,
  buildStepCheckPrompt,
} from './prompts/stepwise-learning.prompt';
import { buildDistributedPracticePrompt } from './prompts/distributed-practice.prompt';
import {
  calculateNextReview,
  previewAllRatings,
  QUALITY_MAP,
  type QualityRating,
} from './utils/sm2-algorithm';

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
  feedback?: string;
  options?: string[];
}

interface GradedResult {
  interventionId: string;
  score: number;
  totalQuestions: number;
  results: GradedAnswer[];
}

// ─── Interrogative Elaboration Interfaces ───────────────

interface SuggestedQuestion {
  question: string;
  type: 'why' | 'how';
  topic: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  wasSuggested?: boolean;
}

interface ElaborationSessionData {
  suggestedQuestions: SuggestedQuestion[];
  keyConcepts: string[];
  conversation: ConversationMessage[];
  selectedText: string;
  questionsAsked: number;
}

interface SuggestionResult {
  interventionId: string;
  suggestedQuestions: SuggestedQuestion[];
  keyConcepts: string[];
}

// ─── Stepwise Learning Interfaces ────────────────────────

interface StepwiseComprehensionCheck {
  question: string;
  hint: string;
  sampleAnswer: string;
}

interface StepwiseStep {
  stepNumber: number;
  title: string;
  content: string;
  comprehensionCheck: StepwiseComprehensionCheck;
}

interface StepUserResponse {
  response: string;
  feedback: string;
  isCorrect: boolean;
  timestamp: string;
}

interface StepResult {
  attempts: number;
  passed: boolean;
  userResponses: StepUserResponse[];
}

interface StepwiseSessionData {
  steps: StepwiseStep[];
  summary: string;
  currentStep: number;
  selectedText: string;
  stepResults: Record<number, StepResult>;
}

interface StepCheckResponse {
  isCorrect: boolean;
  feedback: string;
  encouragement: string;
  attempts: number;
  showAnswer: boolean;
  sampleAnswer?: string;
}

// ─── Distributed Practice Interfaces ─────────────────────

interface FlashcardData {
  front: string;
  back: string;
}

interface ConversationSummary {
  summary: string;
  conceptsCovered: string[];
  questionsAsked: number;
  depthRating: 'surface' | 'moderate' | 'deep';
}

@Injectable()
export class LearningInterventionsService {
  private readonly logger = new Logger(LearningInterventionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly ragService: RagService,
    private readonly activityLogService: ActivityLogService,
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

    const result = await this.llmService.callLlmForUser(userId, resolvedSystem, userPrompt, {
      feature: 'prompt_preview',
    });

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
    sessionId?: string,
  ): Promise<PracticeTestResult> {
    if (!dto.selectedText || dto.selectedText.trim().length < 20) {
      throw new BadRequestException('Selected text must be at least 20 characters');
    }

    if (!dto.courseId) {
      throw new BadRequestException('courseId is required');
    }

    const teacherId = await this.getCourseTeacherIdWithApiKey(dto.courseId);

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
        const result = await this.llmService.callLlmForUser(teacherId, system, user, {
          feature: 'practice_testing',
          courseId: dto.courseId,
          triggeredByUserId: userId,
        });
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

    if (sessionId) {
      void this.activityLogService.record({
        sessionId,
        userId,
        action: ActivityAction.INTERVENTION_TRIGGERED,
        interventionId: intervention.id,
        metadata: {
          interventionType: 'PRACTICE_TESTING',
          triggerReason: 'student_initiated',
          summary: `Intervention triggered: PRACTICE_TESTING`,
        },
      });
    }

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

    const teacherId = await this.getCourseTeacherIdWithApiKey(intervention.courseId);

    // Grade answers — MCQs deterministically, short answers via LLM
    const results: GradedAnswer[] = await Promise.all(
      questions.map(async (q, index) => {
        const submission = dto.answers.find((a) => a.questionIndex === index);
        const userAnswer = submission?.answer || '';

        if (q.type === 'short_answer' && userAnswer.trim()) {
          // LLM-based grading for open-ended answers
          const llmResult = await this.gradeShortAnswerWithLlm(
            teacherId,
            userId,
            intervention.courseId,
            q,
            userAnswer,
            intervention.selectedText || '',
          );
          return {
            questionIndex: index,
            question: q.question,
            type: q.type,
            userAnswer,
            correctAnswer: q.correctAnswer,
            correct: llmResult.isCorrect,
            explanation: q.explanation,
            feedback: llmResult.feedback,
            options: q.options,
          };
        }

        // MCQ or empty answer — use deterministic grading
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
      }),
    );

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

  // ─── Interrogative Elaboration (Conversational Q&A) ─────

  async generateSuggestions(
    userId: string,
    dto: GenerateSuggestionsDto,
    sessionId?: string,
  ): Promise<SuggestionResult> {
    if (!dto.selectedText || dto.selectedText.trim().length < 20) {
      throw new BadRequestException('Selected text must be at least 20 characters');
    }

    if (!dto.courseId) {
      throw new BadRequestException('courseId is required');
    }

    const teacherId = await this.getCourseTeacherIdWithApiKey(dto.courseId);

    const questionCount = Math.min(Math.max(dto.questionCount || 6, 3), 10);

    // Get system prompt (custom or default)
    const systemPrompt = await this.getSystemPrompt(dto.courseId, 'INTERROGATIVE_ELABORATION');

    const { system, user } = buildQuestionSuggestionPrompt(
      systemPrompt,
      dto.selectedText,
      questionCount,
    );

    // Call LLM with retry on malformed JSON
    let suggestedQuestions: SuggestedQuestion[];
    let keyConcepts: string[] = [];
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const result = await this.llmService.callLlmForUser(teacherId, system, user, {
          feature: 'interrogative_elaboration',
          courseId: dto.courseId,
          triggeredByUserId: userId,
        });
        const parsed = this.parseLlmJson(result.content);
        const validated = this.validateSuggestionResponse(parsed);
        suggestedQuestions = validated.suggestedQuestions;
        keyConcepts = validated.keyConcepts;
        break;
      } catch (err) {
        if (attempts >= maxAttempts) {
          this.logger.error('Question suggestion generation failed after retries', err);
          throw new BadRequestException(
            'Failed to generate question suggestions. Please try again.',
          );
        }
        this.logger.warn(`Question suggestion attempt ${attempts} failed, retrying...`);
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
          suggestedQuestions: suggestedQuestions!,
          keyConcepts,
          conversation: [],
          selectedText: dto.selectedText,
          questionsAsked: 0,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    if (sessionId) {
      void this.activityLogService.record({
        sessionId,
        userId,
        action: ActivityAction.INTERVENTION_TRIGGERED,
        interventionId: intervention.id,
        metadata: {
          interventionType: 'INTERROGATIVE_ELABORATION',
          triggerReason: 'student_initiated',
          summary: `Intervention triggered: INTERROGATIVE_ELABORATION`,
        },
      });
    }

    return {
      interventionId: intervention.id,
      suggestedQuestions: suggestedQuestions!,
      keyConcepts,
    };
  }

  async askQuestion(
    userId: string,
    sessionId: string,
    dto: AskQuestionDto,
  ): Promise<{ answer: string }> {
    if (!dto.question || dto.question.trim().length < 5) {
      throw new BadRequestException('Question must be at least 5 characters');
    }

    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: sessionId },
    });

    if (!intervention) {
      throw new NotFoundException('Elaboration session not found');
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException("Cannot interact with another user's session");
    }

    if (intervention.type !== 'INTERROGATIVE_ELABORATION') {
      throw new BadRequestException('Invalid intervention type');
    }

    const teacherId = await this.getCourseTeacherIdWithApiKey(intervention.courseId);

    const sessionData = intervention.sessionData as unknown as ElaborationSessionData;

    // Build the answer prompt with conversation history
    const { system, user } = buildElaborationAnswerPrompt({
      sourceText: sessionData.selectedText,
      conversationHistory: dto.conversationHistory || [],
      studentQuestion: dto.question,
    });

    let answer: string;
    try {
      const result = await this.llmService.callLlmForUser(teacherId, system, user, {
        feature: 'interrogative_elaboration',
        courseId: intervention.courseId,
        triggeredByUserId: userId,
      });
      answer = result.content;
    } catch {
      throw new BadRequestException('Failed to generate answer. Please try again.');
    }

    // Append both messages to the conversation
    const now = new Date().toISOString();
    const updatedConversation = [
      ...sessionData.conversation,
      { role: 'user' as const, content: dto.question, timestamp: now },
      { role: 'assistant' as const, content: answer, timestamp: now },
    ];

    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: {
        sessionData: {
          ...sessionData,
          conversation: updatedConversation,
          questionsAsked: sessionData.questionsAsked + 1,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return { answer };
  }

  async completeElaborationSession(
    userId: string,
    sessionId: string,
  ): Promise<ConversationSummary> {
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

    const sessionData = intervention.sessionData as unknown as ElaborationSessionData;

    // Generate conversation summary via LLM
    let summary: ConversationSummary;

    if (sessionData.conversation.length >= 2) {
      try {
        const teacherId = await this.getCourseTeacherIdWithApiKey(intervention.courseId);
        const { system, user } = buildConversationSummaryPrompt({
          sourceText: sessionData.selectedText,
          conversation: sessionData.conversation,
        });
        const result = await this.llmService.callLlmForUser(teacherId, system, user, {
          feature: 'interrogative_elaboration',
          courseId: intervention.courseId,
          triggeredByUserId: userId,
        });
        const parsed = this.parseLlmJson(result.content);
        summary = this.validateConversationSummary(parsed);
      } catch {
        // Fallback summary if LLM fails
        summary = {
          summary: 'The student explored the text through questions and answers.',
          conceptsCovered: sessionData.keyConcepts.slice(0, 3),
          questionsAsked: sessionData.questionsAsked,
          depthRating: sessionData.questionsAsked >= 3 ? 'moderate' : 'surface',
        };
      }
    } else {
      summary = {
        summary: 'Session completed without asking questions.',
        conceptsCovered: [],
        questionsAsked: 0,
        depthRating: 'surface',
      };
    }

    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    return summary;
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
      suggestedQuestions: sessionData.suggestedQuestions,
      keyConcepts: sessionData.keyConcepts,
      conversation: sessionData.conversation,
      questionsAsked: sessionData.questionsAsked,
      completedAt: intervention.completedAt,
    };
  }

  // ─── Stepwise Learning ──────────────────────────────────

  async generateSteps(
    userId: string,
    dto: GenerateStepwiseDto,
    sessionId?: string,
  ): Promise<{
    interventionId: string;
    steps: Array<{ stepNumber: number; title: string }>;
    totalSteps: number;
  }> {
    if (!dto.selectedText || dto.selectedText.trim().length < 20) {
      throw new BadRequestException('Selected text must be at least 20 characters');
    }

    if (!dto.courseId) {
      throw new BadRequestException('courseId is required');
    }

    const teacherId = await this.getCourseTeacherIdWithApiKey(dto.courseId);

    const systemPrompt = await this.getSystemPrompt(dto.courseId, 'STEPWISE_LEARNING');
    const { system, user } = buildStepwiseLearningPrompt(systemPrompt, dto.selectedText);

    let steps: StepwiseStep[];
    let summary = '';
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const result = await this.llmService.callLlmForUser(teacherId, system, user, {
          feature: 'stepwise_learning',
          courseId: dto.courseId,
          triggeredByUserId: userId,
        });
        const parsed = this.parseLlmJson(result.content);
        const validated = this.validateStepwiseResponse(parsed);
        steps = validated.steps;
        summary = validated.summary;
        break;
      } catch (err) {
        if (attempts >= maxAttempts) {
          this.logger.error('Stepwise learning generation failed after retries', err);
          throw new BadRequestException('Failed to generate learning steps. Please try again.');
        }
        this.logger.warn(`Stepwise generation attempt ${attempts} failed, retrying...`);
      }
    }

    const intervention = await this.prisma.learningIntervention.create({
      data: {
        userId,
        courseId: dto.courseId,
        contentId: dto.contentId || null,
        pageType: dto.pageType || null,
        type: 'STEPWISE_LEARNING',
        status: 'IN_PROGRESS',
        selectedText: dto.selectedText,
        sessionData: {
          steps: steps!,
          summary,
          currentStep: 1,
          selectedText: dto.selectedText,
          stepResults: {},
        } as unknown as Prisma.InputJsonValue,
      },
    });

    if (sessionId) {
      void this.activityLogService.record({
        sessionId,
        userId,
        action: ActivityAction.INTERVENTION_TRIGGERED,
        interventionId: intervention.id,
        metadata: {
          interventionType: 'STEPWISE_LEARNING',
          triggerReason: 'student_initiated',
          summary: `Intervention triggered: STEPWISE_LEARNING`,
        },
      });
    }

    return {
      interventionId: intervention.id,
      steps: steps!.map((s) => ({ stepNumber: s.stepNumber, title: s.title })),
      totalSteps: steps!.length,
    };
  }

  async checkStepResponse(
    userId: string,
    sessionId: string,
    dto: SubmitStepCheckDto,
  ): Promise<StepCheckResponse> {
    if (!dto.userResponse || dto.userResponse.trim().length < 10) {
      throw new BadRequestException('Response must be at least 10 characters');
    }

    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: sessionId },
    });

    if (!intervention) {
      throw new NotFoundException('Stepwise session not found');
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException("Cannot interact with another user's session");
    }

    if (intervention.type !== 'STEPWISE_LEARNING') {
      throw new BadRequestException('Invalid intervention type');
    }

    if (intervention.status === 'COMPLETED') {
      throw new BadRequestException('Session already completed');
    }

    const sessionData = intervention.sessionData as unknown as StepwiseSessionData;
    const step = sessionData.steps.find((s) => s.stepNumber === dto.stepNumber);

    if (!step) {
      throw new BadRequestException(`Step ${dto.stepNumber} not found`);
    }

    const existingResult = sessionData.stepResults[dto.stepNumber];
    if (existingResult?.passed) {
      throw new BadRequestException(`Step ${dto.stepNumber} already passed`);
    }

    const currentAttempts = (existingResult?.attempts || 0) + 1;
    const maxAttemptsAllowed = 2;

    const teacherId = await this.getCourseTeacherIdWithApiKey(intervention.courseId);

    const { system, user } = buildStepCheckPrompt({
      stepTitle: step.title,
      stepContent: step.content,
      question: step.comprehensionCheck.question,
      sampleAnswer: step.comprehensionCheck.sampleAnswer,
      userResponse: dto.userResponse,
    });

    let isCorrect = false;
    let feedback = '';
    let encouragement = '';

    try {
      const result = await this.llmService.callLlmForUser(teacherId, system, user, {
        feature: 'stepwise_learning',
        courseId: intervention.courseId,
        triggeredByUserId: userId,
      });
      const parsed = this.parseLlmJson(result.content);
      const validated = this.validateStepCheckResponse(parsed);
      isCorrect = validated.isCorrect;
      feedback = validated.feedback;
      encouragement = validated.encouragement;
    } catch {
      feedback = 'We had trouble evaluating your answer. Please try again.';
      encouragement = 'Keep going!';
    }

    const showAnswer = !isCorrect && currentAttempts >= maxAttemptsAllowed;

    const userResponse: StepUserResponse = {
      response: dto.userResponse,
      feedback,
      isCorrect,
      timestamp: new Date().toISOString(),
    };

    const updatedResult: StepResult = {
      attempts: currentAttempts,
      passed: isCorrect,
      userResponses: [...(existingResult?.userResponses || []), userResponse],
    };

    // If showing answer after max attempts, mark as passed so student can proceed
    if (showAnswer) {
      updatedResult.passed = true;
    }

    const updatedStepResults = {
      ...sessionData.stepResults,
      [dto.stepNumber]: updatedResult,
    };

    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: {
        sessionData: {
          ...sessionData,
          stepResults: updatedStepResults,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      isCorrect,
      feedback,
      encouragement,
      attempts: currentAttempts,
      showAnswer,
      sampleAnswer: showAnswer ? step.comprehensionCheck.sampleAnswer : undefined,
    };
  }

  async advanceStep(
    userId: string,
    sessionId: string,
  ): Promise<{ currentStep: number; totalSteps: number; step: StepwiseStep; completed: boolean }> {
    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: sessionId },
    });

    if (!intervention) {
      throw new NotFoundException('Stepwise session not found');
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException("Cannot interact with another user's session");
    }

    if (intervention.type !== 'STEPWISE_LEARNING') {
      throw new BadRequestException('Invalid intervention type');
    }

    const sessionData = intervention.sessionData as unknown as StepwiseSessionData;
    const currentResult = sessionData.stepResults[sessionData.currentStep];

    if (!currentResult?.passed) {
      throw new BadRequestException('Must pass the current step before advancing');
    }

    const nextStep = sessionData.currentStep + 1;
    const totalSteps = sessionData.steps.length;
    const completed = nextStep > totalSteps;

    if (completed) {
      await this.prisma.learningIntervention.update({
        where: { id: sessionId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          sessionData: {
            ...sessionData,
            currentStep: totalSteps,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      return {
        currentStep: totalSteps,
        totalSteps,
        step: sessionData.steps[totalSteps - 1]!,
        completed: true,
      };
    }

    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: {
        sessionData: {
          ...sessionData,
          currentStep: nextStep,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      currentStep: nextStep,
      totalSteps,
      step: sessionData.steps[nextStep - 1]!,
      completed: false,
    };
  }

  async getStepwiseSession(userId: string, sessionId: string) {
    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: sessionId },
    });

    if (!intervention) {
      throw new NotFoundException('Stepwise session not found');
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException("Cannot access another user's session");
    }

    if (intervention.type !== 'STEPWISE_LEARNING') {
      throw new BadRequestException('Invalid intervention type');
    }

    const sessionData = intervention.sessionData as unknown as StepwiseSessionData;

    return {
      interventionId: intervention.id,
      status: intervention.status,
      steps: sessionData.steps,
      summary: sessionData.summary,
      currentStep: sessionData.currentStep,
      totalSteps: sessionData.steps.length,
      stepResults: sessionData.stepResults,
      completedAt: intervention.completedAt,
    };
  }

  async completeStepwiseSession(userId: string, sessionId: string) {
    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: sessionId },
    });

    if (!intervention) {
      throw new NotFoundException('Stepwise session not found');
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException("Cannot complete another user's session");
    }

    if (intervention.type !== 'STEPWISE_LEARNING') {
      throw new BadRequestException('Invalid intervention type');
    }

    const sessionData = intervention.sessionData as unknown as StepwiseSessionData;
    const stepsCompleted = Object.values(sessionData.stepResults).filter((r) => r.passed).length;

    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    return {
      summary: sessionData.summary,
      totalSteps: sessionData.steps.length,
      stepsCompleted,
    };
  }

  // ─── Distributed Practice ─────────────────────────────────

  async generateCards(userId: string, dto: GenerateCardsDto, sessionId?: string) {
    if (!dto.selectedText || dto.selectedText.trim().length < 20) {
      throw new BadRequestException('Selected text must be at least 20 characters');
    }

    if (!dto.courseId) {
      throw new BadRequestException('courseId is required');
    }

    const teacherId = await this.getCourseTeacherIdWithApiKey(dto.courseId);
    const cardCount = Math.min(Math.max(dto.cardCount || 5, 1), 15);

    const systemPrompt = await this.getSystemPrompt(dto.courseId, 'DISTRIBUTED_PRACTICE');
    const { system, user } = buildDistributedPracticePrompt(
      systemPrompt,
      dto.selectedText,
      cardCount,
    );

    let cards: FlashcardData[];
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const result = await this.llmService.callLlmForUser(teacherId, system, user, {
          feature: 'distributed_practice',
          courseId: dto.courseId,
          triggeredByUserId: userId,
        });
        const parsed = this.parseLlmJson(result.content);
        cards = this.validateFlashcardResponse(parsed);
        break;
      } catch (err) {
        if (attempts >= maxAttempts) {
          this.logger.error('Flashcard generation failed after retries', err);
          throw new BadRequestException('Failed to generate flashcards. Please try again.');
        }
        this.logger.warn(`Flashcard generation attempt ${attempts} failed, retrying...`);
      }
    }

    // Create LearningIntervention record
    const intervention = await this.prisma.learningIntervention.create({
      data: {
        userId,
        courseId: dto.courseId,
        contentId: dto.contentId || null,
        pageType: dto.pageType || null,
        type: 'DISTRIBUTED_PRACTICE',
        status: 'COMPLETED',
        selectedText: dto.selectedText,
        completedAt: new Date(),
        sessionData: { cards: cards! } as unknown as Prisma.InputJsonValue,
      },
    });

    // Create SpacedRepetitionCard records — first review tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const createdCards = await Promise.all(
      cards!.map((card) =>
        this.prisma.spacedRepetitionCard.create({
          data: {
            userId,
            interventionId: intervention.id,
            courseId: dto.courseId,
            front: card.front,
            back: card.back,
            ease: 2.5,
            interval: 0,
            repetitions: 0,
            nextReviewAt: tomorrow,
          },
        }),
      ),
    );

    if (sessionId) {
      void this.activityLogService.record({
        sessionId,
        userId,
        action: ActivityAction.INTERVENTION_TRIGGERED,
        interventionId: intervention.id,
        metadata: {
          interventionType: 'DISTRIBUTED_PRACTICE',
          triggerReason: 'student_initiated',
          summary: `Intervention triggered: DISTRIBUTED_PRACTICE`,
        },
      });
    }

    return {
      interventionId: intervention.id,
      cards: createdCards.map((c) => ({ id: c.id, front: c.front, back: c.back })),
      totalCreated: createdCards.length,
    };
  }

  async getDueCards(userId: string, limit: number, courseId?: string) {
    const where: Prisma.SpacedRepetitionCardWhereInput = {
      userId,
      nextReviewAt: { lte: new Date() },
    };

    if (courseId) {
      where.courseId = courseId;
    }

    const cards = await this.prisma.spacedRepetitionCard.findMany({
      where,
      orderBy: { nextReviewAt: 'asc' },
      take: Math.min(limit || 20, 50),
    });

    return {
      cards: cards.map((c) => ({
        id: c.id,
        front: c.front,
        back: c.back,
        ease: c.ease,
        interval: c.interval,
        repetitions: c.repetitions,
        nextReviewAt: c.nextReviewAt,
        courseId: c.courseId,
      })),
      total: cards.length,
    };
  }

  async reviewCard(userId: string, cardId: string, dto: ReviewCardDto, sessionId?: string) {
    const card = await this.prisma.spacedRepetitionCard.findUnique({
      where: { id: cardId },
    });

    if (!card) {
      throw new NotFoundException('Card not found');
    }

    if (card.userId !== userId) {
      throw new ForbiddenException("Cannot review another user's card");
    }

    const validQualities: QualityRating[] = ['again', 'hard', 'good', 'easy'];
    if (!validQualities.includes(dto.quality)) {
      throw new BadRequestException('Invalid quality rating');
    }

    const quality = QUALITY_MAP[dto.quality];
    const result = calculateNextReview(quality, {
      ease: card.ease,
      interval: card.interval,
      repetitions: card.repetitions,
    });

    await this.prisma.spacedRepetitionCard.update({
      where: { id: cardId },
      data: {
        ease: result.ease,
        interval: result.interval,
        repetitions: result.repetitions,
        nextReviewAt: result.nextReviewAt,
        lastReviewedAt: new Date(),
      },
    });

    if (sessionId) {
      void this.activityLogService.record({
        sessionId,
        userId,
        action: ActivityAction.SPACED_REP_CARD_RATED,
        metadata: {
          cardId: card.id,
          rating: quality,
          nextReviewAt: result.nextReviewAt?.toISOString(),
          summary: `Flashcard rated: ${quality}/5`,
        },
      });
    }

    return {
      nextReviewAt: result.nextReviewAt,
      interval: result.interval,
      ease: result.ease,
    };
  }

  async getCardStats(userId: string) {
    const now = new Date();
    const endOfWeek = new Date();
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    const [totalCards, dueToday, dueThisWeek, cardsByStage] = await Promise.all([
      this.prisma.spacedRepetitionCard.count({ where: { userId } }),
      this.prisma.spacedRepetitionCard.count({
        where: { userId, nextReviewAt: { lte: now } },
      }),
      this.prisma.spacedRepetitionCard.count({
        where: { userId, nextReviewAt: { lte: endOfWeek } },
      }),
      this.prisma.spacedRepetitionCard.findMany({
        where: { userId },
        select: { repetitions: true, interval: true },
      }),
    ]);

    // Categorize cards by stage
    let newCount = 0;
    let learningCount = 0;
    let matureCount = 0;
    for (const card of cardsByStage) {
      if (card.repetitions === 0) newCount++;
      else if (card.interval < 21) learningCount++;
      else matureCount++;
    }

    return {
      totalCards,
      dueToday,
      dueThisWeek,
      cardsByStage: { new: newCount, learning: learningCount, mature: matureCount },
    };
  }

  async previewCardRatings(userId: string, cardId: string) {
    const card = await this.prisma.spacedRepetitionCard.findUnique({
      where: { id: cardId },
    });

    if (!card) {
      throw new NotFoundException('Card not found');
    }

    if (card.userId !== userId) {
      throw new ForbiddenException("Cannot preview another user's card");
    }

    const previews = previewAllRatings({
      ease: card.ease,
      interval: card.interval,
      repetitions: card.repetitions,
    });

    return {
      again: { nextReviewAt: previews.again.nextReviewAt, interval: previews.again.interval },
      hard: { nextReviewAt: previews.hard.nextReviewAt, interval: previews.hard.interval },
      good: { nextReviewAt: previews.good.nextReviewAt, interval: previews.good.interval },
      easy: { nextReviewAt: previews.easy.nextReviewAt, interval: previews.easy.interval },
    };
  }

  async deleteCard(userId: string, cardId: string) {
    const card = await this.prisma.spacedRepetitionCard.findUnique({
      where: { id: cardId },
    });

    if (!card) {
      throw new NotFoundException('Card not found');
    }

    if (card.userId !== userId) {
      throw new ForbiddenException("Cannot delete another user's card");
    }

    await this.prisma.spacedRepetitionCard.delete({ where: { id: cardId } });

    return { deleted: true };
  }

  // ─── Private Helpers ──────────────────────────────────────

  /**
   * Resolve the teacher who owns a course and verify they have an LLM API key.
   * Learning interventions use the course teacher's API key, not the student's.
   */
  private async getCourseTeacherIdWithApiKey(courseId: string): Promise<string> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    const hasKey = await this.llmService.hasApiKey(course.teacherId);
    if (!hasKey) {
      throw new BadRequestException(
        'The course instructor has not configured an LLM API key. Please contact your instructor.',
      );
    }

    return course.teacherId;
  }

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

  private validateSuggestionResponse(parsed: unknown): {
    suggestedQuestions: SuggestedQuestion[];
    keyConcepts: string[];
  } {
    const data = parsed as { suggestedQuestions?: unknown[]; keyConcepts?: unknown[] };

    if (
      !data?.suggestedQuestions ||
      !Array.isArray(data.suggestedQuestions) ||
      data.suggestedQuestions.length === 0
    ) {
      throw new Error('LLM response missing suggestedQuestions array');
    }

    const suggestedQuestions = data.suggestedQuestions.map((q: unknown) => {
      const item = q as Record<string, unknown>;
      if (!item.question || !item.type) {
        throw new Error('Invalid suggested question structure in LLM response');
      }

      const type = String(item.type).toLowerCase();
      const difficulty = String(item.difficulty || 'intermediate').toLowerCase();

      return {
        question: String(item.question),
        type: type === 'how' ? ('how' as const) : ('why' as const),
        topic: String(item.topic || ''),
        difficulty: (['beginner', 'intermediate', 'advanced'].includes(difficulty)
          ? difficulty
          : 'intermediate') as SuggestedQuestion['difficulty'],
      };
    });

    const keyConcepts = Array.isArray(data.keyConcepts) ? data.keyConcepts.map(String) : [];

    return { suggestedQuestions, keyConcepts };
  }

  private validateConversationSummary(parsed: unknown): ConversationSummary {
    const data = parsed as Record<string, unknown>;

    return {
      summary: String(data?.summary || 'Session completed.'),
      conceptsCovered: Array.isArray(data?.conceptsCovered)
        ? (data.conceptsCovered as unknown[]).map(String)
        : [],
      questionsAsked: typeof data?.questionsAsked === 'number' ? data.questionsAsked : 0,
      depthRating: (['surface', 'moderate', 'deep'].includes(String(data?.depthRating || ''))
        ? String(data.depthRating)
        : 'surface') as ConversationSummary['depthRating'],
    };
  }

  private validateStepwiseResponse(parsed: unknown): {
    steps: StepwiseStep[];
    summary: string;
  } {
    const data = parsed as { steps?: unknown[]; summary?: string };

    if (!data?.steps || !Array.isArray(data.steps) || data.steps.length === 0) {
      throw new Error('LLM response missing steps array');
    }

    const steps = data.steps.map((s: unknown, index: number) => {
      const item = s as Record<string, unknown>;
      if (!item.title || !item.content) {
        throw new Error(`Invalid step structure at index ${index}`);
      }

      const check = item.comprehensionCheck as Record<string, unknown> | undefined;
      if (!check?.question) {
        throw new Error(`Missing comprehension check at step ${index}`);
      }

      return {
        stepNumber: typeof item.stepNumber === 'number' ? item.stepNumber : index + 1,
        title: String(item.title),
        content: String(item.content),
        comprehensionCheck: {
          question: String(check.question),
          hint: String(check.hint || ''),
          sampleAnswer: String(check.sampleAnswer || ''),
        },
      };
    });

    return {
      steps,
      summary: String(data.summary || ''),
    };
  }

  private validateStepCheckResponse(parsed: unknown): {
    isCorrect: boolean;
    feedback: string;
    encouragement: string;
  } {
    const data = parsed as Record<string, unknown>;

    return {
      isCorrect: Boolean(data?.isCorrect),
      feedback: String(data?.feedback || 'Unable to evaluate response.'),
      encouragement: String(data?.encouragement || 'Keep going!'),
    };
  }

  private validateFlashcardResponse(parsed: unknown): FlashcardData[] {
    const data = parsed as { cards?: unknown[] };

    if (!data?.cards || !Array.isArray(data.cards) || data.cards.length === 0) {
      throw new Error('LLM response missing cards array');
    }

    return data.cards.map((c: unknown, index: number) => {
      const item = c as Record<string, unknown>;
      if (!item.front || !item.back) {
        throw new Error(`Invalid card structure at index ${index}`);
      }

      return {
        front: String(item.front),
        back: String(item.back),
      };
    });
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

  /**
   * Grade a short-answer question using LLM evaluation.
   * Falls back to keyword-based grading if the LLM call fails.
   */
  private async gradeShortAnswerWithLlm(
    teacherId: string,
    userId: string,
    courseId: string,
    question: PracticeQuestion,
    userAnswer: string,
    sourceText: string,
  ): Promise<{ isCorrect: boolean; feedback: string }> {
    try {
      const { system, user } = buildPracticeAnswerCheckPrompt({
        question: question.question,
        correctAnswer: question.correctAnswer,
        keywords: question.keywords || [],
        userAnswer,
        sourceText,
      });

      const result = await this.llmService.callLlmForUser(teacherId, system, user, {
        feature: 'practice_testing',
        courseId,
        triggeredByUserId: userId,
      });

      const parsed = this.parseLlmJson(result.content);
      const data = parsed as Record<string, unknown>;

      return {
        isCorrect: Boolean(data?.isCorrect),
        feedback: String(data?.feedback || ''),
      };
    } catch (err) {
      this.logger.warn(
        `LLM grading failed for short answer, falling back to keyword matching: ${err}`,
      );
      // Fallback to deterministic grading
      return {
        isCorrect: this.gradeAnswer(question, userAnswer),
        feedback: '',
      };
    }
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

  // ─── Chat ──────────────────────────────────────────────────

  async chat(
    userId: string,
    dto: ChatRequestDto,
  ): Promise<{ reply: string; suggestedStrategy: string | null }> {
    if (!dto.message || dto.message.trim().length < 2) {
      throw new BadRequestException('Message is too short');
    }

    const teacherId = await this.getCourseTeacherIdWithApiKey(dto.courseId);

    // Retrieve relevant course material via RAG (top 3 chunks)
    let courseContext = '';
    try {
      const chunks = await this.ragService.queryChunks(dto.courseId, dto.message, 3);
      if (chunks.length > 0) {
        courseContext =
          '\n\nRelevant course material:\n' +
          chunks.map((c, i) => `[${i + 1}] ${c.content.slice(0, 500)}`).join('\n\n');
      }
    } catch {
      // RAG retrieval is best-effort; continue without it
    }

    const systemPrompt = `You are a friendly and supportive learning assistant embedded in an educational platform. Your role is to help students understand their course material and guide them to use effective learning strategies.

You have access to four learning strategies the student can use:
- **Practice Testing**: Generate quiz questions from selected text to test knowledge retention
- **Distributed Practice**: Create spaced-repetition flashcards for long-term memory
- **Stepwise Learning**: Break complex text into guided steps with comprehension checks
- **Interrogative Elaboration**: Explore "why" and "how" questions through dialogue

Guidelines:
- Answer the student's question helpfully using the course context provided below when relevant.
- Keep responses concise (2-4 sentences) since this is a small chat widget.
- When the student seems to be struggling with a concept, confused, or asking about a topic, suggest a relevant learning strategy. Include a recommendation in the LAST line using this exact format: [SUGGEST:STRATEGY_KEY] where STRATEGY_KEY is one of: PRACTICE_TESTING, DISTRIBUTED_PRACTICE, STEPWISE_LEARNING, INTERROGATIVE_ELABORATION.
- Only suggest a strategy when it is genuinely relevant. Do NOT suggest one on every message.
- When to suggest which strategy:
  - PRACTICE_TESTING: when the student wants to test their understanding, review for exams, or check recall
  - DISTRIBUTED_PRACTICE: when the student wants to memorize key terms, definitions, or facts for the long term
  - STEPWISE_LEARNING: when the student is confused by complex or dense material and needs it broken down
  - INTERROGATIVE_ELABORATION: when the student is curious about why or how something works and wants deeper understanding
- If the student asks about something unrelated to the course, politely redirect them.
${courseContext}`;

    // Build user prompt with context
    let userPrompt = '';

    if (dto.selectedText) {
      userPrompt += `[The student has selected this text on the page: "${dto.selectedText.slice(0, 300)}"]\n\n`;
    }

    if (dto.contentTitle) {
      userPrompt += `[Currently viewing: ${dto.contentTitle}]\n\n`;
    }

    // Include conversation history (last 10 messages to keep context manageable)
    const recentHistory = (dto.conversationHistory || []).slice(-10);
    if (recentHistory.length > 0) {
      userPrompt += 'Conversation so far:\n';
      for (const msg of recentHistory) {
        userPrompt += `${msg.role === 'user' ? 'Student' : 'Assistant'}: ${msg.content}\n`;
      }
      userPrompt += '\n';
    }

    userPrompt += `Student: ${dto.message}`;

    let reply: string;
    try {
      const result = await this.llmService.callLlmForUser(teacherId, systemPrompt, userPrompt, {
        feature: 'chatbot',
        courseId: dto.courseId,
        triggeredByUserId: userId,
      });
      reply = result.content;
    } catch {
      reply =
        "I'm having trouble responding right now. Try selecting some text and using one of the learning strategies instead!";
    }

    // Extract strategy suggestion if present
    let suggestedStrategy: string | null = null;
    const strategyMatch = reply.match(
      /\[SUGGEST:(PRACTICE_TESTING|DISTRIBUTED_PRACTICE|STEPWISE_LEARNING|INTERROGATIVE_ELABORATION)\]/,
    );
    if (strategyMatch) {
      suggestedStrategy = strategyMatch[1]!;
      // Remove the tag from the visible reply
      reply = reply.replace(strategyMatch[0], '').trim();
    }

    return { reply, suggestedStrategy };
  }
}
