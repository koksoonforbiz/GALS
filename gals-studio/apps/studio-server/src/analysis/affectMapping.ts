import { prisma } from '../prisma.js';
import { classifyActivity, type ActivityWindow } from './activityInference.js';

/**
 * Part C — affective-state mapping (D'Mello/Pekrun states layered on top of an
 * attention/load layer). Late, decision-level fusion of three channels, each
 * emitting a soft posterior over states; a missing channel drops out instead of
 * zeroing the estimate. The mappings live in a CONFIG object so a researcher can
 * retune weights without a code change; the active config version is returned
 * alongside the result.
 *
 * Hard rules honoured (see GALS affect notes):
 *  - AU4 alone is ambiguous between confusion and frustration → resolved by the
 *    companion AU (AU7 ⇒ confusion, AU14 ⇒ frustration).
 *  - AU1/AU2/AU4/AU14 also predict engagement → engagement is separated from
 *    frustration by baseline-corrected intensity + gaze stability, never by
 *    AU presence alone.
 *  - OpenFace "angry" is a negative-epistemic flag (AU4+AU7 = confusion), NOT
 *    anger → it feeds confusion/frustration, resolved via the AU channel.
 *  - "neutral" is NOT defaulted to engaged → split by arousal proxies.
 *  - Wickens attention/load is kept as its own layer (engagement vs boredom),
 *    never routed directly into confusion/frustration.
 *  - Person-baseline subtraction (per session) is applied when personBaseline.
 */

export type AffectState =
  | 'confusion'
  | 'frustration'
  | 'engagement'
  | 'boredom'
  | 'delight'
  | 'neutral';
export type AffectMethod = 'au_mapping' | 'openface_emotion' | 'wickens' | 'fused';

const STATES: AffectState[] = [
  'confusion',
  'frustration',
  'engagement',
  'boredom',
  'delight',
  'neutral',
];

export interface AffectMethodResult {
  pctByState: Record<AffectState, number>;
  transitions: Array<{ from: AffectState; to: AffectState; atMs: number }>;
  unresolvedConfusionEpisodes: number;
}
export interface AffectResult {
  configVersion: string;
  binMs: number;
  opts: AffectOpts;
  byMethod: Partial<Record<AffectMethod, AffectMethodResult>>;
  framesSeen: { au: number; emotion: number; pupil: number };
  // Per-window smoothed fused state (only when opts.emitWindows). This is the
  // machine guess the coder pre-fills from on the timeline.
  windowStates?: Array<{ tMs: number; fused: AffectState }>;
}

export interface AffectOpts {
  methods: AffectMethod[];
  activationThreshold: number; // min dominant posterior for a window to count (else neutral)
  persistenceWindowMs: number; // min dwell for an episode; resolution window for confusion
  personBaseline: boolean;
  binMs?: number;
  emitWindows?: boolean; // also return the per-window smoothed fused sequence
}

export const DEFAULT_AFFECT_OPTS: AffectOpts = {
  methods: ['au_mapping', 'openface_emotion', 'wickens', 'fused'],
  activationThreshold: 0.3,
  persistenceWindowMs: 3000,
  personBaseline: true,
  binMs: 1000,
};

