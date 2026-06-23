import type { FastifyInstance } from 'fastify';
import { prisma } from '../prisma.js';
import { classifyActivity } from '../analysis/activityInference.js';
import {
  computeAffect,
  DEFAULT_AFFECT_OPTS,
  type AffectOpts,
  type AffectMethod,
} from '../analysis/affectMapping.js';

/**
 * Research Analysis Studio: cross-session cohort summary.
 * Returns, per (user, session), read-only aggregates from existing studio
 * tables — interventions (1a), practice-testing (1c), EF detections (1e),
 * coder coding (1f) — plus the Part B activity-inference rollup (1b) and the
 * Part C per-method affect rollup (1d).
 */

const ALL_METHODS: AffectMethod[] = ['au_mapping', 'openface_emotion', 'wickens', 'fused'];

function affectOptsFromQuery(q: Record<string, string | undefined>): AffectOpts {
  const methods = (q.methods ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is AffectMethod => (ALL_METHODS as string[]).includes(s));
  return {
    methods: methods.length ? methods : DEFAULT_AFFECT_OPTS.methods,
    activationThreshold:
      q.activationThreshold != null
        ? Number(q.activationThreshold)
        : DEFAULT_AFFECT_OPTS.activationThreshold,
    persistenceWindowMs:
      q.persistenceWindowMs != null
        ? Number(q.persistenceWindowMs)
        : DEFAULT_AFFECT_OPTS.persistenceWindowMs,
    personBaseline:
      q.personBaseline != null
        ? q.personBaseline === 'true' || q.personBaseline === '1'
        : DEFAULT_AFFECT_OPTS.personBaseline,
    binMs: q.binMs != null ? Number(q.binMs) : DEFAULT_AFFECT_OPTS.binMs,
  };
}

const INTERVENTION_TYPES = [
  'PRACTICE_TESTING',
  'DISTRIBUTED_PRACTICE',
  'STEPWISE_LEARNING',
  'INTERROGATIVE_ELABORATION',
];
const CODER_PASSES = [
  'timeline',
  'primary_rater_1',
  'primary_rater_2',
  'tiebreaker',
  'gold_consensus',
];

