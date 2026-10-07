import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma';
import library from './config/library.v2.json';
import { LIBRARY_VERSION, defaultParams, resolveParams } from './engine/params';
import { prepareActions } from './engine/prepare';
import { RULES, runRules } from './engine/rules';
import type { PriorHistory, RawAction } from './engine/types';

/** Actions the engine needs from earlier sessions (visit numbers, revisions). */
const PRIOR_ACTIONS = [
  'SLIDE_ENTERED',
  'PREDICTION_COMMITTED',
  'SELF_CHECK_SUBMITTED',
  'RATIONALE_SUBMITTED',
  'RESULTS_RECORDED',
  'BELIEF_COMMITTED',
  'REFLECTION_SUBMITTED',
] as const;

const FAMILY = new Map(library.rules.map((r) => [r.id, r.family ?? r.id]));

type Row = {
  id: string;
  action: string;
  occurredAt: Date;
  courseId: string | null;
  moduleItemId: string | null;
  interventionId: string | null;
  metadata: Prisma.JsonValue;
};

function toRaw(r: Row): RawAction {
  return {
    id: r.id,
    action: r.action,
    at: r.occurredAt.getTime(),
    courseId: r.courseId,
    moduleItemId: r.moduleItemId,
    interventionId: r.interventionId,
    meta: (r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata)
      ? r.metadata
      : {}) as Record<string, unknown>,
  };
}

/**
 * Learning-event parser (plan Phase 4): per session, orders the raw actions
 * (activity_logs + visibility_logs) on the client wall clock, removes
 * double-posted copies, applies the workbook rules and replaces that
 * session's learning_events rows. Runs on SESSION_END and on demand.
 */