// ── researcher-tunable config (defaults; not hardcoded in logic) ──
export const AFFECT_CONFIG = {
  version: 'gals-affect-v1',
  au: {
    confusion: { au04: 0.5, au07: 1.0, au01: 0.3 }, // AU4 shared, AU7 is the confusion companion
    frustration: { au04: 0.5, au14: 1.0, au01: 0.2, au02: 0.2 }, // AU4 shared, AU14 frustration companion
    delight: { au06: 0.6, au12: 1.0, au25: 0.3 },
    // engagement (AU6 + gaze stability + low brow) and boredom (low expressivity)
    // are computed structurally below, not as a flat weighted sum.
  } as Record<string, Record<string, number>>,
  emotion: {
    pHappiness: { delight: 0.6, engagement: 0.4 },
    pAnger: { confusion: 0.5, frustration: 0.5 }, // negative-epistemic, NOT anger
    pSurprise: { confusion: 1.0 }, // epistemic surprise / confusion onset
    pSadness: { boredom: 1.0 },
    pFear: { neutral: 0.5 }, // anxiety, down-weighted
    pDisgust: {}, // discard
    // pNeutral is split between engagement/boredom by arousal at runtime
  } as Record<string, Partial<Record<AffectState, number>>>,
  fusionWeights: { au_mapping: 0.6, openface_emotion: 0.25, wickens: 0.15 } as Record<
    string,
    number
  >,
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const zero = (): Record<AffectState, number> => ({
  confusion: 0,
  frustration: 0,
  engagement: 0,
  boredom: 0,
  delight: 0,
  neutral: 0,
});
const parseJson = <T>(v: string | null | undefined, fb: T): T => {
  if (!v) return fb;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fb;
  }
};
function normalize(p: Record<AffectState, number>): Record<AffectState, number> {
  const sum = STATES.reduce((s, k) => s + Math.max(0, p[k]), 0);
  if (sum <= 0) return { ...zero(), neutral: 1 };
  const out = zero();
  for (const k of STATES) out[k] = Math.max(0, p[k]) / sum;
  return out;
}

// ── per-channel posteriors ──

/** Channel 1 (PRIMARY): Py-Feat AU → state, on baseline-corrected intensities. */
function auPosterior(au: Record<string, number>, gazeStable: boolean): Record<AffectState, number> {
  const v = (k: string) => clamp01(au[k] ?? 0);
  const p = zero();
  for (const [k, w] of Object.entries(AFFECT_CONFIG.au.confusion)) p.confusion += w * v(k);
  for (const [k, w] of Object.entries(AFFECT_CONFIG.au.frustration)) p.frustration += w * v(k);
  for (const [k, w] of Object.entries(AFFECT_CONFIG.au.delight)) p.delight += w * v(k);
  // engagement: AU6 (cheek raiser, on-task) gated by gaze stability and LOW brow intensity
  const brow = Math.max(v('au01'), v('au02'), v('au04'), v('au14'));
  p.engagement = v('au06') * (gazeStable ? 1 : 0.4) * (1 - brow);
  // NOTE: boredom is deliberately NOT emitted by the AU channel — it has no
  // reliable facial signature (McDaniel 2007 null result; AU43 is unavailable in
  // this data). Boredom is inferred behaviorally by the Wickens channel instead.
  p.neutral = 0.2; // baseline mass so weak frames resolve to neutral, not a state
  return normalize(p);
}

/** Channel 2 (corroborating): OpenFace3 basic emotion → state. */
function emotionPosterior(
  emo: Record<string, number>,
  arousal: number,
): Record<AffectState, number> {
  const p = zero();
  for (const [probKey, mapping] of Object.entries(AFFECT_CONFIG.emotion)) {
    const prob = emo[probKey] ?? 0;
    if (!prob) continue;
    for (const [state, w] of Object.entries(mapping))
      p[state as AffectState] += prob * (w as number);
  }
  // neutral: engaged-concentration OR boredom — disambiguate by arousal, never default to engaged
  const neu = emo.pNeutral ?? 0;
  p.engagement += neu * clamp01(arousal);
  p.boredom += neu * (1 - clamp01(arousal));
  return normalize(p);
}

/** Channel 3: Wickens attention/load layer (engagement vs boredom only). */
function wickensPosterior(
  act: ActivityWindow | undefined,
  pupilElevated: boolean,
): Record<AffectState, number> {
  const p = zero();
  const a = act?.primaryActivity;
  if (a === 'reading_lesson' || a === 'chatbot' || a === 'intervention') {
    p.engagement = pupilElevated ? 1 : 0.8;
    p.neutral = 0.2;
  } else if (a === 'idle' || a === 'gaze_unknown') {
    p.boredom = 0.8;
    p.neutral = 0.2;
  } else {
    // navigating / divided_attention / off_task_tab_switch — disengaged but not clearly bored
    p.neutral = 0.7;
    p.boredom = 0.3;
  }
  return normalize(p);
}

