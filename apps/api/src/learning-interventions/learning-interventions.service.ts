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
  buildPracticeTestingPrompt,
  PracticeTestResponse,
} from './prompts/practice-testing.prompt';

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

  // ─── Private Helper Methods ───────────────────────────────

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