@Injectable()
export class LearningEventsService {
  private readonly logger = new Logger(LearningEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── parameter sets ──────────────────────────────────────────────────────

  /** Version 1 = workbook defaults; created on first use. */
  async currentParameterSet() {
    const latest = await this.prisma.learningEventParameterSet.findFirst({
      orderBy: { version: 'desc' },
    });
    if (latest) return latest;
    return this.prisma.learningEventParameterSet.upsert({
      where: { version: 1 },
      create: {
        version: 1,
        values: {},
        note: 'Workbook defaults (Process_Mining_Library_v2.xlsx, Parameters sheet)',
      },
      update: {},
    });
  }

  async listParameterSets() {
    await this.currentParameterSet();
    const sets = await this.prisma.learningEventParameterSet.findMany({
      orderBy: { version: 'asc' },
    });
    return sets.map((s) => ({ ...s, resolved: resolveParams(s.values) }));
  }

  /** New version = previous version's overrides + these overrides. Never edits old versions. */
  async createParameterSet(
    values: Record<string, unknown>,
    note: string | undefined,
    createdBy: string,
  ) {
    const allowed = new Set(Object.keys(defaultParams()));
    const unknown = Object.keys(values).filter((k) => !allowed.has(k));
    if (unknown.length)
      throw new BadRequestException(`Unknown parameter(s): ${unknown.join(', ')}`);
    const prev = await this.currentParameterSet();
    const merged = { ...(prev.values as Record<string, unknown>), ...values };
    const resolved = resolveParams(merged);
    return this.prisma.learningEventParameterSet
      .create({
        data: {
          version: prev.version + 1,
          values: merged as Prisma.InputJsonValue,
          note: note ?? null,
          createdBy,
        },
        select: { version: true, values: true, note: true, createdAt: true },
      })
      .then((s) => ({ ...s, resolved }));
  }

  // ── compute ─────────────────────────────────────────────────────────────

  @OnEvent('session.closed', { async: true })
  async onSessionClosed(payload: { sessionId: string }) {
    try {
      await this.computeSession(payload.sessionId);
    } catch (err) {
      // Never let the parser affect session close.
      this.logger.warn(
        `learning-event parse failed for ${payload.sessionId}: ${(err as Error).message}`,
      );
    }
  }

  async computeSession(sessionId: string, parameterSetVersion?: number) {
    const session = await this.prisma.studentSession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true, courseId: true },
    });
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);

    const set = parameterSetVersion
      ? await this.prisma.learningEventParameterSet.findUnique({
          where: { version: parameterSetVersion },
        })
      : await this.currentParameterSet();
    if (!set) throw new BadRequestException(`No parameter set version ${parameterSetVersion}`);
    const params = resolveParams(set.values);

    const rows = await this.prisma.activityLog.findMany({
      where: { sessionId },
      select: {
        id: true,
        action: true,
        occurredAt: true,
        courseId: true,
        moduleItemId: true,
        interventionId: true,
        metadata: true,
      },
    });
    const { actions, duplicates } = prepareActions(rows.map((r) => toRaw(r as Row)));

    const visibilityRows = await this.prisma.visibility_logs.findMany({
      where: { sessionId },
      select: { timestamp: true, visibleState: true },
      orderBy: { timestamp: 'asc' },
    });
    const visibility = visibilityRows.map((v) => ({
      at: Number(v.timestamp),
      state: v.visibleState,
    }));

    const prior = await this.priorHistory(session.userId, actions);
    const drafts = runRules({ actions, visibility, prior, params });

    const courseId = session.courseId ?? actions.find((a) => a.courseId)?.courseId ?? null;
    const data: Prisma.LearningEventCreateManyInput[] = drafts.map((d) => ({
      studentId: session.userId,
      sessionId,
      courseId,
      moduleItemId: d.moduleItemId ?? null,
      slideKey: d.slideKey ?? null,
      ruleId: d.ruleId,
      eventFamily: FAMILY.get(d.ruleId) ?? d.ruleId,
      outcome: d.outcome ?? null,
      startAt: new Date(d.start),
      endAt: new Date(d.end),
      sourceActionIds: d.sources.map((s) => s.id),
      confidence: 'candidate',
      libraryVersion: LIBRARY_VERSION,
      parameterSetVersion: set.version,
      detail: (d.detail ?? undefined) as Prisma.InputJsonValue | undefined,
    }));

    await this.prisma.$transaction([
      this.prisma.learningEvent.deleteMany({ where: { sessionId } }),
      this.prisma.learningEvent.createMany({ data }),
    ]);
    return {
      sessionId,
      parameterSetVersion: set.version,
      rawActions: rows.length,
      duplicatesRemoved: duplicates,
      learningEvents: data.length,
      byRule: data.reduce<Record<string, number>>(
        (acc, d) => ((acc[d.ruleId] = (acc[d.ruleId] ?? 0) + 1), acc),
        {},
      ),
    };
  }

  /** Visits and commits from the learner's earlier sessions on the same items. */
  private async priorHistory(userId: string, actions: RawAction[]): Promise<PriorHistory> {
    const items = [...new Set(actions.map((a) => a.moduleItemId).filter((x): x is string => !!x))];
    const first = actions[0]?.at;
    const prior: PriorHistory = { visits: new Map(), commits: new Set() };
    if (!items.length || first == null) return prior;
    const rows = await this.prisma.activityLog.findMany({
      where: {
        userId,
        moduleItemId: { in: items },
        occurredAt: { lt: new Date(first) },
        action: { in: [...PRIOR_ACTIONS] },
      },
      select: {
        id: true,
        action: true,
        occurredAt: true,
        courseId: true,
        moduleItemId: true,
        interventionId: true,
        metadata: true,
      },
    });
    for (const a of prepareActions(rows.map((r) => toRaw(r as Row))).actions) {
      const slide = typeof a.meta.slideKey === 'string' ? a.meta.slideKey : '';
      if (a.action === 'SLIDE_ENTERED') {
        const key = `${a.moduleItemId}|${slide}`;
        prior.visits.set(key, (prior.visits.get(key) ?? 0) + 1);
      } else {
        prior.commits.add(
          `${a.moduleItemId}|${slide}|${a.meta.item == null ? '' : String(a.meta.item)}`,
        );
      }
    }
    return prior;
  }

  /** Recompute every session of a course (backfill / after recalibration). */
  async computeCourse(courseId: string, parameterSetVersion?: number) {
    const sessions = await this.courseSessionIds(courseId);
    const results = [];
    for (const id of sessions) results.push(await this.computeSession(id, parameterSetVersion));
    return { courseId, sessions: results.length, results };
  }

  private async courseSessionIds(courseId: string): Promise<string[]> {
    const [direct, viaLogs] = await Promise.all([
      this.prisma.studentSession.findMany({ where: { courseId }, select: { id: true } }),
      this.prisma.activityLog.findMany({
        where: { courseId },
        select: { sessionId: true },
        distinct: ['sessionId'],
      }),
    ]);
    return [...new Set([...direct.map((s) => s.id), ...viaLogs.map((s) => s.sessionId)])];
  }

  // ── reads ───────────────────────────────────────────────────────────────

  async sessionEvents(sessionId: string) {
    return this.prisma.learningEvent.findMany({
      where: { sessionId },
      orderBy: [{ startAt: 'asc' }, { ruleId: 'asc' }],
    });
  }

  /**
   * Coverage (plan Phase 4 #6): per rule, the sessions where its inputs
   * occurred (could fire) and where it produced ≥ 1 event (did fire).
   * Zero-coverage rules are listed, with the reason when not applicable.
   */
  async coverage(courseId: string) {
    const sessionIds = await this.courseSessionIds(courseId);
    const present = await this.prisma.activityLog.groupBy({
      by: ['sessionId', 'action'],
      where: { sessionId: { in: sessionIds } },
    });
    const actionsBySession = new Map<string, Set<string>>();
    for (const p of present) {
      const set = actionsBySession.get(p.sessionId) ?? new Set<string>();
      set.add(p.action);
      actionsBySession.set(p.sessionId, set);
    }
    const fired = await this.prisma.learningEvent.groupBy({
      by: ['ruleId', 'sessionId'],
      where: { sessionId: { in: sessionIds } },
    });
    const firedBy = new Map<string, Set<string>>();
    for (const f of fired) {
      const set = firedBy.get(f.ruleId) ?? new Set<string>();
      set.add(f.sessionId);
      firedBy.set(f.ruleId, set);
    }
    const total = sessionIds.length;
    const rules = RULES.map((r) => {
      const could = sessionIds.filter((s) =>
        r.inputs.some((a) => actionsBySession.get(s)?.has(a)),
      ).length;
      const did = firedBy.get(r.id)?.size ?? 0;
      return {
        ruleId: r.id,
        family: FAMILY.get(r.id) ?? r.id,
        sessions: total,
        couldFire: could,
        fired: did,
        couldFireShare: total ? could / total : 0,
        firedShare: total ? did / total : 0,
        status: r.notApplicable ? 'no_input' : did === 0 ? 'zero_coverage' : 'ok',
        notApplicable: r.notApplicable ?? null,
      };
    });
    return { courseId, sessions: total, libraryVersion: LIBRARY_VERSION, rules };
  }

  library() {
    return {
      libraryVersion: library.libraryVersion,
      rules: library.rules.map((r) => ({
        ...r,
        implemented: !RULES.find((x) => x.id === r.id)?.notApplicable,
        notApplicable: RULES.find((x) => x.id === r.id)?.notApplicable ?? null,
      })),
      parameters: library.parameters,
    };
  }
}
