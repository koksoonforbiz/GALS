import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { CourseGate, CourseGateKind } from '@prisma/client';
import type { StudentGateStep } from '@ats/shared';
import { PrismaService } from '../prisma';
import { SecurityEventService } from '../auth/security-event.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-action.enum';
import { computeLockState, type LockState } from './lock-state';

/**
 * Student-facing checklist steps are deliberately neutral: no gate kind or
 * construct name, only the label the student sees and a route-friendly
 * step code (blinding, docs/EF_battery_v2 §1).
 */
const STUDENT_STEP: Record<CourseGateKind, { step: StudentGateStep['step']; label: string }> = {
  EF_QUESTIONNAIRE: { step: 'questionnaire', label: 'About you and how you feel today' },
  EF_TESTS: { step: 'puzzles', label: 'Attention and memory puzzles' },
  KNOWLEDGE_TEST: { step: 'knowledge', label: 'Knowledge check' },
};

export function moduleLockedError() {
  return new ForbiddenException({
    statusCode: 403,
    code: 'MODULE_LOCKED',
    message: 'Complete the steps at the top of the course page first.',
  });
}

/**
 * Generic course prerequisites (docs/EF_battery_v2/IMPLEMENTATION_PLAN.md §5).
 * Every check here applies to students only: teachers and admins are never
 * locked out of course content.
 */
