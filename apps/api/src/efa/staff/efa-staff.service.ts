import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CourseGateKind, CourseGatePosition } from '@prisma/client';
import type {
  EfaProgressRun,
  EfaProgressView,
  EfaRatersRequest,
  EfaSettings,
  EfaSettingsView,
} from '@ats/shared';
import { PrismaService } from '../../prisma';
import { SecurityEventService } from '../../auth/security-event.service';
import { EfaOccasionService } from '../occasion.service';
import { assertEfaStaff, type EfaStaff } from '../staff-access';

type Meta = { ipAddress?: string; userAgent?: string };
type Occ = 'T0' | 'T1' | 'T2';

/**
 * Where each occasion's two gates go (plan §5): T0 and T1 before a module,
 * T2 after one. Sequences 10/20, 110/120, 910/920; 30 and 900 stay free
 * for the knowledge tests.
 */
const PLACEMENT: Record<Occ, { position: CourseGatePosition; seq: [number, number] }> = {
  T0: { position: 'BEFORE_MODULE', seq: [10, 20] },
  T1: { position: 'BEFORE_MODULE', seq: [110, 120] },
  T2: { position: 'AFTER_MODULE', seq: [910, 920] },
};
const KINDS: CourseGateKind[] = ['EF_QUESTIONNAIRE', 'EF_TESTS'];
const GATE_LABEL: Record<string, string> = {
  EF_QUESTIONNAIRE: 'questionnaire',
  EF_TESTS: 'puzzles',
  KNOWLEDGE_TEST: 'knowledge test',
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Staff side of the EF assessment (plan §7): settings and gate placement,
 * the progress dashboard with the administration log, task reset, reopening
 * an expired occasion, and rater assignments. Course owner or admin only;
 * every reset/reopen is a security event.
 */
@Injectable()
export class EfaStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly occasions: EfaOccasionService,
    private readonly securityEvents: SecurityEventService,
  ) {}

  // ── settings ────────────────────────────────────────────────────────────

  private async modules(courseId: string) {
    return this.prisma.courseModule.findMany({
      where: { courseId },
      orderBy: { orderIndex: 'asc' },
      select: { id: true, title: true, orderIndex: true },
    });
  }

  /** Default modules: T0 before the first, T1 before the fifth (Session 5), T2 after the last. */
  private defaultPositions(modules: Array<{ id: string }>): Record<Occ, string | null> {
    return {
      T0: modules[0]?.id ?? null,
      T1: modules[4]?.id ?? modules[0]?.id ?? null,
      T2: modules[modules.length - 1]?.id ?? null,
    };
  }

  async settings(staff: EfaStaff, courseId: string): Promise<EfaSettingsView> {
    await assertEfaStaff(this.prisma, staff, courseId);
    const [modules, row, gates] = await Promise.all([
      this.modules(courseId),
      this.prisma.efaCourseConfig.findUnique({ where: { courseId } }),
      this.prisma.courseGate.findMany({
        where: { courseId },
        orderBy: { sequence: 'asc' },
        include: { _count: { select: { completions: true } } },
      }),
    ]);
    const cfg = await this.occasions.config(courseId);
    const defaults = this.defaultPositions(modules);
    const placed = (o: Occ) =>
      gates.find((g) => g.occasion === o && KINDS.includes(g.kind))?.moduleId;
    return {
      enabledOccasions: {
        T0: !!cfg.enabledOccasions.T0,
        T1: !!cfg.enabledOccasions.T1,
        T2: !!cfg.enabledOccasions.T2,
      },
      enabledTasks: cfg.enabledTasks as EfaSettings['enabledTasks'],
      showDiagnosisItem: cfg.showDiagnosisItem,
      adexiAtT2: cfg.adexiAtT2,
      t2MinMinutesAfterPrevious: cfg.t2MinMinutesAfterPrevious,
      positions: {
        T0: placed('T0') ?? defaults.T0,
        T1: placed('T1') ?? defaults.T1,
        T2: placed('T2') ?? defaults.T2,
      },
      modules,
      gates: gates.map((g) => ({
        id: g.id,
        kind: g.kind,
        occasion: g.occasion,
        position: g.position,
        moduleId: g.moduleId,
        sequence: g.sequence,
        required: g.required,
        completions: g._count.completions,
      })),
      usingDefaults: !row,
    };
  }

  /**
   * Save settings and place the gates. An enabled occasion gets (or moves)
   * its questionnaire and puzzles gates; a disabled one loses them — or, if
   * students already passed one, it is kept as not required so the
   * completions stay on record.
   */
  async saveSettings(staff: EfaStaff, courseId: string, s: EfaSettings): Promise<EfaSettingsView> {
    await assertEfaStaff(this.prisma, staff, courseId);
    const moduleIds = new Set((await this.modules(courseId)).map((m) => m.id));
    for (const o of Object.keys(PLACEMENT) as Occ[]) {
      const m = s.positions[o];
      if (s.enabledOccasions[o] && !m) throw new BadRequestException(`Choose a session for ${o}`);
      if (m && !moduleIds.has(m))
        throw new BadRequestException(`Session for ${o} is not in this course`);
    }

    await this.prisma.$transaction(async (tx) => {
      const data = {
        enabledOccasions: s.enabledOccasions,
        enabledTasks: s.enabledTasks,
        showDiagnosisItem: s.showDiagnosisItem,
        adexiAtT2: s.adexiAtT2,
        t2MinMinutesAfterPrevious: s.t2MinMinutesAfterPrevious,
        updatedBy: staff.id,
      };
      await tx.efaCourseConfig.upsert({
        where: { courseId },
        create: { courseId, ...data },
        update: data,
      });

      for (const o of Object.keys(PLACEMENT) as Occ[]) {
        const { position, seq } = PLACEMENT[o];
        for (const [i, kind] of KINDS.entries()) {
          const where = { courseId_kind_occasion: { courseId, kind, occasion: o } };
          if (s.enabledOccasions[o]) {
            const placement = {
              position,
              moduleId: s.positions[o]!,
              sequence: seq[i]!,
              required: true,
            };
            await tx.courseGate.upsert({
              where,
              create: { courseId, kind, occasion: o, ...placement },
              update: placement,
            });
          } else {
            const g = await tx.courseGate.findUnique({
              where,
              include: { _count: { select: { completions: true } } },
            });
            if (!g) continue;
            if (g._count.completions)
              await tx.courseGate.update({ where: { id: g.id }, data: { required: false } });
            else await tx.courseGate.delete({ where: { id: g.id } });
          }
        }
      }
    });
    return this.settings(staff, courseId);
  }

  // ── progress dashboard + administration log ─────────────────────────────

  async progress(staff: EfaStaff, courseId: string): Promise<EfaProgressView> {
    await assertEfaStaff(this.prisma, staff, courseId);
    const [gates, enrollments, occasions] = await Promise.all([
      this.prisma.courseGate.findMany({
        where: { courseId },
        orderBy: { sequence: 'asc' },
        include: { completions: true },
      }),
      this.prisma.enrollment.findMany({
        where: { courseId, status: 'ACTIVE' },
        include: { student: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.efaOccasion.findMany({
        where: { courseId },
        include: { taskRuns: { orderBy: [{ taskCode: 'asc' }, { attemptNo: 'asc' }] } },
        orderBy: { occasion: 'asc' },
      }),
    ]);

    const students = enrollments
      .map((e) => e.student)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((st) => ({
        studentId: st.id,
        name: st.name,
        email: st.email,
        gates: gates.map((g) => {
          const c = g.completions.find((x) => x.studentId === st.id);
          return { gateId: g.id, done: !!c, source: c?.source ?? null, reason: c?.reason ?? null };
        }),
        occasions: occasions
          .filter((o) => o.studentId === st.id)
          .map((o) => {
            const runs: EfaProgressRun[] = [];
            for (const r of o.taskRuns) {
              const attempts = o.taskRuns.filter((x) => x.taskCode === r.taskCode);
              if (r !== attempts[attempts.length - 1]) continue; // latest attempt per task
              runs.push({
                runId: r.id,
                task: r.taskCode,
                attempt: r.attemptNo,
                attempts: attempts.length,
                status: r.status,
                skipReason: r.skipReason,
                flags: (r.flags as Record<string, unknown> | null) ?? null,
                resetReason: r.resetReason,
                startedAt: iso(r.startedAt),
                completedAt: iso(r.completedAt),
              });
            }
            return {
              occasionId: o.id,
              occasion: o.occasion,
              status: o.status,
              form: o.form,
              orderCode: o.orderCode,
              slot: o.slot,
              flags: (o.flags as Record<string, unknown> | null) ?? null,
              log: {
                device: (o.device as Record<string, unknown> | null) ?? null,
                fullscreenAccepted: o.fullscreenAccepted,
                sensingPaused: o.sensingPaused,
                startedAt: iso(o.startedAt),
                questionnaireDoneAt: iso(o.questionnaireDoneAt),
                completedAt: iso(o.completedAt),
                abandonedAt: iso(o.abandonedAt),
                gapSincePreviousActivityMin:
                  o.gapSincePreviousActivityMs == null
                    ? null
                    : Math.round(Number(o.gapSincePreviousActivityMs) / 600) / 100,
                focusLostSec: Math.round(Number(o.focusLostMsTotal) / 100) / 10,
                scoringVersion: o.scoringVersion,
              },
              runs,
            };
          }),
      }));

    return {
      gates: gates.map((g) => ({
        id: g.id,
        kind: g.kind,
        occasion: g.occasion,
        label:
          `${g.occasion ?? ''} ${GATE_LABEL[g.kind] ?? g.kind}${g.required ? '' : ' (not required)'}`.trim(),
      })),
      students,
    };
  }

  // ── reset and reopen ────────────────────────────────────────────────────

  /**
   * Reset one puzzle so the student does it again (decision Q13): the next
   * attempt uses the same form and is flagged items_reexposed. Only while
   * the occasion is still open.
   */
  async resetRun(staff: EfaStaff, runId: string, reason: string, meta: Meta = {}) {
    const run = await this.prisma.efaTaskRun.findUnique({
      where: { id: runId },
      include: { occasion: true },
    });
    if (!run) throw new NotFoundException('Not found');
    await assertEfaStaff(this.prisma, staff, run.occasion.courseId);
    if (run.occasion.status === 'completed' || run.occasion.status === 'abandoned')
      throw new ConflictException(
        'This occasion is closed. Reopen it first, or unlock the gate instead.',
      );
    const latest = await this.prisma.efaTaskRun.findFirst({
      where: { occasionId: run.occasionId, taskCode: run.taskCode },
      orderBy: { attemptNo: 'desc' },
    });
    if (latest?.id !== run.id) throw new ConflictException('Only the latest attempt can be reset.');
    if (run.resetReason) return { runId, alreadyReset: true };

    await this.prisma.efaTaskRun.update({
      where: { id: runId },
      data: {
        resetReason: reason,
        resetBy: staff.id,
        ...(run.status === 'in_progress' || run.status === 'pending'
          ? { status: 'interrupted', completedAt: new Date() }
          : {}),
      },
    });
    this.securityEvents.record({
      type: 'EF_TASK_RESET',
      userId: staff.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        scope: 'task',
        runId,
        task: run.taskCode,
        attempt: run.attemptNo,
        occasion: run.occasion.occasion,
        courseId: run.occasion.courseId,
        studentId: run.occasion.studentId,
        reason,
      },
    });
    return { runId, reset: true };
  }

  /** Reopen an occasion that expired under the old 24 h rule (students now also reopen one by opening it). */
  async reopenOccasion(staff: EfaStaff, occasionId: string, reason: string, meta: Meta = {}) {
    const o = await this.prisma.efaOccasion.findUnique({ where: { id: occasionId } });
    if (!o) throw new NotFoundException('Not found');
    await assertEfaStaff(this.prisma, staff, o.courseId);
    if (o.status !== 'abandoned')
      throw new ConflictException('Only an expired occasion can be reopened.');
    await this.prisma.efaOccasion.update({
      where: { id: occasionId },
      data: {
        status: o.questionnaireDoneAt ? 'in_progress' : 'not_started',
        abandonedAt: null,
        lastActivityAt: new Date(),
        flags: { ...((o.flags as object) ?? {}), reopened: true },
      },
    });
    this.securityEvents.record({
      type: 'EF_TASK_RESET',
      userId: staff.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        scope: 'occasion',
        occasionId,
        occasion: o.occasion,
        courseId: o.courseId,
        studentId: o.studentId,
        reason,
      },
    });
    return { occasionId, reopened: true };
  }

  // ── rater assignments ───────────────────────────────────────────────────

  async raters(staff: EfaStaff, courseId: string) {
    await assertEfaStaff(this.prisma, staff, courseId);
    const [people, assigned] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: { in: ['teacher', 'admin'] } },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.efaRaterAssignment.findMany({ where: { courseId } }),
    ]);
    const of = (t: string) => assigned.filter((a) => a.taskCode === t).map((a) => a.raterId);
    return { staff: people, assignments: { w4: of('w4'), w5: of('w5') } };
  }

  async saveRaters(staff: EfaStaff, courseId: string, body: EfaRatersRequest) {
    await assertEfaStaff(this.prisma, staff, courseId);
    const ids = [...new Set([...body.w4, ...body.w5])];
    const ok = await this.prisma.user.count({
      where: { id: { in: ids }, role: { in: ['teacher', 'admin'] } },
    });
    if (ok !== ids.length)
      throw new BadRequestException('Raters must be teacher or admin accounts');
    await this.prisma.$transaction([
      this.prisma.efaRaterAssignment.deleteMany({ where: { courseId } }),
      this.prisma.efaRaterAssignment.createMany({
        data: (['w4', 'w5'] as const).flatMap((t) =>
          [...new Set(body[t])].map((raterId) => ({ courseId, taskCode: t, raterId })),
        ),
      }),
    ]);
    return this.raters(staff, courseId);
  }
}
