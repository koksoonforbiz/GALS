import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import type { QueryUsersDto } from './dto';
import type {
  BulkProvisionUsers,
  BulkProvisionUserResult,
  BulkProvisionUsersResponse,
  BulkEnroll,
  BulkEnrollResultRow,
  BulkEnrollResponse,
  ResetStudentPassword,
  ResetStudentPasswordResponse,
} from '@ats/shared';

function generateTemporaryPassword(): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const all = upper + lower + digits;

  let password = '';
  password += upper[crypto.randomInt(upper.length)];
  password += lower[crypto.randomInt(lower.length)];
  password += digits[crypto.randomInt(digits.length)];

  for (let i = 3; i < 8; i++) {
    password += all[crypto.randomInt(all.length)];
  }

  // Shuffle
  return password
    .split('')
    .sort(() => crypto.randomInt(3) - 1)
    .join('');
}

@Injectable()
export class UserManagementService {
  private readonly logger = new Logger(UserManagementService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Student List ───────────────────────────────────────

  async getStudents(teacherId: string, query: QueryUsersDto) {
    const page = Math.max(query.page || 1, 1);
    const limit = Math.min(Math.max(query.limit || 20, 1), 100);
    const skip = (page - 1) * limit;

    // Get teacher's course IDs
    const teacherCourses = await this.prisma.course.findMany({
      where: { teacherId },
      select: { id: true, title: true },
    });
    const courseIds = query.courseId ? [query.courseId] : teacherCourses.map((c) => c.id);

    if (courseIds.length === 0) {
      return { students: [], total: 0, page, limit };
    }

    // Build where clause for students enrolled in teacher's courses
    const enrollmentWhere: Prisma.EnrollmentWhereInput = {
      courseId: { in: courseIds },
      status: 'ACTIVE',
    };

    // Get distinct student IDs
    const enrollments = await this.prisma.enrollment.findMany({
      where: enrollmentWhere,
      select: { studentId: true },
      distinct: ['studentId'],
    });

    let studentIds = enrollments.map((e) => e.studentId);

    // Apply search filter
    if (query.search) {
      const searchStudents = await this.prisma.user.findMany({
        where: {
          id: { in: studentIds },
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      studentIds = searchStudents.map((s) => s.id);
    }

    const total = studentIds.length;

    // Get paginated students
    const sortField =
      query.sortBy === 'joinedAt' ? 'createdAt' : query.sortBy === 'name' ? 'name' : 'createdAt';
    const sortOrder = query.sortOrder || 'asc';

    const students = await this.prisma.user.findMany({
      where: { id: { in: studentIds } },
      select: {
        id: true,
        name: true,
        email: true,
        isTemporaryPassword: true,
        createdAt: true,
        enrollments: {
          where: { courseId: { in: courseIds }, status: 'ACTIVE' },
          include: {
            course: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: { [sortField]: sortOrder },
      skip,
      take: limit,
    });

    // Enrich with progress and usage data
    const enrichedStudents = await Promise.all(
      students.map(async (student) => {
        const [tokenUsage, lastAttempt] = await Promise.all([
          this.getTokenUsageForUser(student.id, query.courseId),
          this.prisma.attempt.findFirst({
            where: { studentId: student.id },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          }),
        ]);

        // Get progress per course
        const enrolledCourses = await Promise.all(
          student.enrollments.map(async (enrollment) => {
            const progress = await this.getCourseProgress(student.id, enrollment.courseId);
            return {
              courseId: enrollment.course.id,
              courseName: enrollment.course.title,
              enrolledAt: enrollment.enrolledAt,
              progress,
            };
          }),
        );

        return {
          id: student.id,
          name: student.name,
          email: student.email,
          enrolledCourses,
          tokenUsage,
          joinedAt: student.createdAt,
          lastActiveAt: lastAttempt?.createdAt || student.createdAt,
          isTemporaryPassword: student.isTemporaryPassword,
        };
      }),
    );

    // Sort by cost or lastActive if needed (post-query sort)
    if (query.sortBy === 'cost') {
      enrichedStudents.sort((a, b) => {
        const diff = a.tokenUsage.totalCost - b.tokenUsage.totalCost;
        return sortOrder === 'desc' ? -diff : diff;
      });
    } else if (query.sortBy === 'lastActive') {
      enrichedStudents.sort((a, b) => {
        const diff = new Date(a.lastActiveAt).getTime() - new Date(b.lastActiveAt).getTime();
        return sortOrder === 'desc' ? -diff : diff;
      });
    }

    return { students: enrichedStudents, total, page, limit };
  }

  // ─── Student Detail ─────────────────────────────────────

  async getStudentDetail(teacherId: string, studentId: string) {
    // Verify teacher has access
    const teacherCourses = await this.prisma.course.findMany({
      where: { teacherId },
      select: { id: true },
    });
    const courseIds = teacherCourses.map((c) => c.id);

    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        studentId,
        courseId: { in: courseIds },
        status: 'ACTIVE',
      },
    });

    if (!enrollment) {
      throw new NotFoundException('Student not found in your courses');
    }

    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        name: true,
        email: true,
        isTemporaryPassword: true,
        createdAt: true,
        enrollments: {
          where: { courseId: { in: courseIds }, status: 'ACTIVE' },
          include: {
            course: { select: { id: true, title: true } },
          },
        },
      },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const [tokenUsage, lastAttempt] = await Promise.all([
      this.getTokenUsageForUser(studentId),
      this.prisma.attempt.findFirst({
        where: { studentId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    const enrolledCourses = await Promise.all(
      student.enrollments.map(async (enrollment) => {
        const progress = await this.getCourseProgress(studentId, enrollment.courseId);
        return {
          courseId: enrollment.course.id,
          courseName: enrollment.course.title,
          enrolledAt: enrollment.enrolledAt,
          progress,
        };
      }),
    );

    return {
      id: student.id,
      name: student.name,
      email: student.email,
      enrolledCourses,
      tokenUsage,
      joinedAt: student.createdAt,
      lastActiveAt: lastAttempt?.createdAt || student.createdAt,
      isTemporaryPassword: student.isTemporaryPassword,
    };
  }

  // ─── Teacher Usage ──────────────────────────────────────

  async getTeacherUsage(teacherId: string, dateFrom?: string, dateTo?: string) {
    return this.getTokenUsageForUser(teacherId, undefined, dateFrom, dateTo);
  }

  // ─── Course Usage Summary ───────────────────────────────

  async getCourseUsageSummary(
    teacherId: string,
    courseId: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    // Verify teacher owns course
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, title: true, teacherId: true },
    });

    if (!course || course.teacherId !== teacherId) {
      throw new ForbiddenException('Not your course');
    }

    const enrollments = await this.prisma.enrollment.findMany({
      where: { courseId, status: 'ACTIVE' },
      select: { studentId: true },
    });
    const studentIds = enrollments.map((e) => e.studentId);

    const dateWhere: Prisma.LlmUsageLogWhereInput = { courseId };
    if (dateFrom)
      dateWhere.createdAt = { ...(dateWhere.createdAt as object), gte: new Date(dateFrom) };
    if (dateTo) dateWhere.createdAt = { ...(dateWhere.createdAt as object), lte: new Date(dateTo) };

    const logs = await this.prisma.llmUsageLog.groupBy({
      by: ['provider', 'model', 'feature', 'modality'],
      where: dateWhere,
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        totalCost: true,
      },
    });

    const byProvider: Record<
      string,
      {
        totalTokens: number;
        totalCost: number;
        byModel: Record<string, { inputTokens: number; outputTokens: number; totalCost: number }>;
      }
    > = {};
    const byFeature: Record<string, { totalTokens: number; totalCost: number }> = {};
    const coursModalityCost: Record<string, number> = { text: 0, image: 0 };

    let totalTokens = 0;
    let totalCost = 0;

    for (const log of logs) {
      const t = log._sum.totalTokens || 0;
      const c = log._sum.totalCost || 0;
      totalTokens += t;
      totalCost += c;

      // By provider/model
      if (!byProvider[log.provider]) {
        byProvider[log.provider] = { totalTokens: 0, totalCost: 0, byModel: {} };
      }
      const provEntry = byProvider[log.provider]!;
      provEntry.totalTokens += t;
      provEntry.totalCost += c;

      if (!provEntry.byModel[log.model]) {
        provEntry.byModel[log.model] = { inputTokens: 0, outputTokens: 0, totalCost: 0 };
      }
      const modelEntry = provEntry.byModel[log.model]!;
      modelEntry.inputTokens += log._sum.inputTokens || 0;
      modelEntry.outputTokens += log._sum.outputTokens || 0;
      modelEntry.totalCost += c;

      // By feature
      if (!byFeature[log.feature]) {
        byFeature[log.feature] = { totalTokens: 0, totalCost: 0 };
      }
      const featEntry = byFeature[log.feature]!;
      featEntry.totalTokens += t;
      featEntry.totalCost += c;

      // By modality
      const mod = log.modality ?? 'text';
      coursModalityCost[mod] = (coursModalityCost[mod] ?? 0) + c;
    }

    // Top students by usage
    const topStudents = await this.prisma.llmUsageLog.groupBy({
      by: ['userId'],
      where: { courseId, userId: { in: studentIds } },
      _sum: { totalTokens: true, totalCost: true },
      orderBy: { _sum: { totalCost: 'desc' } },
      take: 10,
    });

    const topStudentDetails = await Promise.all(
      topStudents.map(async (ts) => {
        const user = await this.prisma.user.findUnique({
          where: { id: ts.userId },
          select: { id: true, name: true },
        });
        return {
          id: ts.userId,
          name: user?.name || 'Unknown',
          totalTokens: ts._sum.totalTokens || 0,
          totalCost: ts._sum.totalCost || 0,
        };
      }),
    );

    // Daily usage (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyLogs = await this.prisma.llmUsageLog.findMany({
      where: { courseId, createdAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true, totalTokens: true, totalCost: true },
    });

    const dailyMap: Record<string, { tokens: number; cost: number }> = {};
    for (const log of dailyLogs) {
      const date = log.createdAt.toISOString().slice(0, 10);
      if (!dailyMap[date]) dailyMap[date] = { tokens: 0, cost: 0 };
      dailyMap[date].tokens += log.totalTokens;
      dailyMap[date].cost += log.totalCost;
    }

    const dailyUsage = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        date,
        tokens: data.tokens,
        cost: Math.round(data.cost * 1000000) / 1000000,
      }));

