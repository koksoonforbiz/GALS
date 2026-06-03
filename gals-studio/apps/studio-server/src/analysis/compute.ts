/**
 * Analysis orchestration: pulls rows from SQLite and feeds them to the pure,
 * unit-tested functions in @gals-studio/shared. No stats logic lives here.
 */
import {
  dimensionReliability,
  prevalence,
  dwellTimes,
  transitionMatrix,
  detectCascades,
  computePdt,
  allocationScore,
  segmentEpochs,
  gazeOnScreenByQuartile,
  readingExposure,
  prevalence as prevalenceFn,
  pearson,
  DEFAULT_EXPECTED_WEIGHTS,
  type SnapshotAoiState,
  type Aoi,
  type ReadingSnapshot,
} from '@gals-studio/shared';
import { prisma } from '../prisma.js';

const parse = <T>(v: string | null, fallback: T): T => {
  if (v == null) return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
};

/** Per-window code by pass for a dimension, scoped to one session or 'all'. */
async function windowCodes(scope: string, dimension: string) {
  const where = scope === 'all' ? { dimension } : { sessionId: scope, dimension };
  const anns = await prisma.annotation.findMany({ where: { ...where, windowId: { not: null } } });
  const map = new Map<string, Record<string, string>>();
  for (const a of anns) {
    const w = a.windowId!;
    map.set(w, map.get(w) ?? {});
    map.get(w)![a.codingPass] = a.code;
  }
  return map;
}

export async function computeReliability(scope: string, dimension: string) {
  const map = await windowCodes(scope, dimension);
  const rater1: (string | null)[] = [];
  const rater2: (string | null)[] = [];
  for (const codes of map.values()) {
    rater1.push(codes.primary_rater_1 ?? null);
    rater2.push(codes.primary_rater_2 ?? null);
  }
  // ordinal order for affect intensity is not the code itself; use nominal for codes.
  const rel = dimensionReliability(rater1, rater2);
  // per-code agreement already in rel.percentAgreement.perCode
  return {
    scope,
    dimension,
    kappa: rel.kappa.kappa,
    observedAgreement: rel.kappa.observedAgreement,
    expectedAgreement: rel.kappa.expectedAgreement,
    cautionHighKappa: rel.kappa.cautionHighKappa,
    pabak: rel.pabak,
    krippendorffAlpha: rel.alphaNominal,
    percentAgreement: rel.percentAgreement.overall,
    perCode: rel.percentAgreement.perCode,
    confusionMatrix: rel.kappa.confusionMatrix,
    nWindows: rel.nWindows,
    nDisagreements: rel.nDisagreements,
  };
}

/** Gold affect track per window index (fallback to a chosen rater pass). */
async function affectTrack(sessionId: string, fallbackPass = 'primary_rater_1'): Promise<(string | null)[]> {
  const windows = await prisma.codingWindow.findMany({ where: { sessionId }, orderBy: { index: 'asc' } });
  const anns = await prisma.annotation.findMany({
    where: { sessionId, dimension: 'affect', windowId: { not: null }, codingPass: { in: ['gold_consensus', fallbackPass] } },
  });
  const gold = new Map<string, string>();
  const fb = new Map<string, string>();
  for (const a of anns) {
    if (a.codingPass === 'gold_consensus') gold.set(a.windowId!, a.code);
    else fb.set(a.windowId!, a.code);
  }
  return windows.map((w) => gold.get(w.id) ?? fb.get(w.id) ?? null);
}

export async function computeDynamics(sessionId: string, opts: { resolutionWindows?: number } = {}) {
  const track = await affectTrack(sessionId);
  const windows = await prisma.codingWindow.findMany({ where: { sessionId }, orderBy: { index: 'asc' } });
  const cascades = detectCascades(track, { resolutionWindows: opts.resolutionWindows ?? 2 });
  return {
    sessionId,
    track,
    windows: windows.map((w) => ({ index: w.index, startWallMs: w.startWallMs, endWallMs: w.endWallMs })),
    prevalence: prevalence(track),
    dwell: dwellTimes(track),
    transitions: transitionMatrix(track),
    cascades,
    unresolved: cascades.filter((c) => !c.resolved),
    params: { resolutionWindows: opts.resolutionWindows ?? 2 },
  };
}