const parse = <T>(v: string | null | undefined, fallback: T): T => {
  if (v == null) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

async function summariseSession(sessionId: string, base: number): Promise<unknown> {
  const [interventions, utterCodings, anns, efs] = await Promise.all([
    prisma.intervention.findMany({ where: { sessionId }, orderBy: { wallMs: 'asc' } }),
    prisma.utteranceCoding.findMany({ where: { sessionId, source: 'intervention' } }),
    prisma.annotation.findMany({ where: { sessionId, codingPass: { in: CODER_PASSES } } }),
    prisma.efDetection.findMany({ where: { sessionId }, orderBy: { wallMs: 'asc' } }),
  ]);

  // 1a — interventions: system vs coder, kept separate + explicit disagreement
  const systemByType: Record<string, number> = {};
  for (const t of INTERVENTION_TYPES) systemByType[t] = 0;
  for (const iv of interventions) {
    const t = iv.type ?? 'UNKNOWN';
    systemByType[t] = (systemByType[t] ?? 0) + 1;
  }
  const coderByType: Record<string, number> = {};
  for (const c of utterCodings) {
    const t = c.strategy ?? 'uncoded';
    coderByType[t] = (coderByType[t] ?? 0) + 1;
  }
  const systemTotal = interventions.length;
  const coderTotal = utterCodings.length;

  // 1c — practice testing
  const practiceTesting = interventions
    .filter((iv) => (iv.type ?? '').toUpperCase() === 'PRACTICE_TESTING')
    .map((iv) => {
      const d = parse<{
        score?: number;
        results?: Array<{ type?: string; correct?: boolean; feedback?: string }>;
      }>(iv.sessionData, {});
      const results = Array.isArray(d.results) ? d.results : [];
      const isMcq = (r: { type?: string }) => (r.type ?? '').toLowerCase() === 'mcq';
      const isShort = (r: { type?: string }) => /short/i.test(r.type ?? '');
      return {
        interventionId: String(iv.id),
        score: typeof d.score === 'number' ? d.score : null,
        mcqCorrect: results.filter((r) => isMcq(r) && r.correct).length,
        mcqTotal: results.filter(isMcq).length,
        shortAnswerCorrect: results.filter((r) => isShort(r) && r.correct).length,
        shortAnswerTotal: results.filter(isShort).length,
        perQuestion: results.map((r, idx) => ({
          idx,
          correct: !!r.correct,
          feedback: r.feedback ?? '',
        })),
      };
    });

  // 1e — EF text-mining detections
  const efDetections = efs.map((d) => ({
    construct: d.construct,
    label: d.label,
    confidence: d.confidence,
    severity: d.severity,
  }));

  // 1f — coder coding (timeline + reliability passes)
  const coderCoding = anns.map((a) => ({
    coderId: a.coderId,
    codingPass: a.codingPass,
    codeLabel: a.code,
    startMs:
      a.startWallMs != null ? a.startWallMs - base : a.atWallMs != null ? a.atWallMs - base : null,
    endMs: a.endWallMs != null ? a.endWallMs - base : null,
    confidence: a.confidence,
    notes: a.notes,
  }));

  return {
    interventions: {
      system: { byType: systemByType, total: systemTotal },
      coder: { byType: coderByType, total: coderTotal },
      disagreement: Math.abs(systemTotal - coderTotal),
    },
    practiceTesting,
    efDetections,
    coderCoding,
  };
}

export async function analysisSummaryRoutes(app: FastifyInstance): Promise<void> {
  // Cohort selector source: distinct learners + their session counts.
  app.get('/api/analysis/users', async () => {
    const rows = await prisma.session.findMany({
      select: { userId: true, userDisplayName: true },
      orderBy: { startedAt: 'desc' },
    });
    const byUser = new Map<
      string,
      { userId: string; displayName: string | null; sessions: number }
    >();
    for (const r of rows) {
      const e = byUser.get(r.userId) ?? {
        userId: r.userId,
        displayName: r.userDisplayName,
        sessions: 0,
      };
      e.sessions += 1;
      if (!e.displayName && r.userDisplayName) e.displayName = r.userDisplayName;
      byUser.set(r.userId, e);
    }
    return {
      users: [...byUser.values()].sort((a, b) =>
        (a.displayName ?? a.userId).localeCompare(b.displayName ?? b.userId),
      ),
    };
  });

  // Per (user, session) summary for the selected cohort.
  app.get<{ Querystring: { userIds?: string; binMs?: string; gazeConf?: string } }>(
    '/api/analysis/cohort-summary',
    async (req, reply) => {
      const userIds = (req.query.userIds ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (userIds.length === 0) return reply.code(400).send({ error: 'userIds required' });
      const binMs = Number(req.query.binMs) || 1000;
      const gazeConf = Number(req.query.gazeConf) || 0.5;

      const affectOpts = affectOptsFromQuery(req.query as Record<string, string | undefined>);

      const sessions = await prisma.session.findMany({
        where: { userId: { in: userIds } },
        orderBy: [{ userId: 'asc' }, { startedAt: 'asc' }],
      });

      // sessions are summarised sequentially to avoid loading every learner's
      // raw gaze/cursor stream into memory at once. The activity windows are
      // reused for the affect Wickens channel rather than reclassifying.
      const summaries = [];
      for (const s of sessions) {
        const core = (await summariseSession(s.id, s.baseWallClockMs)) as object;
        const activity = await classifyActivity(s.id, { binMs, gazeConf });
        const affect = await computeAffect(s.id, affectOpts, activity?.windows);
        summaries.push({
          userId: s.userId,
          userDisplayName: s.userDisplayName,
          sessionId: s.id,
          courseTitle: s.courseTitle,
          startedAt: s.startedAt.toISOString(),
          endedAt: s.endedAt ? s.endedAt.toISOString() : null,
          durationSecs: Math.round(s.durationMs / 1000),
          ...core,
          activity: activity?.rollup ?? null,
          affect: affect?.byMethod ?? null,
          affectFrames: affect?.framesSeen ?? null,
        });
      }
      return { sessions: summaries, affectConfigVersion: affectOpts };
    },
  );

  // Recompute affect for selected sessions under new thresholds (live panel) —
  // returns only the per-method affect rollups, not the full summary.
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/api/analysis/affect',
    async (req, reply) => {
      const sessionIds = (req.query.sessionIds ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (sessionIds.length === 0) return reply.code(400).send({ error: 'sessionIds required' });
      const opts = affectOptsFromQuery(req.query);
      const out: Record<string, unknown> = {};
      for (const id of sessionIds) {
        const r = await computeAffect(id, opts);
        out[id] = r ? { byMethod: r.byMethod, framesSeen: r.framesSeen } : null;
      }
      return { affect: out, opts };
    },
  );

  // Per-window activity classification (provenance for the coder timeline).
  app.get<{ Params: { sessionId: string }; Querystring: { binMs?: string; gazeConf?: string } }>(
    '/api/analysis/:sessionId/activity',
    async (req, reply) => {
      const binMs = Number(req.query.binMs) || 1000;
      const gazeConf = Number(req.query.gazeConf) || 0.5;
      const result = await classifyActivity(req.params.sessionId, { binMs, gazeConf });
      if (!result) return reply.code(404).send({ error: 'session not found' });
      return result;
    },
  );
}
