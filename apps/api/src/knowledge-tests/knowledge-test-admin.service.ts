import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { CourseGatePosition, Prisma } from '@prisma/client';
import {
  autoScore,
  cohensKappa,
  knowledgeTestOccasion,
  writtenTotal,
  type KnowledgeTestAutoScore,
  type KnowledgeTestItem,
  type KnowledgeTestResponses,
} from '@ats/shared';
import { PrismaService } from '../prisma';
import { researchPseudonym, researchSalt } from '../learning-events/exports/exports.service';
import { csvCell } from '../learning-events/validation/validation.service';
import { assertEfaStaff, type EfaStaff } from '../efa/staff-access';
import { courseSessions } from './course-sessions';

type Staff = EfaStaff;
const json = (v: unknown) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : '');
const toCsv = (header: string[], rows: unknown[][]) =>
  [header, ...rows].map((r) => r.map((c) => csvCell(json(c))).join(',')).join('\n') + '\n';
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Where the knowledge-test gates sit in the course order (with the EF
 * warm-up at 10/20 before Session 1 and 910/920 after the last module):
 * pre-study 30 before S1; pre-session 40 before its session; post-session
 * 800 after its session; post-study 900 after Session 8.
 */
export const KT_GATE_SEQUENCE = {
  PRE_STUDY: 30,
  PRE_SESSION: 40,
  POST_SESSION: 800,
  POST_STUDY: 900,
} as const;

/**
 * Staff side of the knowledge tests: gate setup, definitions, the analysis
 * exports, blinded written scoring with adjudication, and inter-rater
 * agreement. Course owner or admin; staff named as EF raters for the
 * course may score written answers too.
 */