export async function computeAttention(sessionId: string, expectedWeights?: Record<string, Record<string, number>>) {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error('session not found');
  const [gaze, snaps, activity, viewportRow] = await Promise.all([
    prisma.gazeSample.findMany({ where: { sessionId }, orderBy: { wallMs: 'asc' }, select: { wallMs: true, x: true, y: true, confidence: true } }),
    prisma.snapshot.findMany({ where: { sessionId }, orderBy: { wallMs: 'asc' }, select: { wallMs: true, aois: true } }),
    prisma.activityEvent.findMany({ where: { sessionId }, orderBy: { wallMs: 'asc' }, select: { wallMs: true, action: true, interventionId: true } }),
    prisma.viewport.findFirst({ where: { sessionId }, orderBy: { wallMs: 'asc' } }),
  ]);
  const snapshots: SnapshotAoiState[] = snaps.map((s) => ({ wallMs: s.wallMs, aois: parse<Aoi[]>(s.aois, []) }));
  const overall = computePdt(gaze, snapshots);

  const bounds = { startWallMs: session.baseWallClockMs, endWallMs: session.baseWallClockMs + session.durationMs };
  const epochs = segmentEpochs(activity, bounds);
  const weights = expectedWeights ?? DEFAULT_EXPECTED_WEIGHTS;

  const perEpoch = epochs.map((ep) => {
    const epGaze = gaze.filter((g) => g.wallMs >= ep.startWallMs && g.wallMs < ep.endWallMs);
    const pdt = computePdt(epGaze, snapshots);
    const expected = weights[ep.type] ?? {};
    return {
      type: ep.type,
      startWallMs: ep.startWallMs,
      endWallMs: ep.endWallMs,
      pdt: pdt.pdt,
      allocationScore: allocationScore(pdt.pdt, expected),
    };
  });

  const sessionAllocation = allocationScore(overall.pdt, averageWeights(weights));
  const quartiles = gazeOnScreenByQuartile(
    gaze,
    { width: viewportRow?.width ?? 1280, height: viewportRow?.height ?? 720 },
    { startWallMs: session.baseWallClockMs, durationMs: session.durationMs },
  );

  return { sessionId, pdt: overall.pdt, epochs: perEpoch, sessionAllocation, quartiles, expectedWeights: weights };
}

function averageWeights(weights: Record<string, Record<string, number>>): Record<string, number> {
  const sum: Record<string, number> = {};
  let n = 0;
  for (const w of Object.values(weights)) {
    n += 1;
    for (const [k, v] of Object.entries(w)) sum[k] = (sum[k] ?? 0) + v;
  }
  for (const k of Object.keys(sum)) sum[k] /= n || 1;
  return sum;
}

export async function computeReading(sessionId: string) {
  const snaps = await prisma.snapshot.findMany({
    where: { sessionId }, orderBy: { wallMs: 'asc' },
    select: { wallMs: true, pageUrl: true, scrollHosts: true, pdfCurrentPage: true, pdfTotalPages: true, scrollY: true },
  });
  const reading: ReadingSnapshot[] = snaps.map((s) => ({
    wallMs: s.wallMs,
    pageUrl: s.pageUrl,
    scrollHosts: parse<ReadingSnapshot['scrollHosts']>(s.scrollHosts, null),
    pdfCurrentPage: s.pdfCurrentPage,
    pdfTotalPages: s.pdfTotalPages,
    scrollY: s.scrollY,
  }));
  const items = readingExposure(reading);
  return { sessionId, items, windowScrollOnly: items.length > 0 && items.every((i) => i.windowScrollOnly) };
}