function fuse(
  channels: Array<{ w: number; p: Record<AffectState, number> }>,
): Record<AffectState, number> {
  const present = channels.filter((c) => c.w > 0 && c.p);
  if (present.length === 0) return { ...zero(), neutral: 1 };
  const wsum = present.reduce((s, c) => s + c.w, 0);
  const out = zero();
  for (const c of present) for (const k of STATES) out[k] += (c.w / wsum) * c.p[k];
  return out;
}

function dominant(p: Record<AffectState, number>, threshold: number): AffectState {
  let best: AffectState = 'neutral',
    bestV = 0;
  for (const k of STATES)
    if (p[k] > bestV) {
      bestV = p[k];
      best = k;
    }
  return bestV >= threshold ? best : 'neutral';
}

/**
 * Debounce a per-window state sequence: a state must persist for ≥ the
 * persistence window to "count" — brief flickers are forward-filled with the
 * last committed stable state. This is what makes transitions/episodes
 * meaningful instead of per-window noise.
 */
function smooth(seq: AffectState[], minWins: number): AffectState[] {
  if (minWins <= 1 || seq.length === 0) return seq;
  const runs: Array<{ state: AffectState; start: number; end: number }> = [];
  for (let i = 0; i < seq.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.state === seq[i]) last.end = i + 1;
    else runs.push({ state: seq[i], start: i, end: i + 1 });
  }
  const out: AffectState[] = new Array(seq.length).fill('neutral');
  let committed: AffectState = 'neutral';
  for (const r of runs) {
    const stable = r.end - r.start >= minWins;
    const state = stable ? r.state : committed;
    for (let k = r.start; k < r.end; k++) out[k] = state;
    if (stable) committed = r.state;
  }
  return out;
}

/** Reduce a per-window dominant-state sequence to %, transitions, unresolved confusion. */
function rollup(
  rawSeq: AffectState[],
  binMs: number,
  persistenceWindowMs: number,
): AffectMethodResult {
  const minWins = Math.max(1, Math.round(persistenceWindowMs / binMs));
  const seq = smooth(rawSeq, minWins);
  const n = seq.length || 1;
  const pctByState = zero();
  for (const s of seq) pctByState[s] += 1 / n;

  // runs
  const runs: Array<{ state: AffectState; start: number; end: number }> = [];
  for (let i = 0; i < seq.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.state === seq[i]) last.end = i + 1;
    else runs.push({ state: seq[i], start: i, end: i + 1 });
  }
  const transitions = runs
    .slice(1)
    .map((r) => ({ from: runs[runs.indexOf(r) - 1].state, to: r.state, atMs: r.start * binMs }));

  // unresolved confusion: a confusion episode (dwell ≥ persistence) that is NOT
  // followed by engagement within the persistence window. Productive (resolved)
  // confusion is not counted.
  let unresolved = 0;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (r.state !== 'confusion' || r.end - r.start < minWins) continue;
    let resolved = false;
    for (let j = i + 1; j < runs.length && runs[j].start - r.end <= minWins; j++) {
      if (runs[j].state === 'engagement') {
        resolved = true;
        break;
      }
    }
    if (!resolved) unresolved++;
  }
  return { pctByState, transitions, unresolvedConfusionEpisodes: unresolved };
}

