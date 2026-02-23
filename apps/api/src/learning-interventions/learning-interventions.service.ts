import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnthropicService } from '../rag/anthropic.service';
import { CreateInterventionDto } from './dto/create-intervention.dto';
import {
  GeneratePracticeTestDto,
  SubmitPracticeTestAnswersDto,
  GeneratePracticeTestResponse,
  SubmitAnswersResponse,
  PracticeTestQuestionFull,
  PracticeTestQuestionForStudent,
  PracticeTestResult,
} from './dto/practice-testing.dto';
import {
  GenerateElaborationDto,
  SubmitElaborationDto,
  GenerateElaborationResponse,
  ElaborationEvaluationResult,
  ElaborationSummary,
  ElaborationSessionResult,
  ElaborationQuestionForStudent,
  UserElaborationEntry,
} from './dto/interrogative-elaboration.dto';
import {
  buildPracticeTestingPrompt,
  PracticeTestResponse,
} from './prompts/practice-testing.prompt';
import {
  buildElaborationQuestionsPrompt,
  buildElaborationEvaluationPrompt,
  ElaborationQuestionsResponse,
  ElaborationEvaluationResponse,
  ElaborationQuestion,
} from './prompts/interrogative-elaboration.prompt';
import {
  GenerateStepwiseDto,
  SubmitStepCheckDto,
  GenerateStepwiseResponse,
  StepCheckResult,
  StepwiseSessionResult,
  StepwiseSummary,
  LearningStep,
  UserStepResponse,
} from './dto/stepwise-learning.dto';
import {
  buildStepwiseLearningPrompt,
  buildStepCheckPrompt,
  StepwiseLearningResponse,
  StepCheckEvaluationResponse,
} from './prompts/stepwise-learning.prompt';
import {
  buildDistributedPracticePrompt,
  FlashcardResponse,
} from './prompts/distributed-practice.prompt';
import {
  GenerateCardsDto,
  ReviewCardDto,
  CardGenerationResult,
  DueCardsResult,
  ReviewResult,
  CardStats,
  Flashcard,
  DueCard,
} from './dto/distributed-practice.dto';
import {
  calculateNextReview,
  QUALITY_MAP,
  getInitialSM2Values,
} from './utils/sm2-algorithm';

@Injectable()
export class LearningInterventionsService {
  private readonly logger = new Logger(LearningInterventionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly anthropic: AnthropicService,
  ) {}

  /**
   * Create a new learning intervention
   */
  async createIntervention(userId: string, dto: CreateInterventionDto) {
    const intervention = await this.prisma.learningIntervention.create({
      data: {
        userId,
        courseId: dto.courseId,
        contentId: dto.contentId,
        selectedText: dto.selectedText,
        interventionType: dto.interventionType,
      },
    });

    this.logger.log(
      `Created ${dto.interventionType} intervention ${intervention.id} for user ${userId}`,
    );

    return intervention;
  }

