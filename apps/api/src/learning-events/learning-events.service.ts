import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma';
import {
  CURRENT_LIBRARY,
  LIBRARIES,
  LIBRARY_HASH,
  LIBRARY_VERSION,
  defaultParams,
  engineVersion,
  resolveParams,
  sha256,
} from './engine/params';
import { prepareActions } from './engine/prepare';
import {
  NO_PATTERN,
  UNRESOLVED,
  detectionKey,
  enrich,
  residuals,
  stableJson,
} from './engine/provenance';
import { RULES, runRules } from './engine/rules';
import type { LibraryVersion, PriorHistory, RawAction } from './engine/types';

const library = LIBRARIES[CURRENT_LIBRARY];

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
    await this.parseWithRun(payload.sessionId, 'close');
  }

  /** Late events arrived for a closed session (SessionService.scheduleReparse). */
  @OnEvent('session.reparse', { async: true })
  async onSessionReparse(payload: { sessionId: string; trigger?: string }) {
    await this.parseWithRun(payload.sessionId, payload.trigger ?? 'late_events');
  }

  /**
   * Parse a session and record the run (session_parse_runs), so "never
   * parsed" differs from "parsed, no detections" (CAP-82). Never throws:
   * the parser must not affect session close.
   */
  async parseWithRun(sessionId: string, trigger: string) {
    const run = await this.prisma.sessionParseRun
      .create({
        data: { sessionId, trigger, status: 'running', libraryVersion: LIBRARY_VERSION },
      })
      .catch(() => null);
    try {
      const r = await this.computeSession(sessionId, undefined, { parseRunId: run?.id });
      if (run) {
        await this.prisma.sessionParseRun.update({
          where: { id: run.id },
          data: {
            status: 'ok',
            finishedAt: new Date(),
            libraryVersion: r.libraryVersion,
            libraryHash: r.libraryHash,
            parameterHash: r.parameterHash,
            parameterSetVersion: r.parameterSetVersion,
            rawActions: r.rawActions,
            detections: r.learningEvents,
          },
        });
      }
      return r;
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.warn(`learning-event parse failed for ${sessionId}: ${msg}`);
      if (run) {
        await this.prisma.sessionParseRun
          .update({
            where: { id: run.id },
            data: { status: 'error', finishedAt: new Date(), error: msg.slice(0, 1000) },
          })
          .catch(() => undefined);
      }
      return null;
    }
  }

  /**
   * Parse one session with a library version (default: the current one) and
   * a parameter set (default: the latest), and store the detections with
   * their provenance (Prompt B, P4): stable key, library hash, engine
   * version, parameter snapshot, measured values and thresholds, other
   * rules on the same evidence, non-activity sources, plus residual outputs
   * (NO_PATTERN, UNRESOLVED) and a coverage record.
   *
   * Earlier versions are kept (PI decision 8): only rows of the same
   * library hash + parameter snapshot are replaced; every other row of the
   * session is marked is_current = false.
   */
  async computeSession(
    sessionId: string,
    parameterSetVersion?: number,
    opts: { library?: LibraryVersion; parseRunId?: string } = {},
  ) {
    const version = opts.library ?? CURRENT_LIBRARY;
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
    const params = resolveParams(set.values, version);
    const libraryHash = LIBRARY_HASH[version];
    const parameterHash = sha256(stableJson({ library: version, params }));
    await this.prisma.parameterSetSnapshot.upsert({
      where: { hash: parameterHash },
      create: {
        hash: parameterHash,
        libraryVersion: version,
        values: params as unknown as Prisma.InputJsonValue,
      },
      update: {},
    });

    // Ordered by time then id, so which copy of a double-posted row is kept
    // (and so the source ids) is the same on every recompute (CAP-72).
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
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    const { actions, duplicates } = prepareActions(rows.map((r) => toRaw(r as Row)));

    const visibilityRows = await this.prisma.visibility_logs.findMany({
      where: { sessionId },
      select: { id: true, timestamp: true, visibleState: true },
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
    });
    const visibility = visibilityRows.map((v) => ({
      id: v.id,
      at: Number(v.timestamp),
      state: v.visibleState,
    }));

    const prior = await this.priorHistory(session.userId, actions);
    const validated = await this.validatedRules();
    const span = actions.length
      ? {
          gte: new Date(actions[0]!.at - 60_000),
          lte: new Date(actions[actions.length - 1]!.at + 60_000),
        }
      : null;
    const classifications = span
      ? (
          await this.prisma.aiPromptClassification.findMany({
            where: { studentId: session.userId, occurredAt: span },
            select: { id: true, sourceType: true, sourceId: true, occurredAt: true, label: true },
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          })
        ).map((c) => ({
          id: c.id,
          sourceType: c.sourceType,
          sourceId: c.sourceId,
          at: c.occurredAt.getTime(),
          label: c.label,
        }))
      : [];
    const input = { actions, visibility, prior, params, classifications, library: version };
    const drafts = runRules(input);
    const enriched = enrich(drafts, input, version);
    const { residual, coverage } = residuals(drafts, input);

    const family = new Map(LIBRARIES[version].rules.map((r) => [r.id, r.family ?? r.id]));
    const engine = engineVersion();
    const courseId = session.courseId ?? actions.find((a) => a.courseId)?.courseId ?? null;
    const seen = new Set<string>();
    const data: Prisma.LearningEventCreateManyInput[] = [];
    for (const d of [...enriched, ...residual]) {
      const sourceIds = d.sources.map((x) => x.id);
      const key = detectionKey({
        sessionId,
        ruleId: d.ruleId,
        outcome: d.outcome,
        parameterHash,
        libraryHash,
        start: d.start,
        sourceIds: [...sourceIds, ...(d.sourceRefs ?? [])],
      });
      if (seen.has(key)) continue; // the same detection twice in one run
      seen.add(key);
      data.push({
        studentId: session.userId,
        sessionId,
        courseId,
        moduleItemId: d.moduleItemId ?? null,
        slideKey: d.slideKey ?? null,
        ruleId: d.ruleId,
        eventFamily:
          d.ruleId === NO_PATTERN || d.ruleId === UNRESOLVED
            ? 'Residual'
            : (family.get(d.ruleId) ?? d.ruleId),
        outcome: d.outcome ?? null,
        startAt: new Date(d.start),
        endAt: new Date(d.end),
        sourceActionIds: sourceIds,
        confidence: validated.has(d.ruleId) ? 'validated' : 'candidate',
        libraryVersion: LIBRARIES[version].libraryVersion,
        parameterSetVersion: set.version,
        detail: (d.detail ?? undefined) as Prisma.InputJsonValue | undefined,
        detectionKey: key,
        libraryHash,
        engineVersion: engine,
        parameterHash,
        computedValues: d.computedValues as unknown as Prisma.InputJsonValue,
        alternatives: d.alternatives,
        evidenceClass: d.evidenceClass,
        sourceRefs: d.sourceRefs ?? [],
        isCurrent: true,
        parseRunId: opts.parseRunId ?? null,
      });
    }

    const sameVersion = { sessionId, libraryHash, parameterHash };
    await this.prisma.$transaction([
      this.prisma.learningEvent.updateMany({
        where: { sessionId, isCurrent: true },
        data: { isCurrent: false },
      }),
      // Rows computed before provenance (library_hash null) are kept too,
      // marked not current: they are the v2 results as first stored.
      this.prisma.learningEvent.deleteMany({ where: sameVersion }),
      this.prisma.learningEvent.createMany({ data }),
      this.prisma.learningEventCoverage.updateMany({
        where: { sessionId, isCurrent: true },
        data: { isCurrent: false },
      }),
      this.prisma.learningEventCoverage.deleteMany({ where: sameVersion }),
      this.prisma.learningEventCoverage.create({
        data: {
          sessionId,
          libraryVersion: LIBRARIES[version].libraryVersion,
          libraryHash,
          parameterHash,
          ...coverage,
          isCurrent: true,
        },
      }),
    ]);
    return {
      sessionId,
      libraryVersion: LIBRARIES[version].libraryVersion,
      libraryHash,
      parameterHash,
      parameterSetVersion: set.version,
      rawActions: rows.length,
      duplicatesRemoved: duplicates,
      learningEvents: data.length,
      coverage,
      byRule: data.reduce<Record<string, number>>(
        (acc, d) => ((acc[d.ruleId] = (acc[d.ruleId] ?? 0) + 1), acc),
        {},
      ),
    };
  }

  /** Rules whose latest status change (Phase 5 validation) is 'validated'. */
  private async validatedRules(): Promise<Set<string>> {
    const changes = await this.prisma.learningEventRuleStatusChange.findMany({
      orderBy: { changedAt: 'asc' },
      select: { ruleId: true, status: true },
    });
    const latest = new Map<string, string>();
    for (const c of changes) latest.set(c.ruleId, c.status);
    return new Set([...latest].filter(([, st]) => st === 'validated').map(([id]) => id));
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
      where: { sessionId, isCurrent: true },
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
      where: { sessionId: { in: sessionIds }, isCurrent: true },
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
