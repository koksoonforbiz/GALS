import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma';
import type { CreateAssessment } from '@ats/shared';

@Injectable()
export class AssessmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(teacherId: string, dto: CreateAssessment) {
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

    // Verify all questions exist
    const questions = await this.prisma.question.findMany({
      where: { id: { in: dto.questionIds } },
    });

    if (questions.length !== dto.questionIds.length) {
      throw new NotFoundException('One or more questions not found');
    }

    // Create assessment with questions
    return this.prisma.assessment.create({
      data: {
        courseId: dto.courseId,
        title: dto.title,
        description: dto.description,
        questions: {
          create: dto.questionIds.map((questionId, index) => ({
            questionId,
            orderIndex: index,
          })),
        },
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
    return assessments.map((a) => ({
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

  async remove(id: string, teacherId: string) {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id },
      include: { course: true },
    });

    if (!assessment) {
      throw new NotFoundException(`Assessment ${id} not found`);
    }

    if (assessment.course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only delete assessments in your own courses');
    }

    await this.prisma.assessment.delete({ where: { id } });

    return { deleted: true };
  }
}