const numField = (items: unknown, ...keys: string[]): number | null => {
  if (!items || typeof items !== 'object') return null;
  const o = items as Record<string, unknown>;
  for (const k of keys) if (typeof o[k] === 'number') return o[k] as number;
  return null;
};

/**
 * Ground-truth probe/questionnaire surfaces (stage 06): ESM trajectories for
 * the session, plus convergent-validity helpers computed ACROSS all sessions
 * (the scatter the review names — expected r ~ 0.30-0.50).
 */
export async function computeGroundTruth(sessionId: string) {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  const base = session?.baseWallClockMs ?? 0;
  const probes = await prisma.probeResponse.findMany({ where: { sessionId }, orderBy: { wallMs: 'asc' } });

  const esmTrajectory = probes
    .filter((p) => /esm|sam/i.test(p.probeType))
    .map((p) => {
      const items = safeParseJson(p.items);
      return {
        t: p.wallMs - base,
        valence: numField(items, 'valence', 'pleasure'),
        arousal: numField(items, 'arousal'),
        engagement: numField(items, 'engagement'),
      };
    });

  const paas = probes
    .filter((p) => /paas|effort/i.test(p.probeType))
    .map((p) => ({ t: p.wallMs - base, effort: numField(safeParseJson(p.items), 'effort', 'mentalEffort') }));

  const questionnaires = (await prisma.questionnaire.findMany({ where: { sessionId } })).map((q) => ({
    instrument: q.instrument,
    phase: q.phase,
    scoredSubscales: safeParseJson(q.scoredSubscales),
  }));

  // ── convergent validity across all sessions ────────────────────────────
  const allSessions = await prisma.session.findMany({ select: { id: true } });
  const aeqBoredom: number[] = [];
  const codedBoredom: number[] = [];
  const panasNA: number[] = [];
  const codedFrustration: number[] = [];
  const imiInterest: number[] = [];
  const meanEsmEngagement: number[] = [];

  for (const s of allSessions) {
    const track = await affectTrack(s.id);
    const prev = prevalenceFn(track);
    const qs = await prisma.questionnaire.findMany({ where: { sessionId: s.id } });
    const sub = (instrument: string, key: string): number | null => {
      const q = qs.find((x) => x.instrument.toLowerCase() === instrument);
      const scored = q ? (safeParseJson(q.scoredSubscales) as Record<string, number> | null) : null;
      return scored && typeof scored[key] === 'number' ? scored[key] : null;
    };
    const aeq = sub('aeq_s', 'boredom');
    if (aeq != null) { aeqBoredom.push(aeq); codedBoredom.push(prev.proportions.boredom ?? 0); }
    const na = sub('panas', 'NA');
    if (na != null) { panasNA.push(na); codedFrustration.push(prev.proportions.frustration ?? 0); }
    const interest = sub('imi', 'interestEnjoyment');
    if (interest != null) {
      const esm = await prisma.probeResponse.findMany({ where: { sessionId: s.id } });
      const engs = esm.map((p) => numField(safeParseJson(p.items), 'engagement')).filter((v): v is number => v != null);
      if (engs.length) { imiInterest.push(interest); meanEsmEngagement.push(engs.reduce((a, b) => a + b, 0) / engs.length); }
    }
  }

  const validity = {
    aeqBoredom_vs_codedBoredom: { points: zip(aeqBoredom, codedBoredom), r: pearson(aeqBoredom, codedBoredom) },
    panasNA_vs_codedFrustration: { points: zip(panasNA, codedFrustration), r: pearson(panasNA, codedFrustration) },
    imiInterest_vs_esmEngagement: { points: zip(imiInterest, meanEsmEngagement), r: pearson(imiInterest, meanEsmEngagement) },
  };

  return { sessionId, esmTrajectory, paas, questionnaires, convergentValidity: validity };
}

function zip(xs: number[], ys: number[]): { x: number; y: number }[] {
  return xs.map((x, i) => ({ x, y: ys[i] }));
}

function safeParseJson(v: string | null): unknown {
  if (v == null) return null;
  try { return JSON.parse(v); } catch { return null; }
}