    // Average progress
    let avgProgress = 0;
    if (studentIds.length > 0) {
      const progresses = await Promise.all(
        studentIds.slice(0, 50).map((sid) => this.getCourseProgress(sid, courseId)),
      );
      avgProgress = Math.round(
        progresses.reduce((sum, p) => sum + p.percentage, 0) / progresses.length,
      );
    }

    return {
      courseId: course.id,
      courseName: course.title,
      totalStudents: studentIds.length,
      averageProgress: avgProgress,
      totalTokens,
      totalCost: Math.round(totalCost * 1000000) / 1000000,
      textCost: Math.round((coursModalityCost['text'] ?? 0) * 1000000) / 1000000,
      imageCost: Math.round((coursModalityCost['image'] ?? 0) * 1000000) / 1000000,
      byProvider,
      byFeature,
      topStudentsByUsage: topStudentDetails,
      dailyUsage,
    };
  }

  // ─── Token Usage Aggregation ────────────────────────────

  async getTokenUsageForUser(
    userId: string,
    courseId?: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const where: Prisma.LlmUsageLogWhereInput = { userId };
    if (courseId) where.courseId = courseId;
    if (dateFrom) where.createdAt = { ...(where.createdAt as object), gte: new Date(dateFrom) };
    if (dateTo) where.createdAt = { ...(where.createdAt as object), lte: new Date(dateTo) };

    const logs = await this.prisma.llmUsageLog.groupBy({
      by: ['provider', 'model', 'feature', 'modality'],
      where,
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        inputCost: true,
        outputCost: true,
        totalCost: true,
      },
    });

    const byProvider: Record<
      string,
      {
        totalTokens: number;
        totalCost: number;
        byModel: Record<string, { inputTokens: number; outputTokens: number; totalCost: number }>;
      }
    > = {};
    const byFeature: Record<string, { totalTokens: number; totalCost: number }> = {};
    const byModality: Record<string, number> = { text: 0, image: 0 };

    let totalTokens = 0;
    let totalCost = 0;

    for (const log of logs) {
      const t = log._sum.totalTokens || 0;
      const c = log._sum.totalCost || 0;
      totalTokens += t;
      totalCost += c;

      // By provider/model
      if (!byProvider[log.provider]) {
        byProvider[log.provider] = { totalTokens: 0, totalCost: 0, byModel: {} };
      }
      const provEntry2 = byProvider[log.provider]!;
      provEntry2.totalTokens += t;
      provEntry2.totalCost += c;

      if (!provEntry2.byModel[log.model]) {
        provEntry2.byModel[log.model] = { inputTokens: 0, outputTokens: 0, totalCost: 0 };
      }
      const modelEntry2 = provEntry2.byModel[log.model]!;
      modelEntry2.inputTokens += log._sum.inputTokens || 0;
      modelEntry2.outputTokens += log._sum.outputTokens || 0;
      modelEntry2.totalCost += c;

      // By feature
      if (!byFeature[log.feature]) {
        byFeature[log.feature] = { totalTokens: 0, totalCost: 0 };
      }
      const featEntry2 = byFeature[log.feature]!;
      featEntry2.totalTokens += t;
      featEntry2.totalCost += c;

      // By modality (text vs image)
      const mod = log.modality ?? 'text';
      byModality[mod] = (byModality[mod] ?? 0) + c;
    }

    return {
      totalTokens,
      totalCost: Math.round(totalCost * 1000000) / 1000000,
      textCost: Math.round((byModality['text'] ?? 0) * 1000000) / 1000000,
      imageCost: Math.round((byModality['image'] ?? 0) * 1000000) / 1000000,
      byProvider,
      byFeature,
    };
  }

  // ─── Student Onboarding ─────────────────────────────────

  async addStudent(teacherId: string, dto: { name: string; email: string; courseIds: string[] }) {
    // Validate courses belong to teacher
    const courses = await this.prisma.course.findMany({
      where: { id: { in: dto.courseIds }, teacherId },
      select: { id: true, title: true },
    });
    if (courses.length !== dto.courseIds.length) {
      throw new ForbiddenException('Some courses do not belong to you');
    }

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existingUser) {
      if (existingUser.role !== 'student') {
        throw new ConflictException('A non-student account exists with this email');
      }

      // Enroll in new courses
      let enrolledCount = 0;
      for (const courseId of dto.courseIds) {
        const existing = await this.prisma.enrollment.findUnique({
          where: { studentId_courseId: { studentId: existingUser.id, courseId } },
        });
        if (!existing) {
          await this.prisma.enrollment.create({
            data: { studentId: existingUser.id, courseId, status: 'ACTIVE' },
          });
          enrolledCount++;
        } else if (existing.status === 'DROPPED') {
          await this.prisma.enrollment.update({
            where: { id: existing.id },
            data: { status: 'ACTIVE' },
          });
          enrolledCount++;
        }
      }

      if (enrolledCount === 0) {
        throw new ConflictException('Student is already enrolled in all specified courses');
      }

      return {
        studentId: existingUser.id,
        email: existingUser.email,
        name: existingUser.name,
        temporaryPassword: null,
        emailSent: false,
        enrolledCourses: courses.map((c) => c.title),
        message: `Existing student enrolled in ${enrolledCount} new course(s).`,
      };
    }

    // Create new student
    const tempPassword = generateTemporaryPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const newUser = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        name: dto.name,
        passwordHash: hashedPassword,
        role: 'student',
        isTemporaryPassword: true,
        invitedBy: teacherId,
        invitedAt: new Date(),
      },
    });

    // Enroll in courses
    for (const courseId of dto.courseIds) {
      await this.prisma.enrollment.create({
        data: { studentId: newUser.id, courseId, status: 'ACTIVE' },
      });
    }

    return {
      studentId: newUser.id,
      email: newUser.email,
      name: newUser.name,
      temporaryPassword: tempPassword,
      emailSent: false, // No email service
      enrolledCourses: courses.map((c) => c.title),
      message: 'Student created and enrolled. Please share the temporary password manually.',
    };
  }

  async bulkAddStudents(
    teacherId: string,
    dto: { students: Array<{ email: string; name: string }>; courseIds: string[] },
  ) {
    const results: Array<{
      email: string;
      status: 'created' | 'already_enrolled' | 'enrolled_existing' | 'failed';
      temporaryPassword?: string;
      error?: string;
    }> = [];

    let created = 0;
    let alreadyExisted = 0;
    let failed = 0;

    for (const student of dto.students) {
      try {
        const result = await this.addStudent(teacherId, {
          name: student.name,
          email: student.email,
          courseIds: dto.courseIds,
        });

        if (result.temporaryPassword) {
          results.push({
            email: student.email,
            status: 'created',
            temporaryPassword: result.temporaryPassword,
          });
          created++;
        } else {
          results.push({ email: student.email, status: 'enrolled_existing' });
          alreadyExisted++;
        }
      } catch (err) {
        if (err instanceof ConflictException) {
          results.push({ email: student.email, status: 'already_enrolled' });
          alreadyExisted++;
        } else {
          results.push({
            email: student.email,
            status: 'failed',
            error: err instanceof Error ? err.message : 'Unknown error',
          });
          failed++;
        }
      }
    }

    return { created, alreadyExisted, failed, results };
  }

  // ─── Teacher-issued password reset (prompt 05) ─────────────────
  //
  // The caller (teacher/admin, role-checked by RolesGuard at the
  // controller) supplies the new plaintext password directly. We:
  //   1. Re-verify the teacher actually has access to this student
  //      (i.e. the student is enrolled in at least one of their
  //      courses). Admins bypass this check.
  //   2. Re-hash with bcryptjs at salt rounds 10 — same library and
  //      cost factor used everywhere else in this codebase (register,
  //      bulk-provision, resendInvitation), so a hash produced here is
  //      indistinguishable from any other.
  //   3. Set `isTemporaryPassword = true` so the teacher roster still
  //      shows the "Temp pwd" badge — useful as a visual hint that the
  //      teacher just touched this account. There is intentionally NO
  //      force-rotate-on-login enforcement (prompt 05 removed that
  //      flow); the flag is purely informational now.
  //
  // We DO NOT echo the plaintext password back to the client. The
  // teacher already knows what they typed and we don't want it landing
  // in any analytics/log replay surface.
  async resetStudentPassword(
    callerId: string,
    studentId: string,
    dto: ResetStudentPassword,
  ): Promise<ResetStudentPasswordResponse> {
    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, email: true, role: true },
    });
    if (!student) {
      throw new NotFoundException(`User ${studentId} not found`);
    }
    // Only students get teacher-issued passwords. Refuse on
    // teacher/admin accounts so a malicious teacher can't pivot to
    // someone else's privileged account through this route.
    if (student.role !== 'student') {
      throw new ForbiddenException(
        'Teacher-issued password reset is only available for student accounts',
      );
    }

    const caller = await this.prisma.user.findUnique({
      where: { id: callerId },
      select: { role: true },
    });
    if (!caller) {
      throw new ForbiddenException('Caller not found');
    }

    // Admins can reset any student. Teachers can only reset students
    // who are currently enrolled in at least one of their courses —
    // mirrors the access scoping used in getStudentDetail().
    if (caller.role !== 'admin') {
      const teacherCourses = await this.prisma.course.findMany({
        where: { teacherId: callerId },
        select: { id: true },
      });
      const courseIds = teacherCourses.map((c) => c.id);

      const sharedEnrollment = await this.prisma.enrollment.findFirst({
        where: { studentId, courseId: { in: courseIds }, status: 'ACTIVE' },
      });
      if (!sharedEnrollment) {
        throw new ForbiddenException(
          'You can only reset passwords for students enrolled in your courses',
        );
      }
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.user.update({
      where: { id: studentId },
      data: {
        passwordHash,
        isTemporaryPassword: true,
        passwordChangedAt: new Date(),
      },
    });

    return {
      userId: student.id,
      email: student.email,
      message: 'Password reset. Share the new password with the student manually.',
    };
  }

  async resendInvitation(teacherId: string, studentId: string) {
    // Verify access
    const teacherCourses = await this.prisma.course.findMany({
      where: { teacherId },
      select: { id: true },
    });
    const courseIds = teacherCourses.map((c) => c.id);

    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId, courseId: { in: courseIds }, status: 'ACTIVE' },
    });

    if (!enrollment) {
      throw new NotFoundException('Student not found in your courses');
    }

    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    // Generate new temporary password
    const tempPassword = generateTemporaryPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    await this.prisma.user.update({
      where: { id: studentId },
      data: {
        passwordHash: hashedPassword,
        isTemporaryPassword: true,
      },
    });

    return {
      studentId,
      email: student.email,
      temporaryPassword: tempPassword,
      emailSent: false,
      message: 'New temporary password generated. Please share it manually.',
    };
  }

  // ─── Bulk Provisioning (prompt 02) ──────────────────────
  //
  // Teacher-driven creation of N users at once from a spreadsheet
  // (email, loginId, password, optional name/role). Hashes every
  // password with the same bcryptjs library used in AuthService —
  // plaintext is never logged or returned. Per-row results so the UI
  // can mark which rows succeeded/failed without losing the rest of
  // the batch on a single conflict.
  //
  // When `enrollCourseId` is supplied, every successfully-resolved row
  // (newly created OR existing user matched by email/loginId) is also
  // enrolled in the course. Idempotent via the [studentId, courseId]
  // unique constraint.

  async bulkProvisionUsers(
    teacherId: string,
    dto: BulkProvisionUsers,
  ): Promise<BulkProvisionUsersResponse> {
    // If enrollCourseId was passed, verify ownership upfront. This
    // also protects against teachers accidentally enrolling users into
    // courses they don't own.
    let enrollCourseId: string | undefined;
    if (dto.enrollCourseId) {
      const course = await this.prisma.course.findUnique({
        where: { id: dto.enrollCourseId },
        select: { id: true, teacherId: true },
      });
      if (!course) {
        throw new NotFoundException(`Course ${dto.enrollCourseId} not found`);
      }
      // Admins can enroll into any course; teachers only their own.
      const teacher = await this.prisma.user.findUnique({
        where: { id: teacherId },
        select: { role: true },
      });
      if (teacher?.role !== 'admin' && course.teacherId !== teacherId) {
        throw new ForbiddenException('You can only enroll into your own courses');
      }
      enrollCourseId = course.id;
    }

    // Pre-scan: detect within-batch duplicate emails/loginIds so we
    // mark them as errors instead of letting only the first one win.
    const emailCount = new Map<string, number>();
    const loginIdCount = new Map<string, number>();
    for (const row of dto.rows) {
      const e = row.email.toLowerCase();
      emailCount.set(e, (emailCount.get(e) || 0) + 1);
      loginIdCount.set(row.loginId, (loginIdCount.get(row.loginId) || 0) + 1);
    }

    const results: BulkProvisionUserResult[] = [];
    let createdCount = 0;
    let skippedCount = 0;
    let erroredCount = 0;
    let enrolledCount = 0;

    for (let i = 0; i < dto.rows.length; i++) {
      const row = dto.rows[i]!;
      const emailLower = row.email.toLowerCase();

      const baseResult: BulkProvisionUserResult = {
        rowIndex: i,
        email: row.email,
        loginId: row.loginId,
        status: 'error',
      };

      // In-batch duplicate guards. Only the first occurrence is
      // allowed through; subsequent duplicates error.
      if ((emailCount.get(emailLower) || 0) > 1) {
        const firstIndex = dto.rows.findIndex((r) => r.email.toLowerCase() === emailLower);
        if (firstIndex !== i) {
          results.push({
            ...baseResult,
            status: 'error',
            message: `Duplicate email in batch (also appears at row ${firstIndex + 1})`,
          });
          erroredCount++;
          continue;
        }
      }
      if ((loginIdCount.get(row.loginId) || 0) > 1) {
        const firstIndex = dto.rows.findIndex((r) => r.loginId === row.loginId);
        if (firstIndex !== i) {
          results.push({
            ...baseResult,
            status: 'error',
            message: `Duplicate loginId in batch (also appears at row ${firstIndex + 1})`,
          });
          erroredCount++;
          continue;
        }
      }

      try {
        // Look up by email AND by loginId — if either matches, treat
        // as an existing-user skip. The two lookups are separate so
        // we can report which column conflicted.
        const [byEmail, byLoginId] = await Promise.all([
          this.prisma.user.findUnique({
            where: { email: emailLower },
            select: { id: true, email: true, loginId: true },
          }),
          this.prisma.user.findUnique({
            where: { loginId: row.loginId },
            select: { id: true, email: true, loginId: true },
          }),
        ]);

        // Conflict cases first: an email collides with one user and a
        // loginId collides with a DIFFERENT user → can't safely
        // assign loginId to either, so it's an error.
        if (byEmail && byLoginId && byEmail.id !== byLoginId.id) {
          results.push({
            ...baseResult,
            status: 'error',
            message: 'Email and loginId map to different existing users',
          });
          erroredCount++;
          continue;
        }

        const existing = byEmail || byLoginId;
        let userId: string;

        if (existing) {
          // Already exists. We don't overwrite password and we don't
          // change the loginId (a teacher silently mutating someone
          // else's account is a footgun). If the existing row lacks a
          // loginId but the email matches, we DO populate the
          // loginId — that's a non-destructive enrichment.
          if (byEmail && !byEmail.loginId && (!byLoginId || byLoginId.id === byEmail.id)) {
            await this.prisma.user.update({
              where: { id: byEmail.id },
              data: { loginId: row.loginId },
            });
          }
          userId = existing.id;
          results.push({
            ...baseResult,
            status: 'skipped',
            userId,
            message: 'User already exists; no changes to password',
          });
          skippedCount++;
        } else {
          const passwordHash = await bcrypt.hash(row.password, 10);
          const created = await this.prisma.user.create({
            data: {
              email: emailLower,
              loginId: row.loginId,
              passwordHash,
              name: row.name?.trim() || row.loginId,
              role: row.role || 'student',
              isTemporaryPassword: true,
              invitedBy: teacherId,
              invitedAt: new Date(),
            },
            select: { id: true },
          });
          userId = created.id;
          results.push({
            ...baseResult,
            status: 'created',
            userId,
          });
          createdCount++;
        }

        // Optional enrollment for THIS row. Only attempt for student
        // accounts — refuse to enroll teachers/admins as students.
        if (enrollCourseId) {
          const enrollRes = await this.enrollOne(userId, enrollCourseId);
          if (enrollRes.status === 'enrolled' || enrollRes.status === 'reactivated') {
            enrolledCount++;
          }
          const last = results[results.length - 1]!;
          last.enrollment = {
            status: enrollRes.status,
            message: enrollRes.message,
          };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        // NEVER include the plaintext password in the error message.
        results.push({
          ...baseResult,
          status: 'error',
          message,
        });
        erroredCount++;
        this.logger.warn(`bulkProvisionUsers row ${i} failed for email=${emailLower}: ${message}`);
      }
    }

    return {
      results,
      summary: {
        created: createdCount,
        skipped: skippedCount,
        errored: erroredCount,
        ...(enrollCourseId ? { enrolled: enrolledCount } : {}),
      },
    };
  }

  // ─── Bulk Enrollment (prompt 02) ─────────────────────────
  //
  // Idempotent enrollment of N users into a single course. The
  // single-enroll endpoint (`EnrollmentsService.create`) throws on
  // duplicates; this variant skips them and reports per-row results
  // so a teacher's UI doesn't have to do N separate POSTs.

  async bulkEnroll(teacherId: string, dto: BulkEnroll): Promise<BulkEnrollResponse> {
    const course = await this.prisma.course.findUnique({
      where: { id: dto.courseId },
      select: { id: true, teacherId: true },
    });
    if (!course) {
      throw new NotFoundException(`Course ${dto.courseId} not found`);
    }
    const teacher = await this.prisma.user.findUnique({
      where: { id: teacherId },
      select: { role: true },
    });
    if (teacher?.role !== 'admin' && course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only enroll into your own courses');
    }

    const results: BulkEnrollResultRow[] = [];
    let enrolled = 0;
    let alreadyEnrolled = 0;
    let errored = 0;

    // De-dupe userIds while preserving order so the per-row UI feedback
    // stays meaningful.
    const seen = new Set<string>();
    for (const userId of dto.userIds) {
      if (seen.has(userId)) continue;
      seen.add(userId);

      const res = await this.enrollOne(userId, course.id);
      const row: BulkEnrollResultRow = {
        userId,
        status: res.status,
      };
      if (res.enrollmentId) row.enrollmentId = res.enrollmentId;
      if (res.message) row.message = res.message;
      results.push(row);

      if (res.status === 'enrolled' || res.status === 'reactivated') enrolled++;
      else if (res.status === 'already_enrolled') alreadyEnrolled++;
      else if (res.status === 'error') errored++;
    }

    return {
      results,
      summary: { enrolled, alreadyEnrolled, errored },
    };
  }

  // Single-user enrollment with idempotent semantics. Used by both
  // bulkProvisionUsers (when enrollCourseId is set) and bulkEnroll.
  // Returns a discriminated status so the caller can aggregate.
  private async enrollOne(
    userId: string,
    courseId: string,
  ): Promise<{
    status: 'enrolled' | 'already_enrolled' | 'reactivated' | 'error' | 'skipped';
    enrollmentId?: string;
    message?: string;
  }> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true },
      });
      if (!user) {
        return { status: 'error', message: 'User not found' };
      }
      if (user.role !== 'student') {
        return { status: 'skipped', message: 'User is not a student' };
      }

      const existing = await this.prisma.enrollment.findUnique({
        where: { studentId_courseId: { studentId: userId, courseId } },
      });

      if (existing) {
        if (existing.status === 'ACTIVE') {
          return {
            status: 'already_enrolled',
            enrollmentId: existing.id,
          };
        }
        const updated = await this.prisma.enrollment.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE' },
        });
        return { status: 'reactivated', enrollmentId: updated.id };
      }

      const created = await this.prisma.enrollment.create({
        data: { studentId: userId, courseId, status: 'ACTIVE' },
      });
      return { status: 'enrolled', enrollmentId: created.id };
    } catch (err) {
      return {
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  // ─── Pricing ────────────────────────────────────────────

  async getPricing() {
    return this.prisma.llmModelPricing.findMany({
      where: { isActive: true },
      orderBy: [{ provider: 'asc' }, { model: 'asc' }],
    });
  }

  async updatePricing(id: string, data: { inputPricePer1k: number; outputPricePer1k: number }) {
    const existing = await this.prisma.llmModelPricing.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Pricing entry not found');

    return this.prisma.llmModelPricing.update({
      where: { id },
      data: {
        inputPricePer1k: data.inputPricePer1k,
        outputPricePer1k: data.outputPricePer1k,
      },
    });
  }

  // ─── Course Overview ────────────────────────────────────

  async getCoursesOverview(teacherId: string) {
    const courses = await this.prisma.course.findMany({
      where: { teacherId },
      select: {
        id: true,
        title: true,
        _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
      },
    });

    const overviews = await Promise.all(
      courses.map(async (course) => {
        // Get aggregated usage for this course
        const usageAgg = await this.prisma.llmUsageLog.aggregate({
          where: { courseId: course.id },
          _sum: { totalTokens: true, totalCost: true },
        });

        // Usage by provider
        const providerUsage = await this.prisma.llmUsageLog.groupBy({
          by: ['provider'],
          where: { courseId: course.id },
          _sum: { totalCost: true },
        });

        const byProvider: Record<string, number> = {};
        for (const pu of providerUsage) {
          byProvider[pu.provider] = Math.round((pu._sum.totalCost || 0) * 1000000) / 1000000;
        }

        // Average progress
        const enrollments = await this.prisma.enrollment.findMany({
          where: { courseId: course.id, status: 'ACTIVE' },
          select: { studentId: true },
          take: 50,
        });

        let avgProgress = 0;
        if (enrollments.length > 0) {
          const progresses = await Promise.all(
            enrollments.map((e) => this.getCourseProgress(e.studentId, course.id)),
          );
          avgProgress = Math.round(
            progresses.reduce((sum, p) => sum + p.percentage, 0) / progresses.length,
          );
        }

        return {
          courseId: course.id,
          courseName: course.title,
          totalStudents: course._count.enrollments,
          averageProgress: avgProgress,
          totalAiCost: Math.round((usageAgg._sum.totalCost || 0) * 1000000) / 1000000,
          byProvider,
        };
      }),
    );

    return overviews;
  }

  // ─── CSV Export ─────────────────────────────────────────

  async exportStudentsCsv(teacherId: string, courseId?: string) {
    const result = await this.getStudents(teacherId, {
      courseId,
      page: 1,
      limit: 10000,
    });

    const rows: string[] = ['Name,Email,Courses,Progress,AI Cost,Joined,Last Active,Temp Password'];

    for (const student of result.students) {
      const courses = student.enrolledCourses
        .map((c: { courseName: string }) => c.courseName)
        .join('; ');
      const progress = student.enrolledCourses
        .map(
          (c: { courseName: string; progress: { percentage: number } }) =>
            `${c.courseName}: ${c.progress.percentage}%`,
        )
        .join('; ');
      const csvRow = [
        `"${student.name}"`,
        student.email,
        `"${courses}"`,
        `"${progress}"`,
        `$${student.tokenUsage.totalCost.toFixed(4)}`,
        new Date(student.joinedAt).toISOString().slice(0, 10),
        new Date(student.lastActiveAt).toISOString().slice(0, 10),
        student.isTemporaryPassword ? 'Yes' : 'No',
      ].join(',');
      rows.push(csvRow);
    }

    return rows.join('\n');
  }

  // ─── Private Helpers ────────────────────────────────────

  private async getCourseProgress(
    studentId: string,
    courseId: string,
  ): Promise<{
    lessonsCompleted: number;
    totalLessons: number;
    percentage: number;
    quizzesCompleted: number;
    averageQuizScore: number;
    lastActiveAt: Date | null;
  }> {
    // Count total topics (lessons) in the course
    const totalLessons = await this.prisma.topic.count({
      where: { courseId },
    });

    // Count lessons with at least one completed attempt
    const completedLessons = await this.prisma.attempt.findMany({
      where: {
        studentId,
        status: 'graded',
        question: { topic: { courseId } },
      },
      select: { question: { select: { topicId: true } } },
      distinct: ['questionId'],
    });

    const uniqueTopicIds = new Set(completedLessons.map((a) => a.question.topicId));
    const lessonsCompleted = uniqueTopicIds.size;

    // Count completed assessments (quizzes)
    const assessmentAttempts = await this.prisma.attempt.findMany({
      where: {
        studentId,
        status: 'graded',
        assessmentId: { not: null },
        question: { topic: { courseId } },
      },
      select: {
        assessmentId: true,
        currentScore: true,
      },
    });

    const uniqueAssessments = new Set(assessmentAttempts.map((a) => a.assessmentId));
    const quizzesCompleted = uniqueAssessments.size;

    const scores = assessmentAttempts
      .filter((a) => a.currentScore !== null)
      .map((a) => a.currentScore!);
    const averageQuizScore =
      scores.length > 0
        ? Math.round((scores.reduce((sum, s) => sum + s, 0) / scores.length) * 100) / 100
        : 0;

    // Last activity
    const lastAttempt = await this.prisma.attempt.findFirst({
      where: {
        studentId,
        question: { topic: { courseId } },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    return {
      lessonsCompleted,
      totalLessons,
      percentage: totalLessons > 0 ? Math.round((lessonsCompleted / totalLessons) * 100) : 0,
      quizzesCompleted,
      averageQuizScore,
      lastActiveAt: lastAttempt?.createdAt || null,
    };
  }
}