export async function computeAffect(
  sessionId: string,
  opts: AffectOpts = DEFAULT_AFFECT_OPTS,
  activityWindows?: ActivityWindow[],
): Promise<AffectResult | null> {
  const binMs = opts.binMs ?? 1000;
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return null;
  const base = session.baseWallClockMs;
  const nWin = Math.max(1, Math.ceil(session.durationMs / binMs));
  const winOf = (wallMs: number) => Math.floor((wallMs - base) / binMs);

  const [auRows, emoRows, pupilRows, gazeRows] = await Promise.all([
    prisma.auResult.findMany({
      where: { sessionId },
      orderBy: { wallMs: 'asc' },
      select: { wallMs: true, aus: true, faceConf: true },
    }),
    prisma.emotionFrame.findMany({
      where: { sessionId },
      orderBy: { wallMs: 'asc' },
      select: {
        wallMs: true,
        faceDetected: true,
        pHappiness: true,
        pSadness: true,
        pSurprise: true,
        pFear: true,
        pAnger: true,
        pDisgust: true,
        pContempt: true,
        pNeutral: true,
      },
    }),
    prisma.pupilSample.findMany({
      where: { sessionId },
      orderBy: { wallMs: 'asc' },
      select: { wallMs: true, diameter: true },
    }),
    prisma.gazeSample.findMany({
      where: { sessionId },
      orderBy: { wallMs: 'asc' },
      select: { wallMs: true, x: true, y: true },
    }),
  ]);

  // need the activity layer for the Wickens channel
  const acts = activityWindows ?? (await classifyActivity(sessionId, { binMs }))?.windows ?? [];
  const actByWin = new Map<number, ActivityWindow>();
  for (const a of acts) actByWin.set(Math.floor(a.tMs / binMs), a);

  // ── per-window aggregation ──
  type Agg = {
    au: Record<string, number>;
    auN: number;
    emo: Record<string, number>;
    emoN: number;
    pupil: number;
    pupilN: number;
    gx: number[];
    gy: number[];
  };
  const W: Agg[] = Array.from({ length: nWin }, () => ({
    au: {},
    auN: 0,
    emo: {},
    emoN: 0,
    pupil: 0,
    pupilN: 0,
    gx: [],
    gy: [],
  }));

  for (const r of auRows) {
    const w = winOf(r.wallMs);
    if (w < 0 || w >= nWin) continue;
    const au = parseJson<Record<string, number>>(r.aus, {});
    for (const [k, v] of Object.entries(au))
      W[w].au[k] = (W[w].au[k] ?? 0) + (typeof v === 'number' ? v : 0);
    W[w].auN += 1;
  }
  const EMO_KEYS = [
    'pHappiness',
    'pSadness',
    'pSurprise',
    'pFear',
    'pAnger',
    'pDisgust',
    'pContempt',
    'pNeutral',
  ] as const;
  for (const r of emoRows) {
    const w = winOf(r.wallMs);
    if (w < 0 || w >= nWin || !r.faceDetected) continue;
    for (const k of EMO_KEYS) W[w].emo[k] = (W[w].emo[k] ?? 0) + ((r as any)[k] ?? 0);
    W[w].emoN += 1;
  }
  for (const r of pupilRows) {
    const w = winOf(r.wallMs);
    if (w < 0 || w >= nWin) continue;
    W[w].pupil += r.diameter;
    W[w].pupilN += 1;
  }
  for (const r of gazeRows) {
    const w = winOf(r.wallMs);
    if (w < 0 || w >= nWin) continue;
    W[w].gx.push(r.x);
    W[w].gy.push(r.y);
  }

  // means per window
  for (const w of W) {
    if (w.auN) for (const k of Object.keys(w.au)) w.au[k] /= w.auN;
    if (w.emoN) for (const k of Object.keys(w.emo)) w.emo[k] /= w.emoN;
    if (w.pupilN) w.pupil /= w.pupilN;
  }

  // ── person baseline (per session) ──
  const baselineAu: Record<string, number> = {};
  if (opts.personBaseline) {
    const sums: Record<string, number> = {};
    const cnts: Record<string, number> = {};
    for (const w of W)
      if (w.auN)
        for (const [k, v] of Object.entries(w.au)) {
          sums[k] = (sums[k] ?? 0) + v;
          cnts[k] = (cnts[k] ?? 0) + 1;
        }
    for (const k of Object.keys(sums)) baselineAu[k] = sums[k] / Math.max(1, cnts[k]);
  }
  const pupilVals = W.filter((w) => w.pupilN).map((w) => w.pupil);
  const pupilBaseline = pupilVals.length
    ? pupilVals.reduce((s, x) => s + x, 0) / pupilVals.length
    : 0;

  const gazeStableOf = (w: Agg): boolean => {
    if (w.gx.length < 3) return false;
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    const std = (a: number[]) => {
      const m = mean(a);
      return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
    };
    return std(w.gx) < 250 && std(w.gy) < 250; // tight dispersion ≈ fixating
  };

  // ── per-window posteriors per channel ──
  const auSeqPost: (Record<AffectState, number> | null)[] = [];
  const emoSeqPost: (Record<AffectState, number> | null)[] = [];
  const wickSeqPost: Record<AffectState, number>[] = [];
  for (let i = 0; i < nWin; i++) {
    const w = W[i];
    const gazeStable = gazeStableOf(w);
    const pupilElevated = w.pupilN > 0 && w.pupil > pupilBaseline;
    const arousal =
      w.pupilN > 0 && pupilBaseline > 0
        ? clamp01(w.pupil / pupilBaseline - 0.5)
        : gazeStable
          ? 0.6
          : 0.4;

    if (w.auN > 0) {
      const corrected: Record<string, number> = {};
      for (const [k, v] of Object.entries(w.au))
        corrected[k] = opts.personBaseline ? v - (baselineAu[k] ?? 0) : v;
      auSeqPost.push(auPosterior(corrected, gazeStable));
    } else auSeqPost.push(null);

    emoSeqPost.push(w.emoN > 0 ? emotionPosterior(w.emo, arousal) : null);
    wickSeqPost.push(wickensPosterior(actByWin.get(i), pupilElevated));
  }

  // ── build per-method sequences ──
  const byMethod: Partial<Record<AffectMethod, AffectMethodResult>> = {};
  const toSeq = (posts: (Record<AffectState, number> | null)[]) =>
    posts.map((p) => (p ? dominant(p, opts.activationThreshold) : ('neutral' as AffectState)));

  for (const m of opts.methods) {
    if (m === 'au_mapping') byMethod[m] = rollup(toSeq(auSeqPost), binMs, opts.persistenceWindowMs);
    else if (m === 'openface_emotion')
      byMethod[m] = rollup(toSeq(emoSeqPost), binMs, opts.persistenceWindowMs);
    else if (m === 'wickens')
      byMethod[m] = rollup(toSeq(wickSeqPost), binMs, opts.persistenceWindowMs);
    else if (m === 'fused') {
      const fw = AFFECT_CONFIG.fusionWeights;
      const seq = wickSeqPost.map((wick, i) => {
        const fused = fuse([
          { w: auSeqPost[i] ? fw.au_mapping : 0, p: auSeqPost[i] ?? zero() },
          { w: emoSeqPost[i] ? fw.openface_emotion : 0, p: emoSeqPost[i] ?? zero() },
          { w: fw.wickens, p: wick },
        ]);
        return dominant(fused, opts.activationThreshold);
      });
      byMethod[m] = rollup(seq, binMs, opts.persistenceWindowMs);
    }
  }

  // optional per-window fused machine guess (timeline pre-fill source)
  let windowStates: AffectResult['windowStates'];
  if (opts.emitWindows) {
    const fw = AFFECT_CONFIG.fusionWeights;
    const fusedSeq = wickSeqPost.map((wick, i) =>
      dominant(
        fuse([
          { w: auSeqPost[i] ? fw.au_mapping : 0, p: auSeqPost[i] ?? zero() },
          { w: emoSeqPost[i] ? fw.openface_emotion : 0, p: emoSeqPost[i] ?? zero() },
          { w: fw.wickens, p: wick },
        ]),
        opts.activationThreshold,
      ),
    );
    const minWins = Math.max(1, Math.round(opts.persistenceWindowMs / binMs));
    windowStates = smooth(fusedSeq, minWins).map((state, i) => ({ tMs: i * binMs, fused: state }));
  }

  return {
    configVersion: AFFECT_CONFIG.version,
    binMs,
    opts,
    byMethod,
    framesSeen: {
      au: auRows.length,
      emotion: emoRows.filter((e) => e.faceDetected).length,
      pupil: pupilRows.length,
    },
    windowStates,
  };
}