@Injectable()
export class KnowledgeTestAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ── setup (gates) ───────────────────────────────────────────────────────

  async setup(staff: Staff, courseId: string) {
    await assertEfaStaff(this.prisma, staff, courseId);
    const [sessions, gates, definitions] = await Promise.all([
      courseSessions(this.prisma, courseId),
      this.prisma.courseGate.findMany({
        where: { courseId, kind: 'KNOWLEDGE_TEST' },
        include: { _count: { select: { completions: true } } },
        orderBy: { sequence: 'asc' },
      }),
      this.prisma.knowledgeTestDefinition.findMany({
        where: { courseId },
        select: {
          scope: true,
          sessionNo: true,
          form: true,
          version: true,
          maxMarks: true,
          _count: { select: { attempts: true } },
        },
        orderBy: [{ scope: 'asc' }, { sessionNo: 'asc' }, { form: 'asc' }],
      }),
    ]);
    return {
      sessions: sessions.map((s) => ({
        sessionNo: s.sessionNo,
        moduleId: s.moduleId,
        hasLesson: !!s.lessonItemId,
        finalSlideKey: s.finalSlideKey,
      })),
      gates: gates.map((g) => ({
        id: g.id,
        occasion: g.occasion,
        position: g.position,
        moduleId: g.moduleId,
        sequence: g.sequence,
        required: g.required,
        completions: g._count.completions,
      })),
      definitions: definitions.map((d) => ({
        ...d,
        attempts: d._count.attempts,
        _count: undefined,
      })),
      enabled: gates.some((g) => g.required),
    };
  }

  /**
   * Turn the tests on: place the 18 gates on Sessions 1–8. Turning off
   * removes gates nobody passed and keeps the rest as not required.
   */
  async setEnabled(staff: Staff, courseId: string, enabled: boolean) {
    await assertEfaStaff(this.prisma, staff, courseId);
    const sessions = await courseSessions(this.prisma, courseId);
    const s = (n: number) => sessions.find((x) => x.sessionNo === n);
    if (enabled) {
      const missing = [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => !s(n));
      if (missing.length)
        throw new BadRequestException(`No module titled "Session ${missing[0]}…" in this course`);
      const defs = await this.prisma.knowledgeTestDefinition.count({ where: { courseId } });
      if (defs < 19)
        throw new ConflictException('Import the item bank first (import:knowledge-tests).');
    }
    const wanted: Array<{
      occasion: string;
      position: CourseGatePosition;
      moduleId: string;
      sequence: number;
    }> = [
      {
        occasion: 'PRE_STUDY',
        position: 'BEFORE_MODULE',
        moduleId: s(1)?.moduleId ?? '',
        sequence: KT_GATE_SEQUENCE.PRE_STUDY,
      },
      {
        occasion: 'POST_STUDY',
        position: 'AFTER_MODULE',
        moduleId: s(8)?.moduleId ?? '',
        sequence: KT_GATE_SEQUENCE.POST_STUDY,
      },
    ];
    for (let n = 1; n <= 8; n++) {
      wanted.push({
        occasion: knowledgeTestOccasion('PRE_SESSION', n),
        position: 'BEFORE_MODULE',
        moduleId: s(n)?.moduleId ?? '',
        sequence: KT_GATE_SEQUENCE.PRE_SESSION,
      });
      wanted.push({
        occasion: knowledgeTestOccasion('POST_SESSION', n),
        position: 'AFTER_MODULE',
        moduleId: s(n)?.moduleId ?? '',
        sequence: KT_GATE_SEQUENCE.POST_SESSION,
      });
    }
    await this.prisma.$transaction(async (tx) => {
      for (const w of wanted) {
        const where = {
          courseId_kind_occasion: {
            courseId,
            kind: 'KNOWLEDGE_TEST' as const,
            occasion: w.occasion,
          },
        };
        if (enabled) {
          const data = {
            position: w.position,
            moduleId: w.moduleId,
            sequence: w.sequence,
            required: true,
          };
          await tx.courseGate.upsert({
            where,
            create: { courseId, kind: 'KNOWLEDGE_TEST', occasion: w.occasion, ...data },
            update: data,
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
    });
    return this.setup(staff, courseId);
  }

  async definitions(staff: Staff, courseId: string) {
    await assertEfaStaff(this.prisma, staff, courseId);
    return this.prisma.knowledgeTestDefinition.findMany({
      where: { courseId },
      orderBy: [{ scope: 'asc' }, { sessionNo: 'asc' }, { form: 'asc' }],
    });
  }

  // ── exports (pseudonymised like every research export) ─────────────────

  async assignmentsCsv(staff: Staff, courseId: string) {
    await assertEfaStaff(this.prisma, staff, courseId);
    const salt = researchSalt();
    const rows = await this.prisma.knowledgeTestAssignment.findMany({
      where: { courseId },
      orderBy: [{ studentId: 'asc' }, { kind: 'asc' }, { sessionNo: 'asc' }],
    });
    return toCsv(
      ['pid', 'kind', 'session_no', 'form', 'order', 'created_at'],
      rows.map((a) => [
        researchPseudonym(a.studentId, salt),
        a.kind,
        a.sessionNo || '',
        a.form,
        a.order,
        iso(a.createdAt),
      ]),
    );
  }

  private async submittedAttempts(courseId: string) {
    return this.prisma.knowledgeTestAttempt.findMany({
      where: { assignment: { courseId }, status: { not: 'IN_PROGRESS' } },
      include: { assignment: true, definition: true, writtenScores: true },
      orderBy: { submittedAt: 'asc' },
    });
  }

  /** Written total of an attempt (null until every open slot is resolved). */
  private written(
    items: KnowledgeTestItem[],
    scores: Array<{ slot: number; role: 'RATER' | 'ADJUDICATOR'; total: number }>,
  ) {
    let sum = 0;
    for (const it of items.filter((i) => i.type === 'open')) {
      const t = writtenTotal(scores.filter((s) => s.slot === it.slot));
      if (t == null) return null;
      sum += t;
    }
    return sum;
  }

  async attemptsCsv(staff: Staff, courseId: string) {
    await assertEfaStaff(this.prisma, staff, courseId);
    const salt = researchSalt();
    const attempts = await this.submittedAttempts(courseId);
    // fastCompletion: < ⅓ of the running median duration of earlier attempts on the same form.
    const seen = new Map<string, number[]>();
    const rows = attempts.map((a) => {
      const prior = seen.get(a.definitionId) ?? [];
      const fast = prior.length >= 3 && a.durationMs != null && a.durationMs < median(prior) / 3;
      if (a.durationMs != null) seen.set(a.definitionId, [...prior, a.durationMs]);
      const auto = a.autoScore as unknown as KnowledgeTestAutoScore | null;
      const flags = [
        fast && 'fastCompletion',
        a.autosaveOnly && 'autosaveOnly',
        auto?.omitted && `omitted:${auto.omitted}`,
      ]
        .filter(Boolean)
        .join(';');
      return [
        researchPseudonym(a.assignment.studentId, salt),
        a.id,
        a.assignment.kind,
        a.assignment.sessionNo || '',
        a.assignment.form,
        a.assignment.order,
        iso(a.startedAt),
        iso(a.submittedAt),
        a.durationMs,
        auto?.omitted ?? '',
        auto?.autoTotal ?? '',
        auto?.autoMax ?? '',
        this.written(a.definition.items as unknown as KnowledgeTestItem[], a.writtenScores) ?? '',
        a.definition.maxMarks,
        a.status,
        flags,
      ];
    });
    return toCsv(
      [
        'pid',
        'attempt_id',
        'kind',
        'session_no',
        'form',
        'order',
        'started_at',
        'submitted_at',
        'duration_ms',
        'omitted_count',
        'auto_total',
        'auto_max',
        'written_total',
        'max_marks',
        'status',
        'flags',
      ],
      rows,
    );
  }

  /** Long format: one row per attempt × slot (open answers included as text). */
  async responsesCsv(staff: Staff, courseId: string) {
    await assertEfaStaff(this.prisma, staff, courseId);
    const attempts = await this.submittedAttempts(courseId);
    const rows: unknown[][] = [];
    for (const a of attempts) {
      const items = a.definition.items as unknown as KnowledgeTestItem[];
      const resp = a.responses as KnowledgeTestResponses;
      const auto =
        (a.autoScore as unknown as KnowledgeTestAutoScore | null) ?? autoScore(items, resp);
      for (const it of items) {
        const r = resp[String(it.slot)];
        const response =
          it.type === 'mcq'
            ? (r?.option ?? '')
            : it.type === 'sata'
              ? (r?.options ?? []).join('|')
              : (r?.text ?? '');
        const written =
          it.type === 'open'
            ? writtenTotal(a.writtenScores.filter((s) => s.slot === it.slot))
            : null;
        rows.push([
          a.id,
          it.slot,
          it.type,
          response,
          it.type === 'open' ? '' : auto.perSlot[it.slot],
          written ?? '',
        ]);
      }
    }
    return toCsv(['attempt_id', 'slot', 'type', 'response', 'auto_score', 'written_score'], rows);
  }

  // ── blinded written scoring ─────────────────────────────────────────────

  private order(staff: Staff, attemptId: string, slot: number) {
    return createHash('sha256').update(`${staff.id}:${attemptId}:${slot}`).digest('hex');
  }

  /** Next open answer this rater has not scored (random order per rater); no identifying fields. */
  async nextWritten(staff: Staff, courseId: string) {
    await assertEfaStaff(this.prisma, staff, courseId, { raters: true });
    const attempts = await this.submittedAttempts(courseId);
    const queue: Array<{ attemptId: string; slot: number; key: string }> = [];
    let remaining = 0;
    for (const a of attempts) {
      for (const it of (a.definition.items as unknown as KnowledgeTestItem[]).filter(
        (i) => i.type === 'open',
      )) {
        const rows = a.writtenScores.filter((s) => s.slot === it.slot && s.role === 'RATER');
        if (rows.length >= 2 || rows.some((r) => r.raterId === staff.id)) continue;
        remaining++;
        queue.push({ attemptId: a.id, slot: it.slot, key: this.order(staff, a.id, it.slot) });
      }
    }
    queue.sort((x, y) => x.key.localeCompare(y.key));
    const next = queue[0];
    return {
      remaining,
      next: next ? await this.writtenItem(staff, courseId, next.attemptId, next.slot) : null,
    };
  }

  /** One open answer for scoring: only an opaque attempt id and slot, the stem, rubric and text. */
  async writtenItem(staff: Staff, courseId: string | null, attemptId: string, slot: number) {
    const a = await this.prisma.knowledgeTestAttempt.findUnique({
      where: { id: attemptId },
      include: {
        definition: true,
        assignment: { select: { courseId: true } },
        writtenScores: true,
      },
    });
    if (!a || a.status === 'IN_PROGRESS' || (courseId && a.assignment.courseId !== courseId))
      throw new NotFoundException('Not found');
    await assertEfaStaff(this.prisma, staff, a.assignment.courseId, { raters: true });
    const item = (a.definition.items as unknown as KnowledgeTestItem[]).find(
      (i) => i.slot === slot && i.type === 'open',
    );
    if (!item) throw new NotFoundException('Not found');
    const rows = a.writtenScores.filter((s) => s.slot === slot);
    const raters = rows.filter((r) => r.role === 'RATER');
    return {
      attemptId: a.id,
      slot,
      stem: item.stem,
      rubric: item.rubric,
      maxMarks: item.maxMarks,
      text: (a.responses as KnowledgeTestResponses)[String(slot)]?.text ?? '',
      shownAt: new Date().toISOString(),
      scoredByMe: rows.some((r) => r.raterId === staff.id),
      needsAdjudication:
        raters.length >= 2 &&
        raters[0]!.total !== raters[1]!.total &&
        !rows.some((r) => r.role === 'ADJUDICATOR'),
    };
  }

  /** All open answers of one attempt (blinded). */
  async writtenForAttempt(staff: Staff, attemptId: string) {
    const a = await this.prisma.knowledgeTestAttempt.findUnique({
      where: { id: attemptId },
      include: { definition: true },
    });
    if (!a) throw new NotFoundException('Not found');
    const slots = (a.definition.items as unknown as KnowledgeTestItem[])
      .filter((i) => i.type === 'open')
      .map((i) => i.slot);
    return {
      attemptId,
      items: await Promise.all(slots.map((s) => this.writtenItem(staff, null, attemptId, s))),
    };
  }

  /** Adjudications waiting: double-scored answers whose two totals differ. */
  async disagreements(staff: Staff, courseId: string) {
    await assertEfaStaff(this.prisma, staff, courseId);
    const out: Array<{ attemptId: string; slot: number; totals: number[] }> = [];
    for (const a of await this.submittedAttempts(courseId)) {
      const slots = new Set(a.writtenScores.map((s) => s.slot));
      for (const slot of slots) {
        const rows = a.writtenScores.filter((s) => s.slot === slot);
        const raters = rows.filter((r) => r.role === 'RATER');
        if (
          raters.length >= 2 &&
          raters[0]!.total !== raters[1]!.total &&
          !rows.some((r) => r.role === 'ADJUDICATOR')
        )
          out.push({ attemptId: a.id, slot, totals: raters.map((r) => r.total) });
      }
    }
    return { items: out };
  }

  async score(
    staff: Staff,
    attemptId: string,
    slot: number,
    body: { dimensionScores: Array<0 | 1>; role: 'RATER' | 'ADJUDICATOR'; shownAt?: string },
  ) {
    const a = await this.prisma.knowledgeTestAttempt.findUnique({
      where: { id: attemptId },
      include: {
        definition: true,
        assignment: { select: { courseId: true } },
        writtenScores: true,
      },
    });
    if (!a || a.status === 'IN_PROGRESS') throw new NotFoundException('Not found');
    await assertEfaStaff(this.prisma, staff, a.assignment.courseId, {
      raters: body.role === 'RATER',
    });
    const items = a.definition.items as unknown as KnowledgeTestItem[];
    const item = items.find((i) => i.slot === slot && i.type === 'open');
    if (!item) throw new NotFoundException('Not found');
    if (body.dimensionScores.length !== item.maxMarks)
      throw new BadRequestException(
        `Score each of the ${item.maxMarks} rubric dimensions (0 or 1)`,
      );
    const rows = a.writtenScores.filter((s) => s.slot === slot);
    const raters = rows.filter((r) => r.role === 'RATER');
    if (rows.some((r) => r.raterId === staff.id))
      throw new ConflictException('You have already scored this answer.');
    if (body.role === 'RATER' && raters.length >= 2)
      throw new ConflictException('Two raters have already scored this answer.');
    if (body.role === 'ADJUDICATOR') {
      if (raters.length < 2 || raters[0]!.total === raters[1]!.total)
        throw new ConflictException('Adjudication is only for two raters who disagree.');
      if (rows.some((r) => r.role === 'ADJUDICATOR'))
        throw new ConflictException('Already adjudicated.');
    }
    const shownAt = body.shownAt ? new Date(body.shownAt) : new Date();
    if (Number.isNaN(shownAt.getTime()) || shownAt.getTime() > Date.now() + 60_000)
      throw new BadRequestException('Invalid shownAt');
    const total = body.dimensionScores.reduce<number>((s, v) => s + v, 0);
    await this.prisma.knowledgeTestWrittenScore.create({
      data: {
        attemptId,
        slot,
        raterId: staff.id,
        role: body.role,
        dimensionScores: body.dimensionScores as unknown as Prisma.InputJsonValue,
        total,
        blindedAt: shownAt,
      },
    });
    // Every open slot resolved → SCORED.
    const all = await this.prisma.knowledgeTestWrittenScore.findMany({ where: { attemptId } });
    if (this.written(items, all) != null)
      await this.prisma.knowledgeTestAttempt.update({
        where: { id: attemptId },
        data: { status: 'SCORED' },
      });
    return { ok: true, total };
  }

  /**
   * Agreement over double-scored answers, per open item (scope + slot):
   * per rubric dimension raw agreement and Cohen's κ, and on the totals κ
   * (quadratic-weighted for the 4-mark item, unweighted otherwise).
   */
  async interRater(staff: Staff, courseId: string) {
    await assertEfaStaff(this.prisma, staff, courseId);
    const groups = new Map<
      string,
      { scope: string; slot: number; maxMarks: number; pairs: Array<[number[], number[]]> }
    >();
    for (const a of await this.submittedAttempts(courseId)) {
      for (const it of (a.definition.items as unknown as KnowledgeTestItem[]).filter(
        (i) => i.type === 'open',
      )) {
        const raters = a.writtenScores.filter((s) => s.slot === it.slot && s.role === 'RATER');
        if (raters.length < 2) continue;
        const key = `${a.definition.scope}:${it.slot}`;
        const g = groups.get(key) ?? {
          scope: a.definition.scope,
          slot: it.slot,
          maxMarks: it.maxMarks!,
          pairs: [],
        };
        g.pairs.push([
          raters[0]!.dimensionScores as number[],
          raters[1]!.dimensionScores as number[],
        ]);
        groups.set(key, g);
      }
    }
    return {
      items: [...groups.values()].map((g) => {
        const dims = Array.from({ length: g.maxMarks }, (_, d) => {
          const pairs = g.pairs.map(([x, y]) => [x[d] ?? 0, y[d] ?? 0] as [number, number]);
          return {
            dimension: d + 1,
            n: pairs.length,
            agreement: pairs.length
              ? Math.round((pairs.filter(([x, y]) => x === y).length / pairs.length) * 1000) / 1000
              : null,
            kappa: cohensKappa(pairs, 'none', [0, 1]),
          };
        });
        const totals = g.pairs.map(
          ([x, y]) =>
            [x.reduce((s, v) => s + v, 0), y.reduce((s, v) => s + v, 0)] as [number, number],
        );
        const cats = Array.from({ length: g.maxMarks + 1 }, (_, i) => i);
        return {
          scope: g.scope,
          slot: g.slot,
          maxMarks: g.maxMarks,
          n: g.pairs.length,
          dimensions: dims,
          totalAgreement: totals.length
            ? Math.round((totals.filter(([x, y]) => x === y).length / totals.length) * 1000) / 1000
            : null,
          totalKappa: cohensKappa(totals, g.maxMarks === 4 ? 'quadratic' : 'none', cats),
          totalKappaWeighting: g.maxMarks === 4 ? 'quadratic' : 'none',
        };
      }),
    };
  }
}
