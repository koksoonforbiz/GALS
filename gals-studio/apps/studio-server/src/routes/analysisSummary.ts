import type { FastifyInstance } from 'fastify';
import AdmZip from 'adm-zip';
import { prisma } from '../prisma.js';
import { classifyActivity } from '../analysis/activityInference.js';
import {
  computeAffect,
  DEFAULT_AFFECT_OPTS,
  type AffectOpts,
  type AffectMethod,
} from '../analysis/affectMapping.js';
import {
  getTrims,
  isTrimmed,
  retainedDurationMs,
  wallInRange,
  FULL_RANGE,
  type RetainRange,
} from '../analysis/trim.js';

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

async function summariseSession(
  sessionId: string,
  base: number,
  range: RetainRange = FULL_RANGE,
): Promise<unknown> {
  const [allInterventions, allUtterCodings, allAnns, allEfs, dataHealth] = await Promise.all([
    prisma.intervention.findMany({ where: { sessionId }, orderBy: { wallMs: 'asc' } }),
    prisma.utteranceCoding.findMany({ where: { sessionId, source: 'intervention' } }),
    prisma.annotation.findMany({ where: { sessionId, codingPass: { in: CODER_PASSES } } }),
    prisma.efDetection.findMany({ where: { sessionId }, orderBy: { wallMs: 'asc' } }),
    sessionDataHealth(sessionId),
  ]);

  // Keep only what falls inside the retained window. Reliability-pass marks with
  // no wall-clock time (window-coded) are kept regardless.
  const keep = wallInRange(base, range);
  const interventions = allInterventions.filter((iv) => keep(iv.wallMs));
  const utterCodings = allUtterCodings.filter((c) => keep(c.refWallMs));
  const efs = allEfs.filter((d) => keep(d.wallMs));
  const anns = allAnns.filter((a) => {
    const t = a.atWallMs ?? a.startWallMs ?? null;
    return t == null || keep(t);
  });

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

  // 1f — coder coding (timeline + reliability passes). matchesMachine compares
  // the coder's label against the model pre-fill captured at coding time.
  const coderCoding = anns.map((a) => ({
    coderId: a.coderId,
    codingPass: a.codingPass,
    dimension: a.dimension,
    codeLabel: a.code,
    startMs:
      a.startWallMs != null ? a.startWallMs - base : a.atWallMs != null ? a.atWallMs - base : null,
    endMs: a.endWallMs != null ? a.endWallMs - base : null,
    confidence: a.confidence,
    notes: a.notes,
    machineGuess: a.machineGuess ?? null,
    matchesMachine: a.machineGuess != null ? a.machineGuess === a.code : null,
  }));

  // Part A flow-back — coder confirmations/overrides of the model guesses. Only
  // timeline marks that carried a machineGuess count toward agreement.
  const overridesFor = (dimension: string) => {
    const marks = anns.filter((a) => a.codingPass === 'timeline' && a.dimension === dimension);
    const withGuess = marks.filter((a) => a.machineGuess != null);
    const agree = withGuess.filter((a) => a.machineGuess === a.code).length;
    return {
      marks: marks.length,
      withGuess: withGuess.length,
      agree,
      override: withGuess.length - agree,
      agreementPct: withGuess.length ? agree / withGuess.length : null,
    };
  };

  return {
    interventions: {
      system: { byType: systemByType, total: systemTotal },
      coder: { byType: coderByType, total: coderTotal },
      disagreement: Math.abs(systemTotal - coderTotal),
    },
    practiceTesting,
    efDetections,
    coderCoding,
    coderOverrides: { activity: overridesFor('activity'), affect: overridesFor('affect') },
    dataHealth,
  };
}

/**
 * Fetched-vs-expected data diagnostics: raw stream counts plus flags for the
 * known gaps that quietly degrade the analysis (no face → no affect; no gaze →
 * no activity; fire-and-forget chatbot logging → messages can be missing even
 * when interventions/dialogue happened). Surfaced so a researcher never reads a
 * sparse result as a real null.
 */
