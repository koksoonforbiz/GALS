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

  // Teacher-initiated enrollment
  async create(teacherId: string, dto: CreateEnrollment) {
    const course = await this.prisma.course.findUnique({
      where: { id: dto.courseId },
    });

    if (!course) throw new NotFoundException(`Course ${dto.courseId} not found`);
    if (course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only enroll students in your own courses');
    }

    const student = await this.prisma.user.findUnique({
      where: { id: dto.studentId },
    });

    if (!student) throw new NotFoundException(`User ${dto.studentId} not found`);
    if (student.role !== 'student') {
      throw new ForbiddenException('Can only enroll users with student role');
    }

    const existing = await this.prisma.enrollment.findUnique({
      where: {
        studentId_courseId: { studentId: dto.studentId, courseId: dto.courseId },
      },
    });

    if (existing) {
      throw new ConflictException('Student is already enrolled in this course');
    }

    return this.prisma.enrollment.create({
      data: dto,
      include: {
        student: { select: { id: true, name: true, email: true } },
        course: { select: { id: true, title: true } },
      },
    });
  }

  // Student self-enrollment
  async selfEnroll(studentId: string, courseId: string) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });

    if (!course) throw new NotFoundException(`Course ${courseId} not found`);
    if (course.status !== 'PUBLISHED') {
      throw new ForbiddenException('Can only enroll in published courses');
    }
    if (course.visibility !== 'PUBLIC') {
      throw new ForbiddenException('This course is private. Contact the teacher for enrollment.');
    }
    if (course.archivedAt) {
      throw new ForbiddenException('This course has been archived');
    }

    // Check for existing enrollment (may be DROPPED — re-activate)
    const existing = await this.prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
    });

    if (existing) {
      if (existing.status === 'ACTIVE') {
        throw new ConflictException('You are already enrolled in this course');
      }
      // Re-activate dropped enrollment
      return this.prisma.enrollment.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE' },
        include: {
          course: { select: { id: true, title: true } },
        },
      });
    }

    return this.prisma.enrollment.create({
      data: { studentId, courseId, status: 'ACTIVE' },
      include: {
        course: { select: { id: true, title: true } },
      },
    });
  }

  // Student drop
  async drop(studentId: string, courseId: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
    });

    if (!enrollment) throw new NotFoundException('Enrollment not found');
    if (enrollment.status === 'DROPPED') {
      throw new ConflictException('Already dropped from this course');
    }

    return this.prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { status: 'DROPPED' },
      include: {
        course: { select: { id: true, title: true } },
      },
    });
  }

  async findByCourse(courseId: string) {
    return this.prisma.enrollment.findMany({
      where: { courseId },
      include: {
        student: { select: { id: true, name: true, email: true } },
      },
      orderBy: { enrolledAt: 'desc' },
    });
  }

  async findMyEnrollments(studentId: string) {
    return this.prisma.enrollment.findMany({
      where: { studentId, status: 'ACTIVE' },
      include: {
        course: {
          include: {
            teacher: { select: { id: true, name: true } },
            _count: { select: { topics: true, assessments: true, modules: true } },
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

    if (!enrollment) throw new NotFoundException(`Enrollment ${id} not found`);
    if (enrollment.course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only remove enrollments from your own courses');
    }

    await this.prisma.enrollment.delete({ where: { id } });
    return { deleted: true };
  }
}
