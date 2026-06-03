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
