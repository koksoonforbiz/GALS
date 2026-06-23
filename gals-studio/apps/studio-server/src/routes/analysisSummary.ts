import type { FastifyInstance } from 'fastify';
import { prisma } from '../prisma.js';

/**
 * PR1 of the Research Analysis Studio: cross-session cohort summary.
 * Returns, per (user, session), the read-only aggregates that come straight
 * from existing studio tables — interventions (1a), practice-testing (1c),
 * EF detections (1e), and coder coding (1f). Activity inference (Part B) and
 * affect mapping (Part C) are deferred to later PRs and are intentionally
 * absent here.
 */

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
  app.get<{ Querystring: { userIds?: string } }>(
    '/api/analysis/cohort-summary',
    async (req, reply) => {
      const userIds = (req.query.userIds ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (userIds.length === 0) return reply.code(400).send({ error: 'userIds required' });

      const sessions = await prisma.session.findMany({
        where: { userId: { in: userIds } },
        orderBy: [{ userId: 'asc' }, { startedAt: 'asc' }],
      });

      const summaries = await Promise.all(
        sessions.map(async (s) => ({
          userId: s.userId,
          userDisplayName: s.userDisplayName,
          sessionId: s.id,
          courseTitle: s.courseTitle,
          startedAt: s.startedAt.toISOString(),
          endedAt: s.endedAt ? s.endedAt.toISOString() : null,
          durationSecs: Math.round(s.durationMs / 1000),
          ...((await summariseSession(s.id, s.baseWallClockMs)) as object),
        })),
      );
      return { sessions: summaries };
    },
  );
}
