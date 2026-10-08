import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma';
import library from '../config/library.v2.json';
import { VALIDATION_CODEBOOK, rulesForLabel } from './codebook';
import { TextConsentService } from '../../governance/text-consent.service';
import {
  type Confusion,
  type Interval,
  addConfusion,
  cohenKappa,
  confusion,
  indicators,
  overlaps,
  segments,
} from './metrics';

export interface ValidationOptions {
  researcherId: string;
  segmentMs?: number;
  toleranceMs?: number;
  sessionIds?: string[];
}

const RULE_IDS = library.rules.map((r) => r.id);
const FAMILY = new Map(library.rules.map((r) => [r.id, r.family ?? r.id]));
const CANDIDATE = 'candidate';
const VALIDATED = 'validated';

/**
 * Think-aloud validation (plan Phase 5.1): aligns learning_events with
 * researchers' ReplayAnnotation ranges on the replay time base and reports
 * the workbook's Validation sheet indicators per rule, plus inter-rater κ.
 */
@Injectable()
export class ValidationService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly consent?: TextConsentService,
  ) {}

  /** Validation is research use: only sessions of research-consenting learners. */
  private async consentingSessions(courseId: string, sessionIds: string[]): Promise<string[]> {
    if (!this.consent || sessionIds.length === 0) return sessionIds;
    const ok = await this.consent.researchConsenting(courseId);
    const rows = await this.prisma.studentSession.findMany({
      where: { id: { in: sessionIds } },
      select: { id: true, userId: true },
    });
    return rows.filter((r) => ok.has(r.userId)).map((r) => r.id);
  }

  // ── codebook ────────────────────────────────────────────────────────────

  /** Creates any missing codebook labels as the researcher's ReplayCodes. */
  async seedCodes(researcherId: string) {
    const existing = await this.prisma.replayCode.findMany({
      where: { researcherId },
      select: { label: true },
    });
    const have = new Set(existing.map((c) => c.label.toLowerCase()));
    const missing = VALIDATION_CODEBOOK.filter((c) => !have.has(c.label.toLowerCase()));
    if (missing.length) {
      await this.prisma.replayCode.createMany({
        data: missing.map((c) => ({ researcherId, label: c.label, color: c.color })),
      });
    }
    return { created: missing.map((c) => c.label), codebook: VALIDATION_CODEBOOK };
  }

  // ── time base ───────────────────────────────────────────────────────────

  /** Same anchor the Replay tab uses for annotation offsets (ReplayTab.tsx). */
  private async baseWallClockMs(sessionId: string): Promise<number> {
    const [anchor, snap, session] = await Promise.all([
      this.prisma.session_sync_anchors.findUnique({
        where: { sessionId },
        select: { wallClockMs: true },
      }),
      this.prisma.sessionReplaySnapshot.findFirst({
        where: { sessionId },
        orderBy: { capturedAt: 'asc' },
        select: { capturedAt: true },
      }),
      this.prisma.studentSession.findUnique({
        where: { id: sessionId },
        select: { startedAt: true },
      }),
    ]);
    if (anchor) return Number(anchor.wallClockMs);
    if (snap) return Number(snap.capturedAt);
    if (session) return session.startedAt.getTime();
    throw new BadRequestException(`Session ${sessionId} not found`);
  }

  private async sessionData(sessionId: string, researcherIds: string[]) {
    const base = await this.baseWallClockMs(sessionId);
    const [events, annotations, lastAction, firstAction] = await Promise.all([
      this.prisma.learningEvent.findMany({
        where: { sessionId },
        select: { ruleId: true, startAt: true, endAt: true },
      }),
      this.prisma.replayAnnotation.findMany({
        where: { sessionId, researcherId: { in: researcherIds } },
        select: {
          researcherId: true,
          startMs: true,
          endMs: true,
          code: { select: { label: true } },
        },
      }),
      this.prisma.activityLog.findFirst({
        where: { sessionId },
        orderBy: { occurredAt: 'desc' },
        select: { occurredAt: true },
      }),
      this.prisma.activityLog.findFirst({
        where: { sessionId },
        orderBy: { occurredAt: 'asc' },
        select: { occurredAt: true },
      }),
    ]);
    const anns = annotations
      .filter((a) => a.code)
      .map((a) => ({
        researcherId: a.researcherId,
        label: a.code!.label,
        start: base + Number(a.startMs),
        end: base + Number(a.endMs ?? a.startMs),
      }));
    // The anchor is the replay's t = 0. It is now the session's first page
    // load, but sessions logged before 2026-10-08 kept the latest one, so
    // earlier activity can precede it (negative offsets). Segment the whole
    // span, not just from the anchor.
    const start = Math.min(
      base,
      firstAction?.occurredAt.getTime() ?? base,
      ...events.map((e) => e.startAt.getTime()),
      ...anns.map((a) => a.start),
    );
    const end = Math.max(
      lastAction?.occurredAt.getTime() ?? base,
      ...events.map((e) => e.endAt.getTime()),
      ...anns.map((a) => a.end),
    );
    return { base, start, end, events, anns };
  }

  private async annotatedSessions(courseId: string, researcherIds: string[], only?: string[]) {
    const rows = await this.prisma.replayAnnotation.findMany({
      where: {
        researcherId: { in: researcherIds },
        ...(only?.length ? { sessionId: { in: only } } : {}),
        session: { OR: [{ courseId }, { activityLogs: { some: { courseId } } }] },
      },
      select: { sessionId: true, researcherId: true },
      distinct: ['sessionId', 'researcherId'],
    });
    return rows;
  }

  // ── report ──────────────────────────────────────────────────────────────

  async report(courseId: string, opts: ValidationOptions) {
    const segmentMs = opts.segmentMs ?? 30_000;
    const toleranceMs = opts.toleranceMs ?? 5_000;
    const annotated = [
      ...new Set(
        (await this.annotatedSessions(courseId, [opts.researcherId], opts.sessionIds)).map(
          (r) => r.sessionId,
        ),
      ),
    ];
    const sessionIds = await this.consentingSessions(courseId, annotated);
    const mapped = new Set(VALIDATION_CODEBOOK.flatMap((c) => c.rules));
    const totals = new Map<string, Confusion>();

    for (const sessionId of sessionIds) {
      const { start, end, events, anns } = await this.sessionData(sessionId, [opts.researcherId]);
      const segs = segments(start, end, segmentMs);
      for (const ruleId of RULE_IDS) {
        if (!mapped.has(ruleId)) continue;
        const trace: Interval[] = events
          .filter((e) => e.ruleId === ruleId)
          .map((e) => ({ start: e.startAt.getTime(), end: e.endAt.getTime() }));
        const human: Interval[] = anns.filter((a) => rulesForLabel(a.label).includes(ruleId));
        const c = confusion(segs, trace, human, toleranceMs);
        totals.set(ruleId, addConfusion(totals.get(ruleId) ?? { tp: 0, fp: 0, fn: 0, tn: 0 }, c));
      }
    }

    const rows = RULE_IDS.map((ruleId) => {
      const c = totals.get(ruleId);
      return {
        mappingId: ruleId,
        process: FAMILY.get(ruleId) ?? ruleId,
        ...(c
          ? { ...c, ...indicators(c) }
          : {
              tp: null,
              fp: null,
              fn: null,
              tn: null,
              total: null,
              matchRate: null,
              sensitivity: null,
              specificity: null,
            }),
        notes: !mapped.has(ruleId)
          ? 'No think-aloud code mapped to this rule'
          : sessionIds.length === 0
            ? 'No annotated sessions'
            : '',
      };
    });
    const pooled = [...totals.values()].reduce(addConfusion, { tp: 0, fp: 0, fn: 0, tn: 0 });
    return {
      courseId,
      researcherId: opts.researcherId,
      sessions: sessionIds.length,
      segmentMs,
      toleranceMs,
      rows,
      pooled: { ...pooled, ...indicators(pooled) },
      benchmark:
        'Fan et al. (2022): ~55% overall match after think-aloud-informed revision (35–39% before).',
    };
  }

  /** CSV in the workbook Validation sheet's column order. */
  async reportCsv(courseId: string, opts: ValidationOptions): Promise<string> {
    const r = await this.report(courseId, opts);
    const head = [
      'Mapping ID',
      'Process',
      'Both coded (TP)',
      'Trace only (FP)',
      'Think-aloud only (FN)',
      'Neither (TN)',
      'Total segments',
      'Match rate',
      'Sensitivity',
      'Specificity',
      'Notes',
    ];
    const fmt = (v: number | null) =>
      v == null ? '' : Number.isInteger(v) ? String(v) : v.toFixed(4);
    const lines = [head.map(csvCell).join(',')];
    for (const row of r.rows) {
      lines.push(
        [
          row.mappingId,
          row.process,
          fmt(row.tp),
          fmt(row.fp),
          fmt(row.fn),
          fmt(row.tn),
          fmt(row.total),
          fmt(row.matchRate),
          fmt(row.sensitivity),
          fmt(row.specificity),
          row.notes,
        ]
          .map(csvCell)
          .join(','),
      );
    }
    const p = r.pooled;
    lines.push(
      [
        'Pooled (excl. example)',
        '',
        fmt(p.tp),
        fmt(p.fp),
        fmt(p.fn),
        fmt(p.tn),
        fmt(p.total),
        fmt(p.matchRate),
        fmt(p.sensitivity),
        fmt(p.specificity),
        `${r.sessions} session(s); ${r.segmentMs / 1000}s segments; ±${r.toleranceMs / 1000}s tolerance`,
      ]
        .map(csvCell)
        .join(','),
    );
    return lines.join('\n') + '\n';
  }

  /** Inter-rater agreement per code label on sessions both researchers coded. */
  async interRater(
    courseId: string,
    coderA: string,
    coderB: string,
    segmentMs = 30_000,
    toleranceMs = 5_000,
  ) {
    const rows = await this.annotatedSessions(courseId, [coderA, coderB]);
    const byS = new Map<string, Set<string>>();
    for (const r of rows)
      byS.set(r.sessionId, (byS.get(r.sessionId) ?? new Set()).add(r.researcherId));
    const sharedAll = [...byS]
      .filter(([, set]) => set.has(coderA) && set.has(coderB))
      .map(([id]) => id);
    const shared = await this.consentingSessions(courseId, sharedAll);
    const vectors = new Map<string, { a: number[]; b: number[] }>();
    for (const sessionId of shared) {
      const { start, end, anns } = await this.sessionData(sessionId, [coderA, coderB]);
      const segs = segments(start, end, segmentMs);
      for (const c of VALIDATION_CODEBOOK) {
        if (!c.rules.length) continue;
        const key = c.label.toLowerCase();
        const coded = (who: string) =>
          segs.map((seg) =>
            anns.some(
              (a) =>
                a.researcherId === who &&
                a.label.toLowerCase() === key &&
                overlaps(seg, a, toleranceMs),
            )
              ? 1
              : 0,
          );
        const v = vectors.get(c.label) ?? { a: [], b: [] };
        v.a.push(...coded(coderA));
        v.b.push(...coded(coderB));
        vectors.set(c.label, v);
      }
    }
    const codes = [...vectors].map(([label, v]) => ({
      label,
      segments: v.a.length,
      kappa: cohenKappa(v.a, v.b),
      agreement: v.a.length ? v.a.filter((x, i) => x === v.b[i]).length / v.a.length : null,
    }));
    return {
      courseId,
      coderA,
      coderB,
      sharedSessions: shared.length,
      segmentMs,
      toleranceMs,
      codes,
      target: 0.7,
    };
  }

  // ── rule status (candidate ⇄ validated) ─────────────────────────────────

  async ruleStatuses() {
    const changes = await this.prisma.learningEventRuleStatusChange.findMany({
      orderBy: { changedAt: 'asc' },
    });
    const current = new Map<string, (typeof changes)[number]>();
    for (const c of changes) current.set(c.ruleId, c);
    return RULE_IDS.map((ruleId) => ({
      ruleId,
      status: current.get(ruleId)?.status ?? CANDIDATE,
      changedAt: current.get(ruleId)?.changedAt ?? null,
      changedBy: current.get(ruleId)?.changedBy ?? null,
      note: current.get(ruleId)?.note ?? null,
      history: changes.filter((c) => c.ruleId === ruleId).length,
    }));
  }

  /**
   * Logged, reversible researcher decision (plan Phase 5.1 #5). Existing
   * learning_events rows for the rule are restamped so exports reflect it.
   */
  async setRuleStatus(
    ruleId: string,
    status: string,
    changedBy: string,
    note?: string,
    evidence?: unknown,
  ) {
    if (!RULE_IDS.includes(ruleId)) throw new BadRequestException(`Unknown rule ${ruleId}`);
    if (status !== CANDIDATE && status !== VALIDATED)
      throw new BadRequestException('status must be candidate or validated');
    const change = await this.prisma.learningEventRuleStatusChange.create({
      data: {
        ruleId,
        status,
        changedBy,
        note: note ?? null,
        evidence: (evidence ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    const { count } = await this.prisma.learningEvent.updateMany({
      where: { ruleId },
      data: { confidence: status },
    });
    return { change, restamped: count };
  }

  async validatedRuleIds(): Promise<Set<string>> {
    return new Set(
      (await this.ruleStatuses()).filter((r) => r.status === VALIDATED).map((r) => r.ruleId),
    );
  }
}

export function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
