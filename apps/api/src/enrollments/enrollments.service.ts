import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma';
import type { CreateEnrollment } from '@ats/shared';

@Injectable()
export class EnrollmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(teacherId: string, dto: CreateEnrollment) {
    // Verify course ownership
    const course = await this.prisma.course.findUnique({
      where: { id: dto.courseId },
    });

    if (!course) {
      throw new NotFoundException(`Course ${dto.courseId} not found`);
    }

    if (course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only enroll students in your own courses');
    }

    // Verify student exists and is a student
    const student = await this.prisma.user.findUnique({
      where: { id: dto.studentId },
    });

    if (!student) {
      throw new NotFoundException(`User ${dto.studentId} not found`);
    }

    if (student.role !== 'student') {
      throw new ForbiddenException('Can only enroll users with student role');
    }

    // Check for existing enrollment
    const existing = await this.prisma.enrollment.findUnique({
      where: {
        studentId_courseId: {
          studentId: dto.studentId,
          courseId: dto.courseId,
        },
      },
    });

    if (existing) {
      throw new ConflictException('Student is already enrolled in this course');
    }

    return this.prisma.enrollment.create({
      data: dto,
      include: {
        student: {
          select: { id: true, name: true, email: true },
        },
        course: {
          select: { id: true, title: true },
        },
      },
    });
  }

  async findByCourse(courseId: string) {
    return this.prisma.enrollment.findMany({
      where: { courseId },
      include: {
        student: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { enrolledAt: 'desc' },
    });
  }

  async findMyEnrollments(studentId: string) {
    return this.prisma.enrollment.findMany({
      where: { studentId },
      include: {
        course: {
          include: {
            teacher: {
              select: { id: true, name: true },
            },
            _count: { select: { topics: true, assessments: true } },
          },
        },
      },
      orderBy: { enrolledAt: 'desc' },
    });
  }

  async remove(id: string, teacherId: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id },
      include: { course: true },
    });

    if (!enrollment) {
      throw new NotFoundException(`Enrollment ${id} not found`);
    }

    if (enrollment.course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only remove enrollments from your own courses');
    }

    await this.prisma.enrollment.delete({ where: { id } });

    return { deleted: true };
  }
}
