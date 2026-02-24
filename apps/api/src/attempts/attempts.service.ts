import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma';
import { EventBusService } from '../event-bus';
import { MasteryService } from '../mastery';
import { EventTopics } from '@ats/shared';
import type {
  CreateAttempt,
  SubmitAttempt,
  ManualGrade,
  GradeSubmissionPayload,
  GradeCompletedPayload,
} from '@ats/shared';

interface MCQOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

@Injectable()
export class AttemptsService {
  private readonly logger = new Logger(AttemptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly masteryService: MasteryService,
  ) {}

  async create(studentId: string, dto: CreateAttempt) {
    // If assessmentId is provided, get the first question from the assessment
    if (dto.assessmentId) {
      const assessmentQuestion = await this.prisma.assessmentQuestion.findFirst({
        where: { assessmentId: dto.assessmentId },
        orderBy: { orderIndex: 'asc' },
        include: {
          question: true,
          assessment: true,
        },
      });

      if (!assessmentQuestion) {
        throw new NotFoundException('Assessment has no questions');
      }

      // Verify student is enrolled in the course
      const enrollment = await this.prisma.enrollment.findUnique({
        where: {
          studentId_courseId: {
            studentId,
            courseId: assessmentQuestion.assessment.courseId,
          },
        },
      });

      if (!enrollment) {
        throw new ForbiddenException('You must be enrolled in the course to start an attempt');
      }

      return this.prisma.attempt.create({
        data: {
          studentId,
          questionId: assessmentQuestion.questionId,
          assessmentId: dto.assessmentId,
          status: 'in_progress',
        },
        include: {
          question: true,
        },
      });
    }

    // If questionId is provided directly
    if (dto.questionId) {
      const question = await this.prisma.question.findUnique({
        where: { id: dto.questionId },
        include: {
          topic: { include: { course: true } },
          course: true,
        },
      });

      if (!question) {
        throw new NotFoundException(`Question ${dto.questionId} not found`);
      }

      // Determine courseId from question's course or topic's course
      const courseId = question.courseId || question.topic?.course?.id;
      if (courseId) {
        const enrollment = await this.prisma.enrollment.findUnique({
          where: {
            studentId_courseId: { studentId, courseId },
          },
        });

        if (!enrollment) {
          throw new ForbiddenException('You must be enrolled in the course to start an attempt');
        }
      }

      return this.prisma.attempt.create({
        data: {
          studentId,
          questionId: dto.questionId,
          status: 'in_progress',
        },
        include: {
          question: true,
        },
      });
    }

    throw new BadRequestException('Either assessmentId or questionId must be provided');
  }