@Injectable()
export class CourseGateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly securityEvents: SecurityEventService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async lockState(studentId: string, courseId: string): Promise<LockState<CourseGate>> {
    const [modules, gates] = await Promise.all([
      this.prisma.courseModule.findMany({
        where: { courseId },
        select: { id: true, orderIndex: true },
      }),
      this.prisma.courseGate.findMany({ where: { courseId } }),
    ]);
    if (!gates.length) return { lockedModuleIds: new Set(), steps: [] };
    const done = await this.prisma.studentGateCompletion.findMany({
      where: { studentId, gateId: { in: gates.map((g) => g.id) } },
      select: { gateId: true },
    });
    return computeLockState(modules, gates, new Set(done.map((d) => d.gateId)));
  }

  /** Checklist for the course page, in course order. */
  async studentSteps(studentId: string, courseId: string): Promise<StudentGateStep[]> {
    const { steps } = await this.lockState(studentId, courseId);
    return steps.map(({ gate, done, next }) => ({
      gateId: gate.id,
      ...STUDENT_STEP[gate.kind],
      occasion: gate.occasion,
      done,
      next,
    }));
  }

  private async isActiveStudent(studentId: string, courseId: string): Promise<boolean> {
    const e = await this.prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
      select: { status: true },
    });
    return e?.status === 'ACTIVE';
  }

  /** Throws MODULE_LOCKED if the module is behind an incomplete gate for this student. */
  async assertModuleOpen(studentId: string, courseId: string, moduleId: string): Promise<void> {
    const { lockedModuleIds } = await this.lockState(studentId, courseId);
    if (lockedModuleIds.has(moduleId)) throw moduleLockedError();
  }

  /** Enrollment + gate check for a student reading one module item. */
  async assertItemAccess(studentId: string, moduleItemId: string): Promise<void> {
    const item = await this.prisma.moduleItem.findUnique({
      where: { id: moduleItemId },
      select: { moduleId: true, module: { select: { courseId: true } } },
    });
    if (!item) throw new NotFoundException('Item not found');
    if (!(await this.isActiveStudent(studentId, item.module.courseId))) {
      throw new ForbiddenException('You are not enrolled in this course');
    }
    await this.assertModuleOpen(studentId, item.module.courseId, item.moduleId);
  }

  /**
   * For routes reachable by any role (e.g. the Learning Assistant): staff
   * pass; students need an ACTIVE enrollment in `courseId` and, when a
   * module item is named, that item's module must be open.
   */
  async assertContentAccess(
    userId: string,
    courseId: string,
    moduleItemId?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user || user.role !== 'student') return;
    if (!(await this.isActiveStudent(userId, courseId))) {
      throw new ForbiddenException('You are not enrolled in this course');
    }
    if (!moduleItemId) return;
    const item = await this.prisma.moduleItem.findUnique({
      where: { id: moduleItemId },
      select: { moduleId: true, module: { select: { courseId: true } } },
    });
    // Not a module item (other content ids are resolved elsewhere) or another course: nothing to gate here.
    if (!item || item.module.courseId !== courseId) return;
    await this.assertModuleOpen(userId, courseId, item.moduleId);
  }

  /** Mark a gate passed (idempotent). */
  async complete(
    gateId: string,
    studentId: string,
    source: 'auto' | 'override',
    extra: { overrideBy?: string; reason?: string } = {},
  ) {
    return this.prisma.studentGateCompletion.upsert({
      where: { gateId_studentId: { gateId, studentId } },
      create: { gateId, studentId, source, overrideBy: extra.overrideBy, reason: extra.reason },
      update: {},
    });
  }

  /** Complete the gate of `kind`/`occasion` in a course, if one is configured. */
  async completeByKind(
    courseId: string,
    kind: CourseGateKind,
    occasion: string,
    studentId: string,
  ) {
    const gate = await this.prisma.courseGate.findFirst({ where: { courseId, kind, occasion } });
    if (gate) await this.complete(gate.id, studentId, 'auto');
    return gate;
  }

  private async assertStaffForCourse(staff: { id: string; role: string }, courseId: string) {
    if (staff.role === 'admin') return;
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.teacherId !== staff.id)
      throw new ForbiddenException('You can only manage your own courses');
  }

  async listForCourse(staff: { id: string; role: string }, courseId: string) {
    await this.assertStaffForCourse(staff, courseId);
    const gates = await this.prisma.courseGate.findMany({
      where: { courseId },
      include: { _count: { select: { completions: true } } },
      orderBy: { sequence: 'asc' },
    });
    return gates;
  }

  async studentStateForStaff(
    staff: { id: string; role: string },
    courseId: string,
    studentId: string,
  ) {
    await this.assertStaffForCourse(staff, courseId);
    const { lockedModuleIds, steps } = await this.lockState(studentId, courseId);
    const completions = await this.prisma.studentGateCompletion.findMany({ where: { studentId } });
    const byGate = new Map(completions.map((c) => [c.gateId, c]));
    return {
      lockedModuleIds: [...lockedModuleIds],
      steps: steps.map((s) => ({ ...s, completion: byGate.get(s.gate.id) ?? null })),
    };
  }

  /**
   * Staff override: open a gate for one student without its activity
   * being completed. Audited in security_events (GATE_OVERRIDE) and, when
   * the student has a session in the course, as GATE_UNLOCKED in activity_logs.
   */
  async override(
    staff: { id: string; role: string },
    gateId: string,
    studentId: string,
    reason: string,
    meta: { ipAddress?: string; userAgent?: string } = {},
  ) {
    const gate = await this.prisma.courseGate.findUnique({ where: { id: gateId } });
    if (!gate) throw new NotFoundException('Gate not found');
    await this.assertStaffForCourse(staff, gate.courseId);
    if (!(await this.isActiveStudent(studentId, gate.courseId))) {
      throw new ForbiddenException('That student is not enrolled in this course');
    }
    const existing = await this.prisma.studentGateCompletion.findUnique({
      where: { gateId_studentId: { gateId, studentId } },
    });
    if (existing) return { gateId, studentId, alreadyComplete: true, completion: existing };

    const completion = await this.complete(gateId, studentId, 'override', {
      overrideBy: staff.id,
      reason,
    });
    this.securityEvents.record({
      type: 'GATE_OVERRIDE',
      userId: staff.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        gateId,
        courseId: gate.courseId,
        kind: gate.kind,
        occasion: gate.occasion,
        studentId,
        reason,
      },
    });
    const session = await this.prisma.studentSession.findFirst({
      where: { userId: studentId, courseId: gate.courseId },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    if (session) {
      await this.activityLog.record({
        sessionId: session.id,
        userId: studentId,
        action: ActivityAction.GATE_UNLOCKED,
        courseId: gate.courseId,
        moduleId: gate.moduleId,
        metadata: { gateId, occasion: gate.occasion, by: 'staff' },
      });
    }
    return { gateId, studentId, alreadyComplete: false, completion };
  }
}
