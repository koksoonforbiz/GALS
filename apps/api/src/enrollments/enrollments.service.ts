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
    // Prompt 03: per-course policy gate. Teacher/admin enroll goes
    // through `create()` and is never affected by this flag.
    if (!course.allowStudentSelfEnroll) {
      throw new ForbiddenException(
        'Self-enrollment is disabled for this course. Contact the teacher for enrollment.',
      );
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
    // Prompt 03: per-course policy gate. Check BEFORE looking up the
    // enrollment so a student doesn't get NotFound when the real reason
    // is policy. Teacher/admin drops go through `dropStudent()` and are
    // never affected by this flag.
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, allowStudentSelfDrop: true },
    });
    if (!course) throw new NotFoundException(`Course ${courseId} not found`);
    if (!course.allowStudentSelfDrop) {
      throw new ForbiddenException(
        'Self-drop is disabled for this course. Contact the teacher to be removed.',
      );
    }

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

  // Teacher/admin-initiated drop by { courseId, userId }. Mirrors the
  // bulk-enroll role-guard pattern: the caller must own the course (or
  // be an admin). Never gated by `allowStudentSelfDrop` — that flag is
  // only about STUDENT-initiated drops.
  //
  // Soft drop: marks the enrollment DROPPED so prior work + logs stay
  // queryable. Idempotent: dropping an already-DROPPED enrollment is a
  // no-op success.
  async dropStudent(callerId: string, courseId: string, userId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, title: true, teacherId: true },
    });
    if (!course) throw new NotFoundException(`Course ${courseId} not found`);

    const caller = await this.prisma.user.findUnique({
      where: { id: callerId },
      select: { role: true },
    });
    if (caller?.role !== 'admin' && course.teacherId !== callerId) {
      throw new ForbiddenException('You can only drop students from your own courses');
    }

    const enrollment = await this.prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId: userId, courseId } },
    });
    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    if (enrollment.status === 'DROPPED') {
      // Idempotent — return the existing row so the UI can refresh.
      return {
        ...enrollment,
        course: { id: course.id, title: course.title },
        alreadyDropped: true,
      };
    }

    const updated = await this.prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { status: 'DROPPED' },
      include: { course: { select: { id: true, title: true } } },
    });
    return { ...updated, alreadyDropped: false };
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