async function sessionDataHealth(sessionId: string): Promise<unknown> {
  const [snapshots, gaze, au, emotion, webcam, chatbot, dialogue] = await Promise.all([
    prisma.snapshot.count({ where: { sessionId } }),
    prisma.gazeSample.count({ where: { sessionId } }),
    prisma.auResult.count({ where: { sessionId } }),
    prisma.emotionFrame.count({ where: { sessionId, faceDetected: true } }),
    prisma.webcamSegment.count({ where: { sessionId, status: 'ok' } }),
    prisma.chatbotMessage.count({ where: { sessionId } }),
    prisma.dialogueMessage.count({ where: { sessionId } }),
  ]);
  const flags: string[] = [];
  if (snapshots === 0) flags.push('no DOM snapshots (activity inference blind)');
  if (gaze === 0) flags.push('no gaze (activity falls back to DOM only)');
  if (au === 0 && emotion === 0) flags.push('no face frames (affect is Wickens-only)');
  if (webcam === 0) flags.push('no webcam video (cannot verify affect by replay)');
  // fire-and-forget chatbot logging: dialogue exists but chat messages are empty
  if (chatbot === 0 && dialogue > 0) flags.push('chatbot messages missing (fire-and-forget?)');
  return {
    counts: { snapshots, gaze, au, emotion, webcam, chatbot, dialogue },
    flags,
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
      const trims = await getTrims(sessions.map((s) => s.id));

      // sessions are summarised sequentially to avoid loading every learner's
      // raw gaze/cursor stream into memory at once. The activity windows are
      // reused for the affect Wickens channel rather than reclassifying. Every
      // aggregate is computed over the researcher's retained window only.
      const summaries = [];
      for (const s of sessions) {
        const range = trims.get(s.id) ?? FULL_RANGE;
        const core = (await summariseSession(s.id, s.baseWallClockMs, range)) as object;
        const activity = await classifyActivity(s.id, { binMs, gazeConf, range });
        const affect = await computeAffect(s.id, affectOpts, activity?.windows, range);
        summaries.push({
          userId: s.userId,
          userDisplayName: s.userDisplayName,
          sessionId: s.id,
          courseTitle: s.courseTitle,
          startedAt: s.startedAt.toISOString(),
          endedAt: s.endedAt ? s.endedAt.toISOString() : null,
          durationSecs: Math.round(retainedDurationMs(s.durationMs, range) / 1000),
          fullDurationSecs: Math.round(s.durationMs / 1000),
          trimmed: isTrimmed(range),
          retainedWindow: range,
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

  // Machine guesses for the coder timeline: per-window activity (Part B) + fused
  // affect (Part C), collapsed into contiguous same-label SEGMENTS so the coder
  // can click one to accept/override (the accepted mark stores machineGuess).
  app.get<{ Params: { sessionId: string }; Querystring: { binMs?: string; gazeConf?: string } }>(
    '/api/analysis/:sessionId/guesses',
    async (req, reply) => {
      const binMs = Number(req.query.binMs) || 1000;
      const gazeConf = Number(req.query.gazeConf) || 0.5;
      const activity = await classifyActivity(req.params.sessionId, { binMs, gazeConf });
      if (!activity) return reply.code(404).send({ error: 'session not found' });
      const affect = await computeAffect(
        req.params.sessionId,
        { ...DEFAULT_AFFECT_OPTS, binMs, emitWindows: true },
        activity.windows,
      );

      // collapse a per-window label stream into [start,end) segments
      const segmentsOf = <T extends string>(
        items: Array<{ tMs: number; label: T }>,
        drop: (l: T) => boolean,
      ) => {
        const segs: Array<{ code: T; startMs: number; endMs: number }> = [];
        for (const it of items) {
          const last = segs[segs.length - 1];
          if (last && last.code === it.label && it.tMs === last.endMs) last.endMs = it.tMs + binMs;
          else segs.push({ code: it.label, startMs: it.tMs, endMs: it.tMs + binMs });
        }
        return segs.filter((s) => !drop(s.code));
      };

      const activitySegments = segmentsOf(
        activity.windows.map((w) => ({ tMs: w.tMs, label: w.primaryActivity })),
        (l) => l === 'idle' || l === 'gaze_unknown', // don't ask the coder to confirm dead air
      );
      const affectSegments = affect?.windowStates
        ? segmentsOf(
            affect.windowStates.map((w) => ({ tMs: w.tMs, label: w.fused })),
            (l) => l === 'neutral',
          )
        : [];

      return {
        binMs,
        configVersion: affect?.configVersion ?? null,
        activitySegments,
        affectSegments,
      };
    },
  );

  // One-click research export: chat utterances + the LLM (text-mining) EF results
  // + a per-session summary, each as its own CSV inside a single zip ("tabs").
  app.get<{ Querystring: { userIds?: string; sessionIds?: string } }>(
    '/api/analysis/export.zip',
    async (req, reply) => {
      let sessionIds = (req.query.sessionIds ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const userIds = (req.query.userIds ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (sessionIds.length === 0 && userIds.length === 0)
        return reply.code(400).send({ error: 'userIds or sessionIds required' });

      const sessions = await prisma.session.findMany({
        where: sessionIds.length ? { id: { in: sessionIds } } : { userId: { in: userIds } },
        orderBy: [{ userId: 'asc' }, { startedAt: 'asc' }],
      });
      sessionIds = sessions.map((s) => s.id);
      const meta = new Map(
        sessions.map((s) => [
          s.id,
          {
            base: s.baseWallClockMs,
            user: s.userDisplayName ?? s.userId.slice(0, 8),
            course: s.courseTitle ?? '',
            started: s.startedAt.toISOString(),
            durationSecs: Math.round(s.durationMs / 1000),
          },
        ]),
      );

      const [chatAll, dialogueAll, efsAll, interventionsAll, trims] = await Promise.all([
        prisma.chatbotMessage.findMany({
          where: { sessionId: { in: sessionIds } },
          orderBy: [{ sessionId: 'asc' }, { wallMs: 'asc' }],
        }),
        prisma.dialogueMessage.findMany({
          where: { sessionId: { in: sessionIds } },
          orderBy: [{ sessionId: 'asc' }, { wallMs: 'asc' }],
        }),
        prisma.efDetection.findMany({
          where: { sessionId: { in: sessionIds } },
          orderBy: [{ sessionId: 'asc' }, { wallMs: 'asc' }],
        }),
        prisma.intervention.findMany({
          where: { sessionId: { in: sessionIds } },
          orderBy: [{ sessionId: 'asc' }, { wallMs: 'asc' }],
        }),
        getTrims(sessionIds),
      ]);

      // Some students never use the standalone chatbot — their conversation lives
      // inside interrogative-elaboration interventions, and their typed reasoning
      // inside stepwise / practice answers. Mine those out of sessionData so the
      // export is not empty for them.
      type ElabMsg = {
        sessionId: string;
        wallMs: number;
        role: string;
        content: string;
        selectedText: string;
      };
      type IvResp = {
        sessionId: string;
        wallMs: number;
        type: string;
        kind: string;
        prompt: string;
        response: string;
        isCorrect: string;
        feedback: string;
      };
      const elabMsgs: ElabMsg[] = [];
      const ivResponses: IvResp[] = [];
      for (const iv of interventionsAll) {
        const d = parse<any>(iv.sessionData, {});
        const tsWall = (ts: unknown): number => {
          const p = typeof ts === 'string' ? Date.parse(ts) : NaN;
          return Number.isFinite(p) ? p : iv.wallMs;
        };
        if (iv.type === 'INTERROGATIVE_ELABORATION' && Array.isArray(d?.conversation)) {
          for (const m of d.conversation)
            elabMsgs.push({
              sessionId: iv.sessionId,
              wallMs: tsWall(m?.timestamp),
              role: m?.role ?? '',
              content: m?.content ?? '',
              selectedText: m?.selectedText ?? d?.selectedText ?? '',
            });
        }
        if (iv.type === 'STEPWISE_LEARNING') {
          const qByNum = new Map<string, string>();
          for (const s of Array.isArray(d?.steps) ? d.steps : [])
            qByNum.set(String(s?.stepNumber), s?.comprehensionCheck?.question ?? '');
          for (const [num, res] of Object.entries<any>(d?.stepResults ?? {}))
            for (const ur of res?.userResponses ?? [])
              ivResponses.push({
                sessionId: iv.sessionId,
                wallMs: tsWall(ur?.timestamp),
                type: iv.type,
                kind: 'stepwise_response',
                prompt: qByNum.get(String(num)) ?? '',
                response: ur?.response ?? '',
                isCorrect: ur?.isCorrect == null ? '' : String(ur.isCorrect),
                feedback: ur?.feedback ?? '',
              });
        }
        if (iv.type === 'PRACTICE_TESTING') {
          for (const r of Array.isArray(d?.results) ? d.results : [])
            ivResponses.push({
              sessionId: iv.sessionId,
              wallMs: iv.wallMs,
              type: iv.type,
              kind: r?.type ?? 'practice',
              prompt: r?.question ?? '',
              response: r?.userAnswer ?? '',
              isCorrect: r?.correct == null ? '' : String(r.correct),
              feedback: r?.explanation ?? '',
            });
        }
      }

      // keep only rows inside each session's retained window (if trimmed)
      const keepRow = (r: { sessionId: string; wallMs: number }) => {
        const m = meta.get(r.sessionId);
        return m ? wallInRange(m.base, trims.get(r.sessionId) ?? FULL_RANGE)(r.wallMs) : true;
      };
      const chat = chatAll.filter(keepRow);
      const dialogue = dialogueAll.filter(keepRow);
      const efs = efsAll.filter(keepRow);
      const elab = elabMsgs.filter(keepRow);
      const ivResp = ivResponses.filter(keepRow);

      const esc = (v: unknown) => {
        const s = v == null ? '' : String(v);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const toCsv = (header: string[], rows: unknown[][]) =>
        '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
      const relSec = (sid: string, wallMs: number) =>
        Math.round((wallMs - (meta.get(sid)?.base ?? 0)) / 1000);
      const user = (sid: string) => meta.get(sid)?.user ?? '';

      const bySessThenTime = (a: unknown[], b: unknown[]) =>
        String(a[1]).localeCompare(String(b[1])) || Number(a[3]) - Number(b[3]);

      // free-dialogue.csv — the open chatbot (+ legacy dialogue), NOT tied to a
      // learning strategy: the student freely asks the AI anything.
      const freeRows = [
        ...chat.map((m) => [
          user(m.sessionId),
          m.sessionId,
          'chat',
          relSec(m.sessionId, m.wallMs),
          m.role,
          m.content,
          m.model ?? '',
          m.selectedText ?? '',
        ]),
        ...dialogue.map((m) => [
          user(m.sessionId),
          m.sessionId,
          'dialogue',
          relSec(m.sessionId, m.wallMs),
          m.role,
          m.content,
          '',
          '',
        ]),
      ].sort(bySessThenTime);
      const freeDialogueCsv = toCsv(
        ['user', 'sessionId', 'source', 'relSec', 'role', 'content', 'model', 'selectedText'],
        freeRows,
      );

      // learning-strategy-utterances.csv — conversational utterances that occur
      // INSIDE a learning strategy (currently interrogative-elaboration), stored
      // in Intervention.sessionData rather than the ChatbotMessage table.
      const strategyRows = elab
        .map((m) => [
          user(m.sessionId),
          m.sessionId,
          'INTERROGATIVE_ELABORATION',
          relSec(m.sessionId, m.wallMs),
          m.role,
          m.content,
          m.selectedText,
        ])
        .sort(bySessThenTime);
      const strategyCsv = toCsv(
        ['user', 'sessionId', 'strategy', 'relSec', 'role', 'content', 'selectedText'],
        strategyRows,
      );

      // intervention-responses.csv (the student's typed answers + AI feedback —
      // stepwise free-text responses and practice-test answers)
      const ivRespCsv = toCsv(
        [
          'user',
          'sessionId',
          'relSec',
          'interventionType',
          'kind',
          'prompt',
          'response',
          'isCorrect',
          'feedback',
        ],
        ivResp
          .slice()
          .sort((a, b) => a.sessionId.localeCompare(b.sessionId) || a.wallMs - b.wallMs)
          .map((r) => [
            user(r.sessionId),
            r.sessionId,
            relSec(r.sessionId, r.wallMs),
            r.type,
            r.kind,
            r.prompt,
            r.response,
            r.isCorrect,
            r.feedback,
          ]),
      );

      // ef-text-mining.csv (raw LLM EF detections)
      const efCsv = toCsv(
        [
          'user',
          'sessionId',
          'relSec',
          'construct',
          'label',
          'confidence',
          'severity',
          'rationale',
          'model',
          'sourceRef',
        ],
        efs.map((d) => [
          user(d.sessionId),
          d.sessionId,
          relSec(d.sessionId, d.wallMs),
          d.construct,
          d.label,
          d.confidence ?? '',
          d.severity ?? '',
          d.rationale ?? '',
          d.model ?? '',
          d.sourceRef ?? '',
        ]),
      );

      // summary.csv (one row per session)
      const countBy = <T extends { sessionId: string }>(arr: T[]) => {
        const m: Record<string, number> = {};
        for (const t of arr) m[t.sessionId] = (m[t.sessionId] ?? 0) + 1;
        return m;
      };
      const chatN = countBy(chat);
      const dialN = countBy(dialogue);
      const efN = countBy(efs);
      const elabN = countBy(elab);
      const ivRespN = countBy(ivResp);
      const efConstructs = new Map<string, Set<string>>();
      for (const d of efs) {
        if (!efConstructs.has(d.sessionId)) efConstructs.set(d.sessionId, new Set());
        efConstructs.get(d.sessionId)!.add(d.construct);
      }
      const summaryCsv = toCsv(
        [
          'user',
          'sessionId',
          'course',
          'started',
          'durationSec',
          'trimmed',
          'chatMessages',
          'dialogueMessages',
          'elaborationMessages',
          'interventionResponses',
          'efDetections',
          'efConstructs',
        ],
        sessions.map((s) => {
          const range = trims.get(s.id) ?? FULL_RANGE;
          return [
            meta.get(s.id)?.user,
            s.id,
            meta.get(s.id)?.course,
            meta.get(s.id)?.started,
            Math.round(retainedDurationMs(s.durationMs, range) / 1000),
            isTrimmed(range) ? 'yes' : 'no',
            chatN[s.id] ?? 0,
            dialN[s.id] ?? 0,
            elabN[s.id] ?? 0,
            ivRespN[s.id] ?? 0,
            efN[s.id] ?? 0,
            [...(efConstructs.get(s.id) ?? [])].sort().join(' | '),
          ];
        }),
      );

      const zip = new AdmZip();
      zip.addFile('free-dialogue.csv', Buffer.from(freeDialogueCsv, 'utf8'));
      zip.addFile('learning-strategy-utterances.csv', Buffer.from(strategyCsv, 'utf8'));
      zip.addFile('intervention-responses.csv', Buffer.from(ivRespCsv, 'utf8'));
      zip.addFile('ef-text-mining.csv', Buffer.from(efCsv, 'utf8'));
      zip.addFile('summary.csv', Buffer.from(summaryCsv, 'utf8'));
      return reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', 'attachment; filename="cohort-export.zip"')
        .send(zip.toBuffer());
    },
  );
}
