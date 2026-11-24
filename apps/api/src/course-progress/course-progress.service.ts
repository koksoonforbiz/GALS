import { Injectable } from '@nestjs/common';
import type { CourseProgress } from '@ats/shared';
import { PrismaService } from '../prisma';
import { CourseGateService, studentGateStep } from '../course-gates';
import { courseSessions } from '../knowledge-tests/course-sessions';
import { computeCourseProgress } from './progress';

/**
 * The student's progress through each course they are enrolled in, for the
 * home page: checklist steps (neutral labels only, as on the course page)
 * and session lessons, in course order. A lesson counts as finished on the
 * same rule the post-session check uses: its reflect slide is saved.
 */
@Injectable()
export class CourseProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gates: CourseGateService,
  ) {}

  async myProgress(studentId: string): Promise<CourseProgress[]> {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentId, status: 'ACTIVE' },
      orderBy: { enrolledAt: 'asc' },
      select: {
        course: { select: { id: true, title: true, teacher: { select: { name: true } } } },
      },
    });
    return Promise.all(enrollments.map(({ course }) => this.forCourse(studentId, course)));
  }

  private async forCourse(
    studentId: string,
    course: { id: string; title: string; teacher: { name: string } },
  ): Promise<CourseProgress> {
    const [modules, lock, sessions] = await Promise.all([
      this.prisma.courseModule.findMany({
        where: { courseId: course.id },
        select: { id: true, title: true, orderIndex: true },
      }),
      this.gates.lockState(studentId, course.id),
      courseSessions(this.prisma, course.id),
    ]);

    const lessonIds = sessions.flatMap((s) => (s.lessonItemId ? [s.lessonItemId] : []));
    const states = lessonIds.length
      ? await this.prisma.lessonSlideState.findMany({
          where: { studentId, moduleItemId: { in: lessonIds } },
          select: { moduleItemId: true, slideKey: true, updatedAt: true },
        })
      : [];

    const result = computeCourseProgress(
      modules,
      lock.steps.map(({ gate, done }) => ({
        id: gate.id,
        moduleId: gate.moduleId,
        position: gate.position,
        sequence: gate.sequence,
        occasion: gate.occasion,
        done,
        ...studentGateStep(gate),
      })),
      sessions.map((s) => ({
        sessionNo: s.sessionNo,
        moduleId: s.moduleId,
        lessonItemId: s.lessonItemId,
        started: states.some((r) => r.moduleItemId === s.lessonItemId),
        finished: states.some(
          (r) => r.moduleItemId === s.lessonItemId && r.slideKey === s.finalSlideKey,
        ),
      })),
      lock.lockedModuleIds,
    );

    const last = states.reduce<Date | null>(
      (max, r) => (!max || r.updatedAt > max ? r.updatedAt : max),
      null,
    );
    return {
      courseId: course.id,
      title: course.title,
      teacherName: course.teacher.name,
      ...result,
      lastActiveAt: last ? last.toISOString() : null,
    };
  }
}