  /**
   * Get all interventions for a user
   */
  async getInterventions(userId: string, courseId?: string) {
    const where: Record<string, any> = { userId };
    if (courseId) {
      where.courseId = courseId;
    }

    return this.prisma.learningIntervention.findMany({
      where,
      include: {
        practiceTests: true,
        stepwiseSessions: true,
        elaborationSessions: true,
        spacedRepetitionCards: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a single intervention by ID
   */
  async getIntervention(interventionId: string, userId: string) {
    return this.prisma.learningIntervention.findFirst({
      where: {
        id: interventionId,
        userId,
      },
      include: {
        practiceTests: true,
        stepwiseSessions: true,
        elaborationSessions: true,
        spacedRepetitionCards: true,
      },
    });
  }

  /**
   * Check if Anthropic service is available
   */
  isAnthropicAvailable(): boolean {
    return this.anthropic.isAvailable();
  }

  // ─── Practice Testing Methods ─────────────────────────────

  /**
   * Generate a practice test from selected text
   */
  async generatePracticeTest(
    userId: string,
    dto: GeneratePracticeTestDto,
  ): Promise<GeneratePracticeTestResponse> {
    // 1. Check if Anthropic is available
    if (!this.anthropic.isAvailable()) {
      throw new BadRequestException('AI service not configured. Please contact administrator.');
    }

    // 2. Create the learning intervention record
    const intervention = await this.prisma.learningIntervention.create({
      data: {
        userId,
        courseId: dto.courseId,
        contentId: dto.contentId,
        selectedText: dto.selectedText,
        interventionType: 'PRACTICE_TESTING',
        pageType: dto.pageType,
      },
    });

    // 3. Build prompt and call Anthropic
    const prompt = buildPracticeTestingPrompt(dto.selectedText, dto.questionCount);

    let questions: PracticeTestQuestionFull[];
    try {
      const response = await this.anthropic.generateStructuredResponse<PracticeTestResponse>(
        {
          systemPrompt: prompt.system,
          userPrompt: prompt.user,
          maxTokens: 4096,
        },
        {
          courseId: dto.courseId,
          userId,
          action: 'practice_testing_generate',
        },
      );

      questions = this.validateAndNormalizeQuestions(response.data.questions);
    } catch (error: any) {
      // Retry once on failure
      this.logger.warn(`First attempt failed, retrying: ${error.message}`);
      try {
        const response = await this.anthropic.generateStructuredResponse<PracticeTestResponse>(
          {
            systemPrompt: prompt.system,
            userPrompt: prompt.user,
            maxTokens: 4096,
          },
          {
            courseId: dto.courseId,
            userId,
            action: 'practice_testing_generate_retry',
          },
        );

        questions = this.validateAndNormalizeQuestions(response.data.questions);
      } catch (retryError: any) {
        this.logger.error(`Retry also failed: ${retryError.message}`);
        // Clean up the intervention record
        await this.prisma.learningIntervention.delete({
          where: { id: intervention.id },
        });
        throw new BadRequestException('Failed to generate questions. Please try again.');
      }
    }

    // 4. Create the practice test record
    const practiceTest = await this.prisma.practiceTest.create({
      data: {
        interventionId: intervention.id,
        questions: questions as any,
      },
    });

    this.logger.log(
      `Generated practice test ${practiceTest.id} with ${questions.length} questions`,
    );

    // 5. Return questions without answers
    const questionsForStudent: PracticeTestQuestionForStudent[] = questions.map((q) => ({
      question: q.question,
      type: q.type,
      options: q.options,
    }));

    return {
      interventionId: intervention.id,
      practiceTestId: practiceTest.id,
      questions: questionsForStudent,
    };
  }

  /**
   * Submit answers for a practice test and get graded results
   */
  async submitPracticeTestAnswers(
    userId: string,
    practiceTestId: string,
    dto: SubmitPracticeTestAnswersDto,
  ): Promise<SubmitAnswersResponse> {
    // 1. Fetch the practice test
    const practiceTest = await this.prisma.practiceTest.findUnique({
      where: { id: practiceTestId },
      include: {
        intervention: true,
      },
    });

    if (!practiceTest) {
      throw new NotFoundException('Practice test not found');
    }

    if (practiceTest.intervention.userId !== userId) {
      throw new NotFoundException('Practice test not found');
    }

    if (practiceTest.completedAt) {
      throw new BadRequestException('Practice test already completed');
    }

    // 2. Get the questions with correct answers
    const questions = practiceTest.questions as PracticeTestQuestionFull[];

    // 3. Grade each answer
    const results: Array<{
      questionIndex: number;
      answer: string;
      isCorrect: boolean;
      submittedAt: string;
    }> = [];

    const gradeResults: Array<{
      questionIndex: number;
      userAnswer: string;
      isCorrect: boolean;
      correctAnswer: string;
      explanation: string;
    }> = [];

    let correctCount = 0;

    for (const submission of dto.answers) {
      const question = questions[submission.questionIndex];
      if (!question) continue;

      const isCorrect = this.gradeAnswer(question, submission.answer);
      if (isCorrect) correctCount++;

      results.push({
        questionIndex: submission.questionIndex,
        answer: submission.answer,
        isCorrect,
        submittedAt: new Date().toISOString(),
      });

      gradeResults.push({
        questionIndex: submission.questionIndex,
        userAnswer: submission.answer,
        isCorrect,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
      });
    }

    // 4. Calculate score
    const score = questions.length > 0 ? correctCount / questions.length : 0;

    // 5. Update the practice test record
    await this.prisma.practiceTest.update({
      where: { id: practiceTestId },
      data: {
        userAnswers: results as any,
        score,
        completedAt: new Date(),
      },
    });

    this.logger.log(
      `Practice test ${practiceTestId} completed with score ${(score * 100).toFixed(0)}%`,
    );

    return {
      practiceTestId,
      score: correctCount,
      totalQuestions: questions.length,
      percentage: Math.round(score * 100),
      results: gradeResults,
    };
  }

  /**
   * Get a practice test by ID
   */
  async getPracticeTest(userId: string, practiceTestId: string): Promise<PracticeTestResult> {
    const practiceTest = await this.prisma.practiceTest.findUnique({
      where: { id: practiceTestId },
      include: {
        intervention: true,
      },
    });

    if (!practiceTest) {
      throw new NotFoundException('Practice test not found');
    }

    if (practiceTest.intervention.userId !== userId) {
      throw new NotFoundException('Practice test not found');
    }

    const questions = practiceTest.questions as PracticeTestQuestionFull[];

    // Only return correct answers if the test has been completed
    const questionsForResponse = practiceTest.completedAt
      ? questions
      : questions.map((q) => ({
          question: q.question,
          type: q.type,
          options: q.options,
          correctAnswer: '', // Hide correct answer until completed
          explanation: '', // Hide explanation until completed
          keywords: undefined,
        }));

    return {
      id: practiceTest.id,
      interventionId: practiceTest.interventionId,
      questions: questionsForResponse as PracticeTestQuestionFull[],
      userAnswers: practiceTest.userAnswers as any,
      score: practiceTest.score,
      completedAt: practiceTest.completedAt?.toISOString() || null,
      createdAt: practiceTest.createdAt.toISOString(),
    };
  }

  // ─── Interrogative Elaboration Methods ─────────────────────

  /**
   * Generate elaboration questions from selected text
   */
  async generateElaborationQuestions(
    userId: string,
    dto: GenerateElaborationDto,
  ): Promise<GenerateElaborationResponse> {
    // 1. Check if Anthropic is available
    if (!this.anthropic.isAvailable()) {
      throw new BadRequestException('AI service not configured. Please contact administrator.');
    }

    // 2. Create the learning intervention record
    const intervention = await this.prisma.learningIntervention.create({
      data: {
        userId,
        courseId: dto.courseId,
        contentId: dto.contentId,
        selectedText: dto.selectedText,
        interventionType: 'INTERROGATIVE_ELABORATION',
        pageType: dto.pageType,
      },
    });

    // 3. Build prompt and call Anthropic
    const prompt = buildElaborationQuestionsPrompt(dto.selectedText, dto.questionCount);

    let questions: ElaborationQuestion[];
    try {
      const response = await this.anthropic.generateStructuredResponse<ElaborationQuestionsResponse>(
        {
          systemPrompt: prompt.system,
          userPrompt: prompt.user,
          maxTokens: 4096,
        },
        {
          courseId: dto.courseId,
          userId,
          action: 'elaboration_generate',
        },
      );

      questions = this.validateAndNormalizeElaborationQuestions(response.data.questions);
    } catch (error: any) {
      // Retry once on failure
      this.logger.warn(`First attempt failed, retrying: ${error.message}`);
      try {
        const response = await this.anthropic.generateStructuredResponse<ElaborationQuestionsResponse>(
          {
            systemPrompt: prompt.system,
            userPrompt: prompt.user,
            maxTokens: 4096,
          },
          {
            courseId: dto.courseId,
            userId,
            action: 'elaboration_generate_retry',
          },
        );

        questions = this.validateAndNormalizeElaborationQuestions(response.data.questions);
      } catch (retryError: any) {
        this.logger.error(`Retry also failed: ${retryError.message}`);
        // Clean up the intervention record
        await this.prisma.learningIntervention.delete({
          where: { id: intervention.id },
        });
        throw new BadRequestException('Failed to generate questions. Please try again.');
      }
    }

    // 4. Create the elaboration session record
    const session = await this.prisma.elaborationSession.create({
      data: {
        interventionId: intervention.id,
        questions: questions as any,
        sourceText: dto.selectedText,
        userElaborations: [],
      },
    });

    this.logger.log(
      `Generated elaboration session ${session.id} with ${questions.length} questions`,
    );

    // 5. Return questions (including keyPoints for frontend evaluation calls)
    const questionsForStudent: ElaborationQuestionForStudent[] = questions.map((q) => ({
      question: q.question,
      type: q.type,
      keyPoints: q.keyPoints,
    }));

    return {
      interventionId: intervention.id,
      sessionId: session.id,
      questions: questionsForStudent,
      sourceText: dto.selectedText,
    };
  }

  /**
   * Evaluate a learner's elaboration
   */
  async evaluateElaboration(
    userId: string,
    sessionId: string,
    dto: SubmitElaborationDto,
  ): Promise<ElaborationEvaluationResult> {
    // 1. Fetch the session
    const session = await this.prisma.elaborationSession.findUnique({
      where: { id: sessionId },
      include: {
        intervention: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Elaboration session not found');
    }

    if (session.intervention.userId !== userId) {
      throw new NotFoundException('Elaboration session not found');
    }

    if (session.completedAt) {
      throw new BadRequestException('Session already completed');
    }

    // 2. Get the question and key points
    const questions = session.questions as ElaborationQuestion[];
    const question = questions[dto.questionIndex];

    if (!question) {
      throw new BadRequestException(`Invalid question index: ${dto.questionIndex}`);
    }

    // 3. Call Anthropic for evaluation
    const evalPrompt = buildElaborationEvaluationPrompt({
      question: question.question,
      userElaboration: dto.elaboration,
      keyPoints: question.keyPoints,
      sourceText: session.sourceText,
    });

    let evaluation: ElaborationEvaluationResponse;
    try {
      const response = await this.anthropic.generateStructuredResponse<ElaborationEvaluationResponse>(
        {
          systemPrompt: evalPrompt.system,
          userPrompt: evalPrompt.user,
          maxTokens: 2048,
        },
        {
          courseId: session.intervention.courseId,
          userId,
          action: 'elaboration_evaluate',
        },
      );

      evaluation = this.validateElaborationEvaluation(response.data);
    } catch (error: any) {
      this.logger.error(`Elaboration evaluation failed: ${error.message}`);
      throw new BadRequestException('Failed to evaluate elaboration. Please try again.');
    }

    // 4. Update the session's userElaborations array
    const existingElaborations = (session.userElaborations as UserElaborationEntry[]) || [];

    // Find existing entry for this question (for revisions)
    const existingIndex = existingElaborations.findIndex(
      (e) => e.questionIndex === dto.questionIndex,
    );

    const newEntry: UserElaborationEntry = {
      questionIndex: dto.questionIndex,
      elaboration: dto.elaboration,
      rating: evaluation.rating,
      feedback: evaluation.feedback,
      addressedPoints: evaluation.addressedPoints,
      missedPoints: evaluation.missedPoints,
      modelElaboration: evaluation.modelElaboration,
      submittedAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      // Replace existing entry (revision)
      existingElaborations[existingIndex] = newEntry;
    } else {
      // Add new entry
      existingElaborations.push(newEntry);
    }

    await this.prisma.elaborationSession.update({
      where: { id: sessionId },
      data: {
        userElaborations: existingElaborations as any,
      },
    });

    this.logger.log(
      `Evaluated elaboration for session ${sessionId}, question ${dto.questionIndex}: ${evaluation.rating}`,
    );

    return {
      questionIndex: dto.questionIndex,
      rating: evaluation.rating,
      addressedPoints: evaluation.addressedPoints,
      missedPoints: evaluation.missedPoints,
      feedback: evaluation.feedback,
      modelElaboration: evaluation.modelElaboration,
    };
  }

  /**
   * Complete an elaboration session
   */
  async completeElaborationSession(
    userId: string,
    sessionId: string,
  ): Promise<ElaborationSummary> {
    // 1. Fetch the session
    const session = await this.prisma.elaborationSession.findUnique({
      where: { id: sessionId },
      include: {
        intervention: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Elaboration session not found');
    }

    if (session.intervention.userId !== userId) {
      throw new NotFoundException('Elaboration session not found');
    }

    // 2. Get elaborations and calculate summary
    const elaborations = (session.userElaborations as UserElaborationEntry[]) || [];
    const questions = session.questions as ElaborationQuestion[];

    const ratings = {
      strong: 0,
      developing: 0,
      needsImprovement: 0,
    };

    for (const elab of elaborations) {
      if (elab.rating === 'Strong') ratings.strong++;
      else if (elab.rating === 'Developing') ratings.developing++;
      else ratings.needsImprovement++;
    }

    // 3. Generate overall message
    let overallMessage: string;
    const totalAnswered = elaborations.length;
    const totalQuestions = questions.length;

    if (totalAnswered === 0) {
      overallMessage = 'No questions were answered.';
    } else if (ratings.strong >= totalAnswered * 0.75) {
      overallMessage = 'Excellent work! Your elaborations show deep understanding of the material.';
    } else if (ratings.strong + ratings.developing >= totalAnswered * 0.75) {
      overallMessage = 'Good progress! You demonstrated solid understanding with room for deeper exploration.';
    } else if (ratings.needsImprovement > totalAnswered * 0.5) {
      overallMessage = 'Keep practicing! Reviewing the source material and trying again will help deepen your understanding.';
    } else {
      overallMessage = 'Nice effort! Continue building on your understanding by revisiting key concepts.';
    }

    // 4. Mark session as completed
    await this.prisma.elaborationSession.update({
      where: { id: sessionId },
      data: {
        completedAt: new Date(),
      },
    });

    this.logger.log(`Completed elaboration session ${sessionId}`);

    return {
      sessionId,
      totalQuestions,
      completed: true,
      ratings,
      overallMessage,
      elaborations,
    };
  }

  /**
   * Get an elaboration session by ID
   */
  async getElaborationSession(
    userId: string,
    sessionId: string,
  ): Promise<ElaborationSessionResult> {
    const session = await this.prisma.elaborationSession.findUnique({
      where: { id: sessionId },
      include: {
        intervention: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Elaboration session not found');
    }

    if (session.intervention.userId !== userId) {
      throw new NotFoundException('Elaboration session not found');
    }

    const questions = session.questions as ElaborationQuestion[];
    const elaborations = (session.userElaborations as UserElaborationEntry[]) || [];

    const questionsForStudent: ElaborationQuestionForStudent[] = questions.map((q) => ({
      question: q.question,
      type: q.type,
      keyPoints: q.keyPoints,
    }));

    return {
      sessionId: session.id,
      interventionId: session.interventionId,
      questions: questionsForStudent,
      sourceText: session.sourceText,
      elaborations,
      completed: !!session.completedAt,
    };
  }

  // ─── Stepwise Learning Methods ─────────────────────────────

  /**
   * Generate stepwise learning content from selected text
   */
  async generateSteps(
    userId: string,
    dto: GenerateStepwiseDto,
  ): Promise<GenerateStepwiseResponse> {
    // 1. Check if Anthropic is available
    if (!this.anthropic.isAvailable()) {
      throw new BadRequestException('AI service not configured. Please contact administrator.');
    }

    // 2. Create the learning intervention record
    const intervention = await this.prisma.learningIntervention.create({
      data: {
        userId,
        courseId: dto.courseId,
        contentId: dto.contentId,
        selectedText: dto.selectedText,
        interventionType: 'STEPWISE_LEARNING',
        pageType: dto.pageType,
      },
    });

    // 3. Build prompt and call Anthropic
    const prompt = buildStepwiseLearningPrompt(dto.selectedText);

    let stepsData: StepwiseLearningResponse;
    try {
      const response = await this.anthropic.generateStructuredResponse<StepwiseLearningResponse>(
        {
          systemPrompt: prompt.system,
          userPrompt: prompt.user,
          maxTokens: 4096,
        },
        {
          courseId: dto.courseId,
          userId,
          action: 'stepwise_generate',
        },
      );

      stepsData = this.validateAndNormalizeSteps(response.data);
    } catch (error: any) {
      // Retry once on failure
      this.logger.warn(`First attempt failed, retrying: ${error.message}`);
      try {
        const response = await this.anthropic.generateStructuredResponse<StepwiseLearningResponse>(
          {
            systemPrompt: prompt.system,
            userPrompt: prompt.user,
            maxTokens: 4096,
          },
          {
            courseId: dto.courseId,
            userId,
            action: 'stepwise_generate_retry',
          },
        );

        stepsData = this.validateAndNormalizeSteps(response.data);
      } catch (retryError: any) {
        this.logger.error(`Retry also failed: ${retryError.message}`);
        // Clean up the intervention record
        await this.prisma.learningIntervention.delete({
          where: { id: intervention.id },
        });
        throw new BadRequestException('Failed to generate steps. Please try again.');
      }
    }

    // 4. Create the stepwise session record
    const session = await this.prisma.stepwiseSession.create({
      data: {
        interventionId: intervention.id,
        steps: stepsData.steps as any,
        summary: stepsData.summary,
        totalSteps: stepsData.steps.length,
        currentStep: 0,
        userResponses: [],
        sourceText: dto.selectedText,
      },
    });

    this.logger.log(
      `Generated stepwise session ${session.id} with ${stepsData.steps.length} steps`,
    );

    return {
      interventionId: intervention.id,
      sessionId: session.id,
      steps: stepsData.steps,
      summary: stepsData.summary,
      totalSteps: stepsData.steps.length,
      currentStep: 0,
    };
  }

  /**
   * Check a comprehension response for a step
   */
  async checkStepResponse(
    userId: string,
    sessionId: string,
    dto: SubmitStepCheckDto,
  ): Promise<StepCheckResult> {
    // 1. Fetch the session
    const session = await this.prisma.stepwiseSession.findUnique({
      where: { id: sessionId },
      include: {
        intervention: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Stepwise session not found');
    }

    if (session.intervention.userId !== userId) {
      throw new NotFoundException('Stepwise session not found');
    }

    if (session.completedAt) {
      throw new BadRequestException('Session already completed');
    }

    // 2. Get the step
    const steps = session.steps as LearningStep[];
    const step = steps.find((s) => s.stepNumber === dto.stepNumber);

    if (!step) {
      throw new BadRequestException(`Invalid step number: ${dto.stepNumber}`);
    }

    // 3. Call Anthropic for evaluation
    const checkPrompt = buildStepCheckPrompt({
      stepTitle: step.title,
      stepContent: step.content,
      question: step.comprehensionCheck.question,
      sampleAnswer: step.comprehensionCheck.sampleAnswer,
      userResponse: dto.userResponse,
    });

    let evaluation: StepCheckEvaluationResponse;
    try {
      const response =
        await this.anthropic.generateStructuredResponse<StepCheckEvaluationResponse>(
          {
            systemPrompt: checkPrompt.system,
            userPrompt: checkPrompt.user,
            maxTokens: 1024,
          },
          {
            courseId: session.intervention.courseId,
            userId,
            action: 'stepwise_check',
          },
        );

      evaluation = this.validateStepCheckEvaluation(response.data);
    } catch (error: any) {
      this.logger.error(`Step check evaluation failed: ${error.message}`);
      throw new BadRequestException('Failed to check response. Please try again.');
    }

    // 4. Update the session's userResponses array
    const existingResponses = (session.userResponses as UserStepResponse[]) || [];

    // Find existing entry for this step (for retries)
    const existingIndex = existingResponses.findIndex((r) => r.stepNumber === dto.stepNumber);

    const newEntry: UserStepResponse = {
      stepNumber: dto.stepNumber,
      response: dto.userResponse,
      feedback: evaluation.feedback,
      isCorrect: evaluation.isCorrect,
      submittedAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      // Replace existing entry (retry)
      existingResponses[existingIndex] = newEntry;
    } else {
      // Add new entry
      existingResponses.push(newEntry);
    }

    await this.prisma.stepwiseSession.update({
      where: { id: sessionId },
      data: {
        userResponses: existingResponses as any,
      },
    });

    this.logger.log(
      `Checked step ${dto.stepNumber} for session ${sessionId}: ${evaluation.isCorrect ? 'correct' : 'incorrect'}`,
    );

    return {
      isCorrect: evaluation.isCorrect,
      feedback: evaluation.feedback,
      encouragement: evaluation.encouragement,
    };
  }

  /**
   * Advance to the next step
   */
  async advanceStep(userId: string, sessionId: string): Promise<StepwiseSessionResult> {
    // 1. Fetch the session
    const session = await this.prisma.stepwiseSession.findUnique({
      where: { id: sessionId },
      include: {
        intervention: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Stepwise session not found');
    }

    if (session.intervention.userId !== userId) {
      throw new NotFoundException('Stepwise session not found');
    }

    if (session.completedAt) {
      throw new BadRequestException('Session already completed');
    }

    // 2. Increment currentStep
    const newCurrentStep = session.currentStep + 1;

    // 3. Check if we've reached the end
    const isComplete = newCurrentStep >= session.totalSteps;

    // 4. Update the session
    const updatedSession = await this.prisma.stepwiseSession.update({
      where: { id: sessionId },
      data: {
        currentStep: newCurrentStep,
        completedAt: isComplete ? new Date() : null,
      },
    });

    this.logger.log(
      `Advanced session ${sessionId} to step ${newCurrentStep}${isComplete ? ' (completed)' : ''}`,
    );

    const steps = updatedSession.steps as LearningStep[];
    const userResponses = (updatedSession.userResponses as UserStepResponse[]) || [];

    return {
      sessionId: updatedSession.id,
      interventionId: updatedSession.interventionId,
      steps,
      summary: updatedSession.summary,
      totalSteps: updatedSession.totalSteps,
      currentStep: updatedSession.currentStep,
      userResponses,
      completed: !!updatedSession.completedAt,
      sourceText: updatedSession.sourceText,
    };
  }

  /**
   * Complete a stepwise session
   */
  async completeStepwiseSession(userId: string, sessionId: string): Promise<StepwiseSummary> {
    // 1. Fetch the session
    const session = await this.prisma.stepwiseSession.findUnique({
      where: { id: sessionId },
      include: {
        intervention: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Stepwise session not found');
    }

    if (session.intervention.userId !== userId) {
      throw new NotFoundException('Stepwise session not found');
    }

    // 2. Calculate statistics
    const userResponses = (session.userResponses as UserStepResponse[]) || [];

    // Count steps where the first response was correct
    const responsesByStep = new Map<number, UserStepResponse[]>();
    for (const resp of userResponses) {
      const existing = responsesByStep.get(resp.stepNumber) || [];
      existing.push(resp);
      responsesByStep.set(resp.stepNumber, existing);
    }

    let correctOnFirstTry = 0;
    for (const [, responses] of responsesByStep) {
      // Sort by submission time and check if first was correct
      const sorted = responses.sort(
        (a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime(),
      );
      if (sorted[0]?.isCorrect) {
        correctOnFirstTry++;
      }
    }

    // 3. Mark session as completed if not already
    if (!session.completedAt) {
      await this.prisma.stepwiseSession.update({
        where: { id: sessionId },
        data: {
          completedAt: new Date(),
        },
      });
    }

    this.logger.log(`Completed stepwise session ${sessionId}`);

    return {
      sessionId,
      totalSteps: session.totalSteps,
      correctOnFirstTry,
      completed: true,
      summary: session.summary,
      userResponses,
    };
  }

  /**
   * Get a stepwise session by ID (for resuming)
   */
  async getStepwiseSession(userId: string, sessionId: string): Promise<StepwiseSessionResult> {
    const session = await this.prisma.stepwiseSession.findUnique({
      where: { id: sessionId },
      include: {
        intervention: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Stepwise session not found');
    }

    if (session.intervention.userId !== userId) {
      throw new NotFoundException('Stepwise session not found');
    }

    const steps = session.steps as LearningStep[];
    const userResponses = (session.userResponses as UserStepResponse[]) || [];

    return {
      sessionId: session.id,
      interventionId: session.interventionId,
      steps,
      summary: session.summary,
      totalSteps: session.totalSteps,
      currentStep: session.currentStep,
      userResponses,
      completed: !!session.completedAt,
      sourceText: session.sourceText,
    };
  }

  // ─── Distributed Practice (Spaced Repetition) Methods ─────────────────────

  /**
   * Generate flashcards from selected text
   */
  async generateCards(userId: string, dto: GenerateCardsDto): Promise<CardGenerationResult> {
    // 1. Check if Anthropic is available
    if (!this.anthropic.isAvailable()) {
      throw new BadRequestException('AI service not configured. Please contact administrator.');
    }

    // 2. Create the learning intervention record
    const intervention = await this.prisma.learningIntervention.create({
      data: {
        userId,
        courseId: dto.courseId,
        contentId: dto.contentId,
        selectedText: dto.selectedText,
        interventionType: 'DISTRIBUTED_PRACTICE',
        pageType: dto.pageType,
      },
    });

    // 3. Build prompt and call Anthropic
    const cardCount = dto.cardCount || 5;
    const prompt = buildDistributedPracticePrompt(dto.selectedText, cardCount);

    let cardsData: FlashcardResponse;
    try {
      const response = await this.anthropic.generateStructuredResponse<FlashcardResponse>(
        {
          systemPrompt: prompt.system,
          userPrompt: prompt.user,
          maxTokens: 4096,
        },
        {
          courseId: dto.courseId,
          userId,
          action: 'distributed_practice_generate',
        },
      );

      cardsData = this.validateAndNormalizeFlashcards(response.data, cardCount);
    } catch (error: any) {
      // Retry once on failure
      this.logger.warn(`First attempt failed, retrying: ${error.message}`);
      try {
        const response = await this.anthropic.generateStructuredResponse<FlashcardResponse>(
          {
            systemPrompt: prompt.system,
            userPrompt: prompt.user,
            maxTokens: 4096,
          },
          {
            courseId: dto.courseId,
            userId,
            action: 'distributed_practice_generate_retry',
          },
        );

        cardsData = this.validateAndNormalizeFlashcards(response.data, cardCount);
      } catch (retryError: any) {
        this.logger.error(`Retry also failed: ${retryError.message}`);
        // Clean up the intervention record
        await this.prisma.learningIntervention.delete({
          where: { id: intervention.id },
        });
        throw new BadRequestException('Failed to generate flashcards. Please try again.');
      }
    }

    // 4. Create SpacedRepetitionCard records for each card
    const initialValues = getInitialSM2Values();
    const nextReviewAt = new Date();
    nextReviewAt.setDate(nextReviewAt.getDate() + 1); // First review tomorrow

    const createdCards: Flashcard[] = [];
    for (const card of cardsData.cards) {
      const createdCard = await this.prisma.spacedRepetitionCard.create({
        data: {
          interventionId: intervention.id,
          userId,
          front: card.front,
          back: card.back,
          ease: initialValues.ease,
          interval: initialValues.interval,
          repetitions: initialValues.repetitions,
          nextReviewAt,
        },
      });

      createdCards.push({
        id: createdCard.id,
        front: createdCard.front,
        back: createdCard.back,
      });
    }

    this.logger.log(
      `Generated ${createdCards.length} flashcards for intervention ${intervention.id}`,
    );

    return {
      interventionId: intervention.id,
      cards: createdCards,
      totalCreated: createdCards.length,
    };
  }

  /**
   * Get cards due for review
   */
  async getDueCards(
    userId: string,
    limit: number = 20,
    courseId?: string,
  ): Promise<DueCardsResult> {
    const now = new Date();

    // Build the where clause
    const where: any = {
      userId,
      nextReviewAt: { lte: now },
    };

    // If courseId provided, filter through intervention relation
    if (courseId) {
      where.intervention = { courseId };
    }

    const dueCards = await this.prisma.spacedRepetitionCard.findMany({
      where,
      orderBy: { nextReviewAt: 'asc' },
      take: limit,
      include: {
        intervention: {
          include: {
            course: true,
          },
        },
      },
    });

    // Get total due count
    const totalDue = await this.prisma.spacedRepetitionCard.count({ where });

    const cards: DueCard[] = dueCards.map((card) => ({
      id: card.id,
      front: card.front,
      back: card.back,
      interval: card.interval,
      repetitions: card.repetitions,
      courseId: card.intervention.courseId,
      courseName: card.intervention.course?.title,
    }));

    return {
      dueCards: cards,
      totalDue,
    };
  }

  /**
   * Submit a card review with quality rating
   */
  async reviewCard(
    userId: string,
    cardId: string,
    dto: ReviewCardDto,
  ): Promise<ReviewResult> {
    // 1. Fetch the card
    const card = await this.prisma.spacedRepetitionCard.findUnique({
      where: { id: cardId },
    });

    if (!card) {
      throw new NotFoundException('Card not found');
    }

    if (card.userId !== userId) {
      throw new NotFoundException('Card not found');
    }

    // 2. Map quality string to SM-2 quality score
    const quality = QUALITY_MAP[dto.quality];

    // 3. Calculate next review using SM-2 algorithm
    const result = calculateNextReview(quality, {
      ease: card.ease,
      interval: card.interval,
      repetitions: card.repetitions,
    });

    // 4. Update the card
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

    this.logger.log(
      `Reviewed card ${cardId}: quality=${dto.quality}, next review in ${result.interval} days`,
    );

    return {
      nextReviewAt: result.nextReviewAt.toISOString(),
      interval: result.interval,
      ease: result.ease,
    };
  }

  /**
   * Get card statistics for the user
   */
  async getStats(userId: string): Promise<CardStats> {
    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const endOfWeek = new Date(now);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    // Get all cards for the user
    const allCards = await this.prisma.spacedRepetitionCard.findMany({
      where: { userId },
      select: {
        ease: true,
        repetitions: true,
        nextReviewAt: true,
      },
    });

    const totalCards = allCards.length;

    // Count cards due today
    const dueToday = allCards.filter(
      (card) => card.nextReviewAt <= endOfToday,
    ).length;

    // Count cards due this week
    const dueThisWeek = allCards.filter(
      (card) => card.nextReviewAt <= endOfWeek,
    ).length;

    // Calculate average ease
    const averageEase =
      totalCards > 0
        ? allCards.reduce((sum, card) => sum + card.ease, 0) / totalCards
        : 2.5;

    // Count cards by stage
    const cardsByStage = {
      new: allCards.filter((card) => card.repetitions === 0).length,
      learning: allCards.filter(
        (card) => card.repetitions >= 1 && card.repetitions <= 2,
      ).length,
      mature: allCards.filter((card) => card.repetitions >= 3).length,
    };

    // For streak tracking, we would need a separate table to track daily reviews
    // For now, return 0 as placeholder
    const longestStreak = 0;

    return {
      totalCards,
      dueToday,
      dueThisWeek,
      averageEase: Math.round(averageEase * 100) / 100,
      longestStreak,
      cardsByStage,
    };
  }

  /**
   * Delete a card
   */
  async deleteCard(userId: string, cardId: string): Promise<void> {
    const card = await this.prisma.spacedRepetitionCard.findUnique({
      where: { id: cardId },
    });

    if (!card) {
      throw new NotFoundException('Card not found');
    }

    if (card.userId !== userId) {
      throw new NotFoundException('Card not found');
    }

    await this.prisma.spacedRepetitionCard.delete({
      where: { id: cardId },
    });

    this.logger.log(`Deleted card ${cardId}`);
  }

  // ─── Private Helper Methods ───────────────────────────────

  /**
   * Validate and normalize flashcards from LLM response
   */
  private validateAndNormalizeFlashcards(
    data: any,
    expectedCount: number,
  ): FlashcardResponse {
    if (!data.cards || !Array.isArray(data.cards) || data.cards.length === 0) {
      throw new Error('Invalid cards array from LLM');
    }

    const cards = data.cards.slice(0, expectedCount).map((c: any, idx: number) => {
      if (!c.front || !c.back) {
        throw new Error(`Invalid card at index ${idx}`);
      }

      return {
        front: String(c.front).trim(),
        back: String(c.back).trim(),
      };
    });

    return { cards };
  }

  /**
   * Validate and normalize stepwise learning response from LLM
   */
  private validateAndNormalizeSteps(data: any): StepwiseLearningResponse {
    if (!data.steps || !Array.isArray(data.steps) || data.steps.length === 0) {
      throw new Error('Invalid steps array from LLM');
    }

    const steps: LearningStep[] = data.steps.map((s: any, idx: number) => {
      if (!s.title || !s.content || !s.comprehensionCheck) {
        throw new Error(`Invalid step at index ${idx}`);
      }

      const cc = s.comprehensionCheck;
      if (!cc.question || !cc.hint || !cc.sampleAnswer) {
        throw new Error(`Invalid comprehension check at step ${idx}`);
      }

      return {
        stepNumber: s.stepNumber || idx + 1,
        title: String(s.title),
        content: String(s.content),
        comprehensionCheck: {
          question: String(cc.question),
          hint: String(cc.hint),
          sampleAnswer: String(cc.sampleAnswer),
        },
      };
    });

    return {
      steps,
      summary: String(data.summary || 'Review complete.'),
    };
  }

  /**
   * Validate step check evaluation response
   */
  private validateStepCheckEvaluation(data: any): StepCheckEvaluationResponse {
    return {
      isCorrect: Boolean(data.isCorrect),
      feedback: String(data.feedback || 'No feedback provided.'),
      encouragement: String(data.encouragement || 'Keep going!'),
    };
  }

  /**
   * Validate and normalize elaboration questions from LLM response
   */
  private validateAndNormalizeElaborationQuestions(questions: any[]): ElaborationQuestion[] {
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error('Invalid questions array from LLM');
    }

    return questions.map((q, idx) => {
      if (!q.question || !q.type || !Array.isArray(q.keyPoints)) {
        throw new Error(`Invalid elaboration question at index ${idx}`);
      }

      return {
        question: String(q.question),
        type: q.type === 'why' ? 'why' : 'how',
        keyPoints: q.keyPoints.map(String),
      };
    });
  }

  /**
   * Validate elaboration evaluation response
   */
  private validateElaborationEvaluation(data: any): ElaborationEvaluationResponse {
    const validRatings = ['Strong', 'Developing', 'Needs Improvement'];
    if (!validRatings.includes(data.rating)) {
      data.rating = 'Developing'; // Default if invalid
    }

    return {
      rating: data.rating,
      addressedPoints: Array.isArray(data.addressedPoints)
        ? data.addressedPoints.map(String)
        : [],
      missedPoints: Array.isArray(data.missedPoints) ? data.missedPoints.map(String) : [],
      feedback: String(data.feedback || 'No feedback provided.'),
      modelElaboration: String(data.modelElaboration || ''),
    };
  }

  /**
   * Validate and normalize questions from LLM response
   */
  private validateAndNormalizeQuestions(questions: any[]): PracticeTestQuestionFull[] {
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error('Invalid questions array from LLM');
    }

    return questions.map((q, idx) => {
      if (!q.question || !q.type || !q.correctAnswer) {
        throw new Error(`Invalid question at index ${idx}`);
      }

      const normalized: PracticeTestQuestionFull = {
        question: String(q.question),
        type: q.type === 'mcq' ? 'mcq' : 'short_answer',
        correctAnswer: String(q.correctAnswer),
        explanation: String(q.explanation || 'No explanation provided.'),
      };

      if (q.type === 'mcq') {
        if (!Array.isArray(q.options) || q.options.length !== 4) {
          throw new Error(`MCQ at index ${idx} must have exactly 4 options`);
        }
        normalized.options = q.options.map(String);
        // Normalize correct answer to uppercase letter
        normalized.correctAnswer = String(q.correctAnswer).toUpperCase().charAt(0);
      } else {
        normalized.keywords = Array.isArray(q.keywords) ? q.keywords.map(String) : [];
      }

      return normalized;
    });
  }

  /**
   * Grade a single answer
   */
  private gradeAnswer(question: PracticeTestQuestionFull, answer: string): boolean {
    if (question.type === 'mcq') {
      // MCQ: exact match on the option letter (case-insensitive)
      const normalizedAnswer = answer.toUpperCase().trim().charAt(0);
      const correctLetter = question.correctAnswer.toUpperCase().charAt(0);
      return normalizedAnswer === correctLetter;
    } else {
      // Short answer: check if answer contains at least 50% of keywords
      const keywords = question.keywords || [];
      if (keywords.length === 0) {
        // If no keywords, do a basic containment check
        return answer.toLowerCase().includes(question.correctAnswer.toLowerCase().slice(0, 20));
      }

      const answerLower = answer.toLowerCase();
      const matchedKeywords = keywords.filter((kw) => answerLower.includes(kw.toLowerCase()));

      return matchedKeywords.length >= Math.ceil(keywords.length * 0.5);
    }
  }
}