  async findAll() {
    return this.prisma.attempt.findMany({
      include: {
        question: true,
        student: { select: { id: true, name: true, email: true } },
        gradingResults: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByStudent(studentId: string) {
    return this.prisma.attempt.findMany({
      where: { studentId },
      include: {
        question: {
          include: {
            topic: {
              include: {
                course: { select: { id: true, title: true } },
              },
            },
          },
        },
        gradingResults: {
          include: {
            grader: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id },
      include: {
        question: {
          include: {
            topic: {
              include: {
                course: { select: { id: true, title: true, teacherId: true } },
              },
            },
          },
        },
        gradingResults: {
          include: {
            grader: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        student: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!attempt) {
      throw new NotFoundException(`Attempt ${id} not found`);
    }

    return attempt;
  }

  async update(
    id: string,
    studentId: string,
    dto: {
      textResponse?: string | null;
      selectedOptionIds?: string[] | null;
    },
  ) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id },
    });

    if (!attempt) {
      throw new NotFoundException(`Attempt ${id} not found`);
    }

    if (attempt.studentId !== studentId) {
      throw new ForbiddenException('You can only update your own attempts');
    }

    if (attempt.status !== 'in_progress') {
      throw new BadRequestException('Can only update in-progress attempts');
    }

    const data: Prisma.AttemptUpdateInput = {};
    if (dto.textResponse !== undefined) data.textResponse = dto.textResponse;
    if (dto.selectedOptionIds !== undefined) {
      data.selectedOptionIds = dto.selectedOptionIds as unknown as Prisma.InputJsonValue;
    }

    return this.prisma.attempt.update({
      where: { id },
      data,
    });
  }

  async submit(id: string, studentId: string, dto: SubmitAttempt) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id },
      include: { question: true },
    });

    if (!attempt) {
      throw new NotFoundException(`Attempt ${id} not found`);
    }

    if (attempt.studentId !== studentId) {
      throw new ForbiddenException('You can only submit your own attempts');
    }

    if (attempt.status !== 'in_progress') {
      throw new BadRequestException(
        `Attempt has already been submitted (status: ${attempt.status})`,
      );
    }

    const data: Prisma.AttemptUpdateInput = {
      status: 'submitted',
      textResponse: dto.textResponse ?? attempt.textResponse,
      submittedAt: new Date(),
    };
    if (dto.selectedOptionIds) {
      data.selectedOptionIds = dto.selectedOptionIds as unknown as Prisma.InputJsonValue;
    }

    const updated = await this.prisma.attempt.update({
      where: { id },
      data,
    });

    // Auto-grade MCQ questions immediately
    const qType = attempt.question.type;
    if (qType === 'MCQ_SINGLE' || qType === 'MCQ_MULTI') {
      await this.autoGradeMCQ(
        id,
        attempt.question,
        dto.selectedOptionIds || (attempt.selectedOptionIds as string[] | null),
      );
      return this.findOne(id);
    }

    // For other types, publish grading event for manual/AI grading
    const payload: GradeSubmissionPayload = {
      attemptId: attempt.id,
      questionId: attempt.questionId,
      studentId: attempt.studentId,
      textResponse: dto.textResponse ?? attempt.textResponse,
      maxScore: attempt.question.maxScore,
      rubricJson: attempt.question.rubricJson,
    };

    await this.eventBus.publish(EventTopics.GRADE_SUBMISSION, payload);

    return updated;
  }

  /**
   * Auto-grade MCQ questions by comparing selected options to correct answers.
   */
  private async autoGradeMCQ(
    attemptId: string,
    question: {
      id: string;
      type: string;
      options: unknown;
      correctOptionId: string | null;
      maxScore: number;
    },
    selectedOptionIds: string[] | null,
  ) {
    const options = (question.options || []) as MCQOption[];
    const selected = selectedOptionIds || [];
    let score = 0;
    let feedback = '';

    if (question.type === 'MCQ_SINGLE') {
      const correctOption =
        options.find((o) => o.isCorrect) || options.find((o) => o.id === question.correctOptionId);
      if (correctOption && selected.length === 1 && selected[0] === correctOption.id) {
        score = question.maxScore;
        feedback = 'Correct!';
      } else {
        score = 0;
        feedback = correctOption
          ? `Incorrect. The correct answer was: ${correctOption.text}`
          : 'No correct answer defined for this question.';
      }
    } else if (question.type === 'MCQ_MULTI') {
      const correctIds = new Set(options.filter((o) => o.isCorrect).map((o) => o.id));
      const correctSelected = selected.filter((id) => correctIds.has(id)).length;
      const incorrectSelected = selected.filter((id) => !correctIds.has(id)).length;
      const totalCorrect = correctIds.size;

      if (totalCorrect === 0) {
        score = 0;
        feedback = 'No correct answers defined.';
      } else {
        // Partial credit: correct selections minus incorrect selections, minimum 0
        const rawScore = Math.max(0, (correctSelected - incorrectSelected) / totalCorrect);
        score = Math.round(rawScore * question.maxScore * 100) / 100;

        if (correctSelected === totalCorrect && incorrectSelected === 0) {
          feedback = 'All correct!';
        } else {
          const missed = totalCorrect - correctSelected;
          feedback = `${correctSelected}/${totalCorrect} correct options selected.${
            incorrectSelected > 0 ? ` ${incorrectSelected} incorrect option(s) selected.` : ''
          }${missed > 0 ? ` ${missed} correct option(s) missed.` : ''}`;
        }
      }
    }

    // Create grading result
    const gradingResult = await this.prisma.gradingResult.create({
      data: {
        attemptId,
        score,
        feedback,
        gradedBy: 'auto',
      },
    });

    // Update attempt
    await this.prisma.attempt.update({
      where: { id: attemptId },
      data: {
        status: 'graded',
        currentScore: score,
        autoFeedback: feedback,
      },
    });

    // Update KC mastery
    try {
      await this.masteryService.updateMasteryAfterGrading(gradingResult.id, attemptId);
    } catch (err: any) {
      this.logger.warn(`Failed to update mastery after auto-grade: ${err.message}`);
    }

    // Publish grade completed event
    const gradeCompletedPayload: GradeCompletedPayload = {
      attemptId,
      studentId: '', // will be filled by event handler
      questionId: question.id,
      score,
      feedback,
      gradedBy: 'auto',
    };
    await this.eventBus.publish(EventTopics.GRADE_COMPLETED, gradeCompletedPayload).catch(() => {});
  }

  async findForReview(teacherId: string) {
    return this.prisma.attempt.findMany({
      where: {
        status: { in: ['submitted', 'grading', 'graded'] },
        question: {
          OR: [{ topic: { course: { teacherId } } }, { course: { teacherId } }],
        },
      },
      include: {
        question: {
          include: {
            topic: {
              include: {
                course: { select: { id: true, title: true } },
              },
            },
          },
        },
        student: {
          select: { id: true, name: true, email: true },
        },
        gradingResults: {
          include: {
            grader: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { submittedAt: 'asc' },
    });
  }

  async manualGrade(id: string, teacherId: string, dto: ManualGrade) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id },
      include: {
        question: {
          include: {
            topic: { include: { course: true } },
            course: true,
          },
        },
      },
    });

    if (!attempt) {
      throw new NotFoundException(`Attempt ${id} not found`);
    }

    const courseTeacherId =
      attempt.question.topic?.course?.teacherId || attempt.question.course?.teacherId;
    if (courseTeacherId !== teacherId) {
      throw new ForbiddenException('You can only grade attempts in your own courses');
    }

    if (attempt.status === 'in_progress') {
      throw new BadRequestException('Cannot grade an in-progress attempt');
    }

    if (dto.score > attempt.question.maxScore) {
      throw new BadRequestException(
        `Score cannot exceed max score of ${attempt.question.maxScore}`,
      );
    }

    const gradingResult = await this.prisma.gradingResult.create({
      data: {
        attemptId: id,
        score: dto.score,
        feedback: dto.feedback,
        gradedBy: 'manual',
        graderId: teacherId,
      },
    });

    await this.prisma.attempt.update({
      where: { id },
      data: {
        status: 'graded',
        currentScore: dto.score,
      },
    });

    // Update KC mastery
    await this.masteryService.updateMasteryAfterGrading(gradingResult.id, id);

    // Publish grade completed event
    const gradeCompletedPayload: GradeCompletedPayload = {
      attemptId: id,
      studentId: attempt.studentId,
      questionId: attempt.questionId,
      score: dto.score,
      feedback: dto.feedback,
      gradedBy: 'manual',
    };

    await this.eventBus.publish(EventTopics.GRADE_COMPLETED, gradeCompletedPayload);

    return this.findOne(id);
  }
}
