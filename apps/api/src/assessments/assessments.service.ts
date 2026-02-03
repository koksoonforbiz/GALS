import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma';

@Injectable()
export class AssessmentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Helper: verify the assessment belongs to this teacher and return it. */
  private async verifyOwnership(assessmentId: string, teacherId: string) {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: { course: true },
    });

    if (!assessment) {
      throw new NotFoundException(`Assessment ${assessmentId} not found`);
    }

    if (assessment.course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only modify assessments in your own courses');
    }

    return assessment;
  }

  /** Standard include clause reused across queries that return a full assessment. */
  private readonly fullInclude = {
    course: { select: { id: true, title: true } },
    questions: {
      orderBy: { orderIndex: 'asc' as const },
      include: { question: true },
    },
    _count: { select: { questions: true } },
  };

  // ─── Create ───────────────────────────────────────────────

  async create(teacherId: string, dto: {
    courseId: string;
    title: string;
    description?: string;
    mode?: string;
    settings?: Record<string, unknown> | null;
    questionIds?: string[];
  }) {
    // Verify course ownership
    const course = await this.prisma.course.findUnique({
      where: { id: dto.courseId },
    });

    if (!course) {
      throw new NotFoundException(`Course ${dto.courseId} not found`);
    }

    if (course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only create assessments in your own courses');
    }

    const questionIds = dto.questionIds ?? [];

    // Verify all questions exist (only when questions are provided)
    if (questionIds.length > 0) {
      const questions = await this.prisma.question.findMany({
        where: { id: { in: questionIds } },
      });

      if (questions.length !== questionIds.length) {
        throw new NotFoundException('One or more questions not found');
      }
    }

    // Create assessment with optional questions
    return this.prisma.assessment.create({
      data: {
        courseId: dto.courseId,
        title: dto.title,
        description: dto.description,
        mode: dto.mode ?? 'practice',
        settings: dto.settings
          ? (dto.settings as any)
          : undefined,
        questions: questionIds.length > 0
          ? {
              create: questionIds.map((questionId, index) => ({
                questionId,
                orderIndex: index,
              })),
            }
          : undefined,
      },
      include: {
        questions: {
          orderBy: { orderIndex: 'asc' },
          include: {
            question: true,
          },
        },
        _count: { select: { questions: true } },
      },
    });
  }

  // ─── Question management ──────────────────────────────────

  async addQuestion(
    assessmentId: string,
    teacherId: string,
    dto: { questionId: string; points?: number; section?: string },
  ) {
    await this.verifyOwnership(assessmentId, teacherId);

    // Verify the question exists
    const question = await this.prisma.question.findUnique({
      where: { id: dto.questionId },
    });

    if (!question) {
      throw new NotFoundException(`Question ${dto.questionId} not found`);
    }

    // Determine the next order index
    const lastItem = await this.prisma.assessmentQuestion.findFirst({
      where: { assessmentId },
      orderBy: { orderIndex: 'desc' },
    });

    const nextIndex = lastItem ? lastItem.orderIndex + 1 : 0;

    await this.prisma.assessmentQuestion.create({
      data: {
        assessmentId,
        questionId: dto.questionId,
        orderIndex: nextIndex,
        points: dto.points,
        section: dto.section,
      },
    });

    return this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: this.fullInclude,
    });
  }

  async removeQuestion(
    assessmentId: string,
    teacherId: string,
    questionId: string,
  ) {
    await this.verifyOwnership(assessmentId, teacherId);

    const link = await this.prisma.assessmentQuestion.findUnique({
      where: {
        assessmentId_questionId: { assessmentId, questionId },
      },
    });

    if (!link) {
      throw new NotFoundException(
        `Question ${questionId} is not part of assessment ${assessmentId}`,
      );
    }

    await this.prisma.assessmentQuestion.delete({
      where: { id: link.id },
    });

    // Re-index remaining questions so order stays contiguous
    const remaining = await this.prisma.assessmentQuestion.findMany({
      where: { assessmentId },
      orderBy: { orderIndex: 'asc' },
    });

    await Promise.all(
      remaining.map((item: any, index: number) =>
        this.prisma.assessmentQuestion.update({
          where: { id: item.id },
          data: { orderIndex: index },
        }),
      ),
    );

    return this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: this.fullInclude,
    });
  }

  async reorderQuestions(
    assessmentId: string,
    teacherId: string,
    questionIds: string[],
  ) {
    await this.verifyOwnership(assessmentId, teacherId);

    // Verify all provided question IDs actually belong to this assessment
    const existing = await this.prisma.assessmentQuestion.findMany({
      where: { assessmentId },
    });

    const existingQIds = new Set(existing.map((e: any) => e.questionId));

    for (const qId of questionIds) {
      if (!existingQIds.has(qId)) {
        throw new NotFoundException(
          `Question ${qId} is not part of assessment ${assessmentId}`,
        );
      }
    }

    // Build a map of questionId -> AssessmentQuestion id for fast lookup
    const qIdToId = new Map(existing.map((e: any) => [e.questionId, e.id]));

    await Promise.all(
      questionIds.map((qId, index) =>
        this.prisma.assessmentQuestion.update({
          where: { id: qIdToId.get(qId)! },
          data: { orderIndex: index },
        }),
      ),
    );

    return this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: this.fullInclude,
    });
  }

  async updateQuestionItem(
    assessmentId: string,
    teacherId: string,
    questionId: string,
    dto: { points?: number; section?: string },
  ) {
    await this.verifyOwnership(assessmentId, teacherId);

    const link = await this.prisma.assessmentQuestion.findUnique({
      where: {
        assessmentId_questionId: { assessmentId, questionId },
      },
    });

    if (!link) {
      throw new NotFoundException(
        `Question ${questionId} is not part of assessment ${assessmentId}`,
      );
    }

    await this.prisma.assessmentQuestion.update({
      where: { id: link.id },
      data: {
        points: dto.points,
        section: dto.section,
      },
    });

    return this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: this.fullInclude,
    });
  }

  // ─── Read ─────────────────────────────────────────────────

  async findByCourse(courseId: string) {
    return this.prisma.assessment.findMany({
      where: { courseId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { questions: true } },
      },
    });
  }

  async findAllForTeacher(teacherId: string) {
    return this.prisma.assessment.findMany({
      where: {
        course: { teacherId },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        course: { select: { id: true, title: true } },
        questions: {
          orderBy: { orderIndex: 'asc' },
          include: { question: true },
        },
      },
    });
  }

  async findAvailable(studentId: string) {
    // Find assessments from courses the student is enrolled in
    const assessments = await this.prisma.assessment.findMany({
      where: {
        course: {
          enrollments: { some: { studentId } },
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        course: {
          select: { id: true, title: true },
        },
        questions: {
          orderBy: { orderIndex: 'asc' },
          select: {
            id: true,
            questionId: true,
          },
        },
      },
    });

    // Map to expected frontend format (assessmentQuestions)
    return assessments.map((a: any) => ({
      ...a,
      assessmentQuestions: a.questions,
      questions: undefined,
    }));
  }

  async findOne(id: string) {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id },
      include: {
        course: {
          select: { id: true, title: true, teacherId: true },
        },
        questions: {
          orderBy: { orderIndex: 'asc' },
          include: {
            question: true,
          },
        },
      },
    });

    if (!assessment) {
      throw new NotFoundException(`Assessment ${id} not found`);
    }

    return assessment;
  }

  // ─── Update ───────────────────────────────────────────────

  async update(
    id: string,
    teacherId: string,
    data: {
      title?: string;
      description?: string;
      mode?: string;
      settings?: { timeLimit?: number; maxAttempts?: number; showSolutions?: boolean; shuffle?: boolean };
      isPublished?: boolean;
    },
  ) {
    await this.verifyOwnership(id, teacherId);

    const { settings, ...rest } = data;

    return this.prisma.assessment.update({
      where: { id },
      data: {
        ...rest,
        ...(settings !== undefined && {
          settings: settings as any,
        }),
      },
      include: this.fullInclude,
    });
  }

  // ─── Delete ───────────────────────────────────────────────

  async remove(id: string, teacherId: string) {
    await this.verifyOwnership(id, teacherId);

    await this.prisma.assessment.delete({ where: { id } });

    return { deleted: true };
  }
}
