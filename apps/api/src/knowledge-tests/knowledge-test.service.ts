import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  KNOWLEDGE_TEST_RESPONSES_MAX_BYTES,
  autoScore,
  knowledgeTestLabel,
  knowledgeTestOccasion,
  studentItems,
  type KnowledgeTestItem,
  type KnowledgeTestKind,
  type KnowledgeTestResponses,
  type KnowledgeTestStatus,
  type KnowledgeTestStatusEntry,
} from '@ats/shared';
import { PrismaService } from '../prisma';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-action.enum';
import { CourseGateService } from '../course-gates/course-gate.service';
import { planAssignments } from './assignment';
import { courseSessions } from './course-sessions';
import { REASON, testStatus } from './status';

const sessionKey = (kind: KnowledgeTestKind, sessionNo?: number | null) =>
  kind === 'PRE_STUDY' || kind === 'POST_STUDY' ? 0 : (sessionNo ?? 0);

/**
 * The student side of the knowledge tests. Every gate decision is made
 * here (the client renders from `status`); keys, rubrics, objectives and
 * scores never leave the server on this path.
 */
@Injectable()
export class KnowledgeTestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gates: CourseGateService,
    private readonly activityLog: ActivityLogService,
  ) {}

  // ── helpers ─────────────────────────────────────────────────────────────

  private async assertEnrolled(studentId: string, courseId: string) {
    const e = await this.prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
      select: { status: true },
    });
    if (e?.status !== 'ACTIVE') throw new ForbiddenException('You are not enrolled in this course');
  }

  async log(
    sessionId: string | undefined,
    userId: string,
    courseId: string,
    action: ActivityAction,
    metadata: Record<string, unknown>,
  ) {
    if (!sessionId) return;
    const s = await this.prisma.studentSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });
    if (s?.userId !== userId) return;
    await this.activityLog.record({ sessionId, userId, action, courseId, metadata });
  }

  /** Create the student's 18 assignments once (deterministic; idempotent). */
  async ensureAssignments(studentId: string, courseId: string) {
    const existing = await this.prisma.knowledgeTestAssignment.count({
      where: { studentId, courseId },
    });
    if (existing >= 18) return;
    const me = await this.prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
      select: { enrolledAt: true, id: true },
    });
    if (!me) throw new ForbiddenException('You are not enrolled in this course');
    // 0-based enrolment order (ties broken by id) — stable once assigned.
    const rank = await this.prisma.enrollment.count({
      where: {
        courseId,
        OR: [
          { enrolledAt: { lt: me.enrolledAt } },
          { enrolledAt: me.enrolledAt, id: { lt: me.id } },
        ],
      },
    });
    await this.prisma.knowledgeTestAssignment.createMany({
      data: planAssignments(studentId, courseId, rank).map((a) => ({ studentId, courseId, ...a })),
      skipDuplicates: true,
    });
  }

  private async attemptsByOccasion(studentId: string, courseId: string) {
    const rows = await this.prisma.knowledgeTestAssignment.findMany({
      where: { studentId, courseId },
      include: { attempts: { orderBy: { startedAt: 'desc' }, take: 1 } },
    });
    const map = new Map<string, 'in_progress' | 'submitted'>();
    for (const a of rows) {
      const at = a.attempts[0];
      if (!at) continue;
      map.set(
        knowledgeTestOccasion(a.kind, a.sessionNo),
        at.status === 'IN_PROGRESS' ? 'in_progress' : 'submitted',
      );
    }
    return map;
  }

  private async lessonFinishedFn(studentId: string, courseId: string) {
    const sessions = await courseSessions(this.prisma, courseId);
    const keys = sessions.filter((s) => s.lessonItemId && s.finalSlideKey);
    const saved = keys.length
      ? await this.prisma.lessonSlideState.findMany({
          where: {
            studentId,
            OR: keys.map((s) => ({ moduleItemId: s.lessonItemId!, slideKey: s.finalSlideKey! })),
          },
          select: { moduleItemId: true },
        })
      : [];
    const done = new Set(saved.map((r) => r.moduleItemId));
    return (n: number) => {
      const s = sessions.find((x) => x.sessionNo === n);
      return !!s?.lessonItemId && done.has(s.lessonItemId);
    };
  }

  // ── status ──────────────────────────────────────────────────────────────

  async status(studentId: string, courseId: string): Promise<KnowledgeTestStatus> {
    await this.assertEnrolled(studentId, courseId);
    const steps = await this.gates.studentSteps(studentId, courseId);
    if (!steps.some((s) => s.step === 'knowledge')) return { enabled: false, tests: [] };
    await this.ensureAssignments(studentId, courseId);
    const [attempts, lessonFinished, gates] = await Promise.all([
      this.attemptsByOccasion(studentId, courseId),
      this.lessonFinishedFn(studentId, courseId),
      this.prisma.courseGate.findMany({ where: { courseId }, select: { id: true, kind: true } }),
    ]);
    const kindOf = new Map(gates.map((g) => [g.id, g.kind]));
    return {
      enabled: true,
      tests: testStatus(
        steps.map((s) => ({ ...s, kind: kindOf.get(s.gateId) ?? '' })),
        attempts,
        lessonFinished,
      ),
    };
  }

  private async entry(
    studentId: string,
    courseId: string,
    kind: KnowledgeTestKind,
    sessionNo: number | null,
  ) {
    const st = await this.status(studentId, courseId);
    return st.tests.find((t) => t.kind === kind && (t.sessionNo ?? null) === (sessionNo ?? null));
  }

  private blocked(e: KnowledgeTestStatusEntry | undefined, fallback: string) {
    return new ForbiddenException({
      statusCode: 403,
      code:
        e?.state === 'submitted'
          ? REASON.ALREADY_SUBMITTED
          : (e?.reasonCode ?? REASON.NOT_CONFIGURED),
      message:
        e?.state === 'submitted'
          ? 'This check has already been submitted.'
          : (e?.reason ?? fallback),
    });
  }

  // ── take a test ─────────────────────────────────────────────────────────

  /** Start (or resume) an attempt if the gate allows; 403 with a reason code otherwise. */
  async start(
    studentId: string,
    courseId: string,
    kind: KnowledgeTestKind,
    sessionNoIn: number | null | undefined,
    sessionId?: string,
  ) {
    const sessionNo = kind === 'PRE_STUDY' || kind === 'POST_STUDY' ? null : (sessionNoIn ?? null);
    if ((kind === 'PRE_SESSION' || kind === 'POST_SESSION') && !sessionNo)
      throw new BadRequestException('sessionNo is required for session checks');
    const e = await this.entry(studentId, courseId, kind, sessionNo);
    if (!e || (e.state !== 'available' && e.state !== 'in_progress')) {
      await this.log(sessionId, studentId, courseId, ActivityAction.KNOWLEDGE_TEST_GATE_BLOCKED, {
        kind,
        sessionNo,
        reason:
          e?.state === 'submitted'
            ? REASON.ALREADY_SUBMITTED
            : (e?.reasonCode ?? REASON.NOT_CONFIGURED),
      });
      throw this.blocked(e, 'This check is not available.');
    }

    const assignment = await this.prisma.knowledgeTestAssignment.findUniqueOrThrow({
      where: {
        studentId_courseId_kind_sessionNo: {
          studentId,
          courseId,
          kind,
          sessionNo: sessionKey(kind, sessionNo),
        },
      },
    });
    let attempt = await this.prisma.knowledgeTestAttempt.findFirst({
      where: { assignmentId: assignment.id, status: 'IN_PROGRESS' },
      include: { definition: true },
    });
    if (!attempt) {
      const definition = await this.prisma.knowledgeTestDefinition.findFirst({
        where: {
          courseId,
          scope: sessionNo ? 'session' : 'study',
          sessionNo: sessionNo ?? 0,
          form: assignment.form,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!definition)
        throw new ConflictException(
          'This check is not available yet. Please contact your instructor.',
        );
      const session = sessionId
        ? await this.prisma.studentSession.findUnique({
            where: { id: sessionId },
            select: { userId: true },
          })
        : null;
      attempt = await this.prisma.knowledgeTestAttempt.create({
        data: {
          assignmentId: assignment.id,
          definitionId: definition.id,
          studentSessionId: session?.userId === studentId ? sessionId! : null,
        },
        include: { definition: true },
      });
    }
    return {
      attemptId: attempt.id,
      kind,
      sessionNo,
      label: knowledgeTestLabel(kind, sessionNo),
      form: assignment.form,
      order: assignment.order,
      startedAt: attempt.startedAt,
      items: studentItems(attempt.definition.items as unknown as KnowledgeTestItem[]),
      responses: attempt.responses as KnowledgeTestResponses,
    };
  }

  private async ownOpenAttempt(studentId: string, attemptId: string) {
    const a = await this.prisma.knowledgeTestAttempt.findUnique({
      where: { id: attemptId },
      include: { assignment: true, definition: true },
    });
    if (!a || a.assignment.studentId !== studentId) throw new NotFoundException('Not found');
    if (a.status !== 'IN_PROGRESS') {
      throw new ForbiddenException({
        statusCode: 403,
        code: REASON.ALREADY_SUBMITTED,
        message: 'This check has already been submitted.',
      });
    }
    return a;
  }

  /** Only slots of this form, and only option ids that exist. */
  private clean(
    items: KnowledgeTestItem[],
    responses: KnowledgeTestResponses,
  ): KnowledgeTestResponses {
    const out: KnowledgeTestResponses = {};
    for (const [slot, r] of Object.entries(responses)) {
      const item = items.find((i) => String(i.slot) === slot);
      if (!item) throw new BadRequestException(`No item ${slot} in this check`);
      const ids = new Set((item.options ?? []).map((o) => o.id));
      if (item.type === 'mcq') {
        if (r.option && !ids.has(r.option))
          throw new BadRequestException(`Unknown option for item ${slot}`);
        out[slot] = r.option ? { option: r.option } : {};
      } else if (item.type === 'sata') {
        const opts = [...new Set(r.options ?? [])];
        if (opts.some((o) => !ids.has(o)))
          throw new BadRequestException(`Unknown option for item ${slot}`);
        out[slot] = { options: opts.sort() };
      } else {
        out[slot] = { text: r.text ?? '' };
      }
    }
    return out;
  }

  /** Autosave of partial responses (≤ 32 KB). */
  async save(studentId: string, attemptId: string, responses: KnowledgeTestResponses) {
    const a = await this.ownOpenAttempt(studentId, attemptId);
    const clean = this.clean(a.definition.items as unknown as KnowledgeTestItem[], responses);
    if (Buffer.byteLength(JSON.stringify(clean), 'utf8') > KNOWLEDGE_TEST_RESPONSES_MAX_BYTES)
      throw new PayloadTooLargeException('Responses too large');
    const now = new Date();
    await this.prisma.knowledgeTestAttempt.update({
      where: { id: a.id },
      data: { responses: clean as Prisma.InputJsonValue, lastSavedAt: now },
    });
    return { ok: true, savedAt: now };
  }

  /**
   * Final submit: scores mcq/sata, locks the attempt, passes the gate.
   * `responses` (optional) is the client's final state; `autosaveOnly`
   * records that it was identical to the last autosave.
   */
  async submit(
    studentId: string,
    attemptId: string,
    responses: KnowledgeTestResponses | undefined,
    sessionId?: string,
  ) {
    const a = await this.ownOpenAttempt(studentId, attemptId);
    const items = a.definition.items as unknown as KnowledgeTestItem[];
    const saved = a.responses as KnowledgeTestResponses;
    const final = responses ? this.clean(items, responses) : saved;
    if (Buffer.byteLength(JSON.stringify(final), 'utf8') > KNOWLEDGE_TEST_RESPONSES_MAX_BYTES)
      throw new PayloadTooLargeException('Responses too large');
    const score = autoScore(items, final);
    const now = new Date();
    const durationMs = now.getTime() - a.startedAt.getTime();
    // Append-only: the status guard makes a second submit a no-op refusal.
    const done = await this.prisma.knowledgeTestAttempt.updateMany({
      where: { id: a.id, status: 'IN_PROGRESS' },
      data: {
        responses: final as Prisma.InputJsonValue,
        autoScore: score as unknown as Prisma.InputJsonValue,
        autosaveOnly: JSON.stringify(final) === JSON.stringify(saved) && !!a.lastSavedAt,
        submittedAt: now,
        durationMs,
        status: 'SUBMITTED',
      },
    });
    if (done.count !== 1) throw new ConflictException('Already submitted');
    const { kind, sessionNo, courseId, form } = a.assignment;
    await this.gates.completeByKind(
      courseId,
      'KNOWLEDGE_TEST',
      knowledgeTestOccasion(kind, sessionNo),
      studentId,
    );
    await this.log(sessionId, studentId, courseId, ActivityAction.KNOWLEDGE_TEST_SUBMITTED, {
      attemptId: a.id,
      kind,
      sessionNo: sessionNo || null,
      form,
      durationMs,
      omitted: score.omitted,
    });
    return { submitted: true as const };
  }
}
