import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import type { QueryUsersDto } from './dto';

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
    const courseIds = query.courseId
      ? [query.courseId]
      : teacherCourses.map((c) => c.id);

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

  async getCourseUsageSummary(teacherId: string, courseId: string, dateFrom?: string, dateTo?: string) {
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
    if (dateFrom) dateWhere.createdAt = { ...dateWhere.createdAt as object, gte: new Date(dateFrom) };
    if (dateTo) dateWhere.createdAt = { ...dateWhere.createdAt as object, lte: new Date(dateTo) };

    const logs = await this.prisma.llmUsageLog.groupBy({
      by: ['provider', 'model', 'feature'],
      where: dateWhere,
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        totalCost: true,
      },
    });

    const byProvider: Record<string, { totalTokens: number; totalCost: number; byModel: Record<string, { inputTokens: number; outputTokens: number; totalCost: number }> }> = {};
    const byFeature: Record<string, { totalTokens: number; totalCost: number }> = {};

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
      byProvider[log.provider].totalTokens += t;
      byProvider[log.provider].totalCost += c;

      if (!byProvider[log.provider].byModel[log.model]) {
        byProvider[log.provider].byModel[log.model] = { inputTokens: 0, outputTokens: 0, totalCost: 0 };
      }
      byProvider[log.provider].byModel[log.model].inputTokens += log._sum.inputTokens || 0;
      byProvider[log.provider].byModel[log.model].outputTokens += log._sum.outputTokens || 0;
      byProvider[log.provider].byModel[log.model].totalCost += c;

      // By feature
      if (!byFeature[log.feature]) {
        byFeature[log.feature] = { totalTokens: 0, totalCost: 0 };
      }
      byFeature[log.feature].totalTokens += t;
      byFeature[log.feature].totalCost += c;
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
      .map(([date, data]) => ({ date, tokens: data.tokens, cost: Math.round(data.cost * 1000000) / 1000000 }));

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
      byProvider,
      byFeature,
      topStudentsByUsage: topStudentDetails,
      dailyUsage,
    };
  }

  // ─── Token Usage Aggregation ────────────────────────────

  async getTokenUsageForUser(userId: string, courseId?: string, dateFrom?: string, dateTo?: string) {
    const where: Prisma.LlmUsageLogWhereInput = { userId };
    if (courseId) where.courseId = courseId;
    if (dateFrom) where.createdAt = { ...where.createdAt as object, gte: new Date(dateFrom) };
    if (dateTo) where.createdAt = { ...where.createdAt as object, lte: new Date(dateTo) };

    const logs = await this.prisma.llmUsageLog.groupBy({
      by: ['provider', 'model', 'feature'],
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

    const byProvider: Record<string, { totalTokens: number; totalCost: number; byModel: Record<string, { inputTokens: number; outputTokens: number; totalCost: number }> }> = {};
    const byFeature: Record<string, { totalTokens: number; totalCost: number }> = {};

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
      byProvider[log.provider].totalTokens += t;
      byProvider[log.provider].totalCost += c;

      if (!byProvider[log.provider].byModel[log.model]) {
        byProvider[log.provider].byModel[log.model] = { inputTokens: 0, outputTokens: 0, totalCost: 0 };
      }
      byProvider[log.provider].byModel[log.model].inputTokens += log._sum.inputTokens || 0;
      byProvider[log.provider].byModel[log.model].outputTokens += log._sum.outputTokens || 0;
      byProvider[log.provider].byModel[log.model].totalCost += c;

      // By feature
      if (!byFeature[log.feature]) {
        byFeature[log.feature] = { totalTokens: 0, totalCost: 0 };
      }
      byFeature[log.feature].totalTokens += t;
      byFeature[log.feature].totalCost += c;
    }

    return {
      totalTokens,
      totalCost: Math.round(totalCost * 1000000) / 1000000,
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

    const rows: string[] = [
      'Name,Email,Courses,Progress,AI Cost,Joined,Last Active,Temp Password',
    ];

    for (const student of result.students) {
      const courses = student.enrolledCourses.map((c: { courseName: string }) => c.courseName).join('; ');
      const progress = student.enrolledCourses
        .map((c: { courseName: string; progress: { percentage: number } }) => `${c.courseName}: ${c.progress.percentage}%`)
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
      scores.length > 0 ? Math.round((scores.reduce((sum, s) => sum + s, 0) / scores.length) * 100) / 100 : 0;

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
