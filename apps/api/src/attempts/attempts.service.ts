import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma';
import { EventBusService } from '../event-bus';
import { EventTopics } from '@ats/shared';
import type {
  CreateAttempt,
  SubmitAttempt,
  ManualGrade,
  GradeSubmissionPayload,
  GradeCompletedPayload,
} from '@ats/shared';

@Injectable()
export class AttemptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  async create(studentId: string, dto: CreateAttempt) {
    // If assessmentId is provided, get the first question from the assessment
    if (dto.assessmentId) {
      const assessmentQuestion = await this.prisma.assessmentQuestion.findFirst({
        where: { assessmentId: dto.assessmentId },
        orderBy: { orderIndex: 'asc' },
        include: {
          question: {
            include: {
              topic: { include: { course: true } },
            },
          },
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
        },
      });

      if (!question) {
        throw new NotFoundException(`Question ${dto.questionId} not found`);
      }

      // Verify student is enrolled in the course
      const enrollment = await this.prisma.enrollment.findUnique({
        where: {
          studentId_courseId: {
            studentId,
            courseId: question.topic.course.id,
          },
        },
      });

      if (!enrollment) {
        throw new ForbiddenException('You must be enrolled in the course to start an attempt');
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
        gradingResults: true,
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
        gradingResults: true,
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
    dto: { textResponse?: string | null; strokesJson?: unknown; drawingBlobUrl?: string | null },
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
    if (dto.strokesJson !== undefined) data.strokesJson = dto.strokesJson as Prisma.InputJsonValue;
    if (dto.drawingBlobUrl !== undefined) data.drawingBlobUrl = dto.drawingBlobUrl;

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
    if (dto.strokesJson) data.strokesJson = dto.strokesJson as Prisma.InputJsonValue;
    if (dto.drawingBlobUrl) data.drawingBlobUrl = dto.drawingBlobUrl;

    const updated = await this.prisma.attempt.update({
      where: { id },
      data,
    });

    // Publish grading event
    const payload: GradeSubmissionPayload = {
      attemptId: attempt.id,
      questionId: attempt.questionId,
      studentId: attempt.studentId,
      textResponse: dto.textResponse ?? attempt.textResponse,
      drawingBlobUrl: dto.drawingBlobUrl ?? attempt.drawingBlobUrl,
      maxScore: attempt.question.maxScore,
      rubricJson: attempt.question.rubricJson,
    };

    await this.eventBus.publish(EventTopics.GRADE_SUBMISSION, payload);

    return updated;
  }

  async findForReview(teacherId: string) {
    // Find submitted attempts for courses taught by this teacher
    return this.prisma.attempt.findMany({
      where: {
        status: 'submitted',
        question: {
          topic: {
            course: { teacherId },
          },
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
        gradingResults: true,
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
          },
        },
      },
    });

    if (!attempt) {
      throw new NotFoundException(`Attempt ${id} not found`);
    }

    if (attempt.question.topic.course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only grade attempts in your own courses');
    }

    if (attempt.status === 'graded') {
      throw new BadRequestException('Attempt has already been graded');
    }

    // Validate score against max score
    if (dto.score > attempt.question.maxScore) {
      throw new BadRequestException(
        `Score cannot exceed max score of ${attempt.question.maxScore}`,
      );
    }

    // Create grading result
    await this.prisma.gradingResult.create({
      data: {
        attemptId: id,
        score: dto.score,
        feedback: dto.feedback,
        gradedBy: 'manual',
        graderId: teacherId,
      },
    });

    // Update attempt status
    await this.prisma.attempt.update({
      where: { id },
      data: { status: 'graded' },
    });

    // Publish grade completed event for WebSocket notification
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
