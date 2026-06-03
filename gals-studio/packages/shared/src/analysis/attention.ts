/**
 * Attention / SEEV analysis: per-AOI percentage dwell time (PDT), epoch
 * segmentation, and the allocation_score (total-variation distance between
 * observed PDT and an expected attention-weight vector).
 *
 * Nested-region resolution: when a gaze point falls inside multiple AOIs, the
 * SMALLER (by area) rectangle wins (matches the replay coverage panel).
 */

export interface Aoi {
  region: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GazePoint {
  wallMs: number;
  x: number;
  y: number;
  confidence?: number | null;
}

export interface SnapshotAoiState {
  wallMs: number;
  aois: Aoi[] | null;
}

/** Resolve which AOI a point falls in; smaller-area rectangle wins when nested. */
export function resolveAoi(x: number, y: number, aois: Aoi[]): string | null {
  let best: Aoi | null = null;
  let bestArea = Infinity;
  for (const a of aois) {
    if (x >= a.x && x <= a.x + a.width && y >= a.y && y <= a.y + a.height) {
      const area = a.width * a.height;
      if (area < bestArea) { bestArea = area; best = a; }
    }
  }
  return best?.region ?? null;
}

export interface PdtResult {
  /** ms of dwell per region. */
  dwellMs: Record<string, number>;
  /** fraction of on-AOI dwell per region (sums to ~1 across regions). */
  pdt: Record<string, number>;
  totalGaze: number;
  onAoiGaze: number;
}

/**
 * Percentage dwell time per AOI region via a single linear two-pointer pass
 * over time-sorted gaze samples + snapshots (each gaze attributed to its
 * nearest preceding snapshot's AOIs).
 */
export function computePdt(
  gaze: GazePoint[],
  snapshots: SnapshotAoiState[],
  opts: { minConfidence?: number } = {},
): PdtResult {
  const minConf = opts.minConfidence ?? 0;
  const g = [...gaze].sort((a, b) => a.wallMs - b.wallMs);
  const s = [...snapshots].sort((a, b) => a.wallMs - b.wallMs);
  const dwellMs: Record<string, number> = {};
  let snapPtr = 0;
  let onAoi = 0;
  let total = 0;

  for (let i = 0; i < g.length; i++) {
    const pt = g[i];
    if ((pt.confidence ?? 1) < minConf) continue;
    // advance snapshot pointer to the last snapshot with wallMs <= pt.wallMs
    while (snapPtr + 1 < s.length && s[snapPtr + 1].wallMs <= pt.wallMs) snapPtr++;
    const aois = s[snapPtr]?.aois ?? null;
    // weight by the gap to the next gaze sample (dwell time this sample covers)
    const next = g[i + 1];
    const weight = next ? Math.max(0, next.wallMs - pt.wallMs) : 0;
    total += weight;
    if (aois && aois.length) {
      const region = resolveAoi(pt.x, pt.y, aois);
      if (region) {
        dwellMs[region] = (dwellMs[region] ?? 0) + weight;
        onAoi += weight;
      }
    }
  }
  const pdt: Record<string, number> = {};
  for (const [r, ms] of Object.entries(dwellMs)) pdt[r] = onAoi ? ms / onAoi : 0;
  return { dwellMs, pdt, totalGaze: total, onAoiGaze: onAoi };
}

/**
 * allocation_score = total-variation distance between observed PDT and an
 * expected attention-weight vector. 0 when identical, 1 when fully disjoint.
 * TV distance = 0.5 * sum |observed_i - expected_i| over the union of regions.
 */
export function allocationScore(
  observed: Record<string, number>,
  expected: Record<string, number>,
): number {
  const regions = new Set([...Object.keys(observed), ...Object.keys(expected)]);
  // normalize each distribution to sum 1 (guard against unnormalized input)
  const norm = (d: Record<string, number>): Record<string, number> => {
    const sum = Object.values(d).reduce((a, b) => a + b, 0);
    if (sum === 0) return d;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(d)) out[k] = v / sum;
    return out;
  };
  const o = norm(observed);
  const e = norm(expected);
  let tv = 0;
  for (const r of regions) tv += Math.abs((o[r] ?? 0) - (e[r] ?? 0));
  return 0.5 * tv;
}

export const DEFAULT_EXPECTED_WEIGHTS: Record<string, Record<string, number>> = {
  reading_lesson: { lesson: 0.7, 'pdf-viewer': 0.2, sidebar: 0.05, chatbot: 0.05 },
  chatbot_dialogue: { chatbot: 0.6, lesson: 0.3, sidebar: 0.1 },
  intervention_active: { lesson: 0.5, chatbot: 0.3, sidebar: 0.2 },
  navigating_modules: { sidebar: 0.6, lesson: 0.3, header: 0.1 },
  idle: { lesson: 0.4, sidebar: 0.3, chatbot: 0.3 },
};

export type EpochType =
  | 'reading_lesson'
  | 'intervention_active'
  | 'chatbot_dialogue'
  | 'navigating_modules'
  | 'idle';

export interface ActivitySignal {
  wallMs: number;
  action: string;
  interventionId?: string | null;
}

export interface VisibilitySpan {
  wallMs: number;
  visibleState: string;
  hiddenDurationMs?: number | null;
}

export interface Epoch {
  type: EpochType;
  startWallMs: number;
  endWallMs: number;
}

/**
 * Epoch segmentation from activity + visibility signals. Rule set (thresholds
 * are params): an intervention start opens an `intervention_active` epoch until
 * its completion/next nav; chatbot turns open `chatbot_dialogue`; module nav
 * opens `navigating_modules`; long visibility-hidden or no-activity gaps open
 * `idle`; otherwise `reading_lesson`.
 */
export function segmentEpochs(
  activity: ActivitySignal[],
  bounds: { startWallMs: number; endWallMs: number },
  opts: { idleGapMs?: number } = {},
): Epoch[] {
  const idleGapMs = opts.idleGapMs ?? 60_000;
  const acts = [...activity].sort((a, b) => a.wallMs - b.wallMs);
  const points: { wallMs: number; type: EpochType }[] = [];

  const classify = (action: string): EpochType => {
    const a = action.toUpperCase();
    if (a.includes('INTERVENTION')) return 'intervention_active';
    if (a.includes('CHAT') || a.includes('DIALOGUE') || a.includes('MESSAGE')) return 'chatbot_dialogue';
    if (a.includes('MODULE') || a.includes('NAVIGATE') || a.includes('PAGE')) return 'navigating_modules';
    return 'reading_lesson';
  };

  for (const ev of acts) points.push({ wallMs: ev.wallMs, type: classify(ev.action) });

  const epochs: Epoch[] = [];
  if (points.length === 0) {
    epochs.push({ type: 'reading_lesson', startWallMs: bounds.startWallMs, endWallMs: bounds.endWallMs });
    return epochs;
  }
  let curType = points[0].type;
  let curStart = bounds.startWallMs;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const nextWall = i + 1 < points.length ? points[i + 1].wallMs : bounds.endWallMs;
    // idle gap detection
    if (nextWall - p.wallMs > idleGapMs) {
      if (p.type !== curType) {
        epochs.push({ type: curType, startWallMs: curStart, endWallMs: p.wallMs });
        curType = p.type;
        curStart = p.wallMs;
      }
      epochs.push({ type: curType, startWallMs: curStart, endWallMs: p.wallMs });
      epochs.push({ type: 'idle', startWallMs: p.wallMs, endWallMs: nextWall });
      curType = i + 1 < points.length ? points[i + 1].type : 'reading_lesson';
      curStart = nextWall;
      continue;
    }
    if (p.type !== curType) {
      epochs.push({ type: curType, startWallMs: curStart, endWallMs: p.wallMs });
      curType = p.type;
      curStart = p.wallMs;
    }
  }
  epochs.push({ type: curType, startWallMs: curStart, endWallMs: bounds.endWallMs });
  return epochs.filter((e) => e.endWallMs > e.startWallMs);
}

/** Gaze on-screen % across session quartiles (a sustained-attention proxy). */
export function gazeOnScreenByQuartile(
  gaze: GazePoint[],
  viewport: { width: number; height: number },
  bounds: { startWallMs: number; durationMs: number },
): number[] {
  const q = [0, 0, 0, 0];
  const qn = [0, 0, 0, 0];
  for (const pt of gaze) {
    const rel = pt.wallMs - bounds.startWallMs;
    if (rel < 0 || bounds.durationMs <= 0) continue;
    const qi = Math.min(3, Math.floor((rel / bounds.durationMs) * 4));
    qn[qi] += 1;
    const onScreen = pt.x >= 0 && pt.y >= 0 && pt.x <= viewport.width && pt.y <= viewport.height;
    if (onScreen) q[qi] += 1;
  }
  return q.map((on, i) => (qn[i] ? on / qn[i] : 0));
}
