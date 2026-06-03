/**
 * AOI attention scoring per the spec at `05_feature_aoi_scoring.md`.
 *
 * Single-pass compute kernel that produces:
 *   - per-AOI Percentage Dwell Time (PDT) over a *valid-study* mask
 *   - per-epoch observed-vs-expected PDT and an alignment score
 *   - a data-hygiene readout (how much gaze time was dropped and why)
 *
 * Reuses the existing two-pointer gaze × snapshot pattern (smaller-rect
 * wins when nested). Pure functions — no React, easy to unit-test.
 */

import type {
  SessionReplayActivityLog,
  SessionReplayAoiRect,
  SessionReplayGazeLog,
  SessionReplaySnapshot,
  SessionReplayVisibilityLog,
} from '../hooks/useSessionReplay';

// ───── Public types ──────────────────────────────────────

export type AoiRegion =
  | 'sidebar'
  | 'lesson'
  | 'pdf-viewer'
  | 'chatbot'
  | 'header';

export const KNOWN_AOI_REGIONS: AoiRegion[] = [
  'sidebar',
  'lesson',
  'pdf-viewer',
  'chatbot',
  'header',
];

/**
 * Roll-up bucket for the per-AOI table. We report both granular
 * (`lesson` and `pdf-viewer` separate) and a combined `lesson+pdf`
 * bucket so researchers can use whichever fits their analysis.
 * `outside` catches valid gaze that didn't land in any region.
 */
export type AoiBucket = AoiRegion | 'lesson+pdf' | 'outside';

export interface ValidStudyMaskParams {
  /** Drop gaze samples whose webgazer confidence is below this. */
  confidenceFloor: number;
  /** ms window around route/click transitions where AOI rects may be stale. */
  transitionSettleMs: number;
  /** Gaps in the gaze stream longer than this count as "idle" → excluded. */
  idleGapMs: number;
  /** Optional explicit time slice (ms offsets from baseWallClockMs). */
  windowStartMs?: number;
  windowEndMs?: number;
}

export const DEFAULT_VALID_STUDY_PARAMS: ValidStudyMaskParams = {
  confidenceFloor: 0.5,
  transitionSettleMs: 750,
  idleGapMs: 10_000,
};

export type EpochType =
  | 'reading_lesson'
  | 'intervention_active'
  | 'chatbot_dialogue'
  | 'navigating_modules'
  | 'idle';

export const EPOCH_TYPES: EpochType[] = [
  'reading_lesson',
  'intervention_active',
  'chatbot_dialogue',
  'navigating_modules',
  'idle',
];

/**
 * Researcher-editable expected attention weights per epoch type.
 * Ordinal weights (0/1/2/3) get normalized to sum 1 per row at compute
 * time — matches the SEEV/EV literature's ordinal-ranking convention.
 * `navigating_modules` and `idle` are excluded from the mask so their
 * weights don't influence the score, but we keep them in the table for
 * UI symmetry.
 */
export interface ExpectedWeightTable {
  [epoch: string]: { [bucket: string]: number };
}

export const DEFAULT_EXPECTED_WEIGHTS: ExpectedWeightTable = {
  reading_lesson: {
    sidebar: 1,
    'lesson+pdf': 3,
    chatbot: 1,
    header: 0,
  },
  intervention_active: {
    sidebar: 0,
    'lesson+pdf': 1,
    chatbot: 3,
    header: 0,
  },
  chatbot_dialogue: {
    sidebar: 0,
    'lesson+pdf': 1,
    chatbot: 3,
    header: 0,
  },
  navigating_modules: {
    // Excluded from scoring; weights are placeholders.
    sidebar: 3,
    'lesson+pdf': 1,
    chatbot: 0,
    header: 0,
  },
  idle: {
    sidebar: 0,
    'lesson+pdf': 0,
    chatbot: 0,
    header: 0,
  },
};

/** Buckets that participate in the expected-vs-observed comparison. */
const SCORED_BUCKETS: AoiBucket[] = ['sidebar', 'lesson+pdf', 'chatbot', 'header'];

export interface DataHygieneReadout {
  totalGazeSamples: number;
  validGazeSamples: number;
  excludedByConfidence: number;
  excludedByVisibility: number;
  excludedByTransitionSettle: number;
  excludedByIdle: number;
  excludedByOutsideWindow: number;
  /** Approx wall-clock seconds of valid study time. */
  validStudyDurationSecs: number;
}

export interface PerBucketMetrics {
  bucket: AoiBucket;
  samples: number;
  /** Percentage Dwell Time = samples in bucket / total valid samples. */
  pdt: number;
}

export interface EpochSegment {
  type: EpochType;
  startMs: number; // absolute wall clock
  endMs: number; // absolute wall clock
}

export interface EpochScore {
  type: EpochType;
  startMs: number;
  endMs: number;
  durationMs: number;
  validSamples: number;
  observed: Record<AoiBucket, number>; // PDT shares, sum ~1 over SCORED + outside
  expected: Record<AoiBucket, number>; // normalized, sum 1 over SCORED
  /**
   * `alignment = 1 − ½·Σ |observed_share − expected_share|` over
   * SCORED_BUCKETS. Range [0, 1]; 1 = perfect alignment.
   * Returns null when the epoch is excluded from scoring (idle / nav)
   * or has zero valid samples.
   */
  alignment: number | null;
}

export interface AoiScoringResult {
  hygiene: DataHygieneReadout;
  metrics: PerBucketMetrics[];
  epochs: EpochScore[];
  /** Duration-weighted mean of `epoch.alignment` over scored epochs. */
  sessionAlignment: number | null;
}

// ───── Helpers ───────────────────────────────────────────

function isScoredEpoch(type: EpochType): boolean {
  return type !== 'idle' && type !== 'navigating_modules';
}

function pickBucketForGaze(
  gazeX: number,
  gazeY: number,
  aois: SessionReplayAoiRect[] | null | undefined,
): { region: AoiRegion | null; bucket: AoiBucket } {
  if (!aois || aois.length === 0) {
    return { region: null, bucket: 'outside' };
  }
  // Smaller-area rect wins when nested (e.g. pdf-viewer ⊂ lesson).
  const sorted = [...aois].sort((a, b) => a.width * a.height - b.width * b.height);
  for (const r of sorted) {
    if (
      gazeX >= r.x &&
      gazeX < r.x + r.width &&
      gazeY >= r.y &&
      gazeY < r.y + r.height
    ) {
      const region = r.region as AoiRegion;
      const bucket: AoiBucket =
        region === 'lesson' || region === 'pdf-viewer' ? 'lesson+pdf' : region;
      // Caller may want the raw region too (for granular reporting).
      return { region, bucket };
    }
  }
  return { region: null, bucket: 'outside' };
}

/**
 * Build transition intervals from snapshots (URL change = navigation)
 * and click events on the module sidebar. Each interval is
 * `[clickMs, clickMs + settleMs]` and gaze inside is excluded.
 */
function buildTransitionIntervals(
  snapshots: SessionReplaySnapshot[],
  activityLogs: SessionReplayActivityLog[],
  settleMs: number,
): Array<[number, number]> {
  const intervals: Array<[number, number]> = [];

  // URL changes between consecutive snapshots
  for (let i = 1; i < snapshots.length; i++) {
    if (snapshots[i]!.pageUrl !== snapshots[i - 1]!.pageUrl) {
      const t = snapshots[i]!.capturedAt;
      intervals.push([t, t + settleMs]);
    }
  }

  // MODULE_OPENED + MODULE_ITEM_VIEWED activity events
  for (const log of activityLogs) {
    if (log.action === 'MODULE_OPENED' || log.action === 'MODULE_ITEM_VIEWED') {
      const t = new Date(log.occurredAt).getTime();
      intervals.push([t, t + settleMs]);
    }
  }

  // Merge overlapping intervals so the per-sample check stays O(log n).
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const iv of intervals) {
    if (merged.length === 0 || iv[0] > merged[merged.length - 1]![1]) {
      merged.push([iv[0], iv[1]]);
    } else {
      merged[merged.length - 1]![1] = Math.max(merged[merged.length - 1]![1], iv[1]);
    }
  }
  return merged;
}

function isInsideMerged(intervals: Array<[number, number]>, t: number): boolean {
  // Binary search for first interval whose end >= t.
  let lo = 0;
  let hi = intervals.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (intervals[mid]![1] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo < intervals.length && intervals[lo]![0] <= t;
}

/**
 * Build "tab hidden" intervals from `visibility_logs`. A row with
 * `visibleState` ∈ {hidden, blurred} opens an interval; the next row
 * (or end-of-session) closes it.
 */
function buildHiddenIntervals(
  visibilityLogs: SessionReplayVisibilityLog[],
  rangeEndMs: number,
): Array<[number, number]> {
  const intervals: Array<[number, number]> = [];
  const sorted = [...visibilityLogs].sort((a, b) => a.timestamp - b.timestamp);
  let hiddenSince: number | null = null;
  for (const log of sorted) {
    const isHidden = log.visibleState === 'hidden' || log.visibleState === 'blurred';
    if (isHidden && hiddenSince == null) {
      hiddenSince = log.timestamp;
    } else if (!isHidden && hiddenSince != null) {
      intervals.push([hiddenSince, log.timestamp]);
      hiddenSince = null;
    }
  }
  if (hiddenSince != null) intervals.push([hiddenSince, rangeEndMs]);
  return intervals;
}

/**
 * Segment the session's valid time into activity epochs. Walks the
 * activity log forward, opening an epoch at each marker and closing
 * it at the next marker (or session end). Idle / navigating_modules
 * epochs are included so the timeline is complete; the alignment
 * pass simply skips them.
 *
 * Epoch type chosen by:
 *  - INTERVENTION_TRIGGERED / VIEWED / CHATBOT_MESSAGE_SENT during an
 *    intervention id → intervention_active
 *  - CHATBOT_MESSAGE_SENT outside intervention → chatbot_dialogue
 *  - MODULE_ITEM_VIEWED / MODULE_OPENED → reading_lesson (after the
 *    transition settle window has passed; the settle window itself
 *    falls under navigating_modules)
 *  - long gaps in any activity → idle
 */
export function segmentEpochs(
  activityLogs: SessionReplayActivityLog[],
  sessionStartMs: number,
  sessionEndMs: number,
  idleGapMs: number,
  transitionSettleMs: number,
): EpochSegment[] {
  const epochs: EpochSegment[] = [];
  // Sort the markers we care about.
  const markers = [...activityLogs]
    .filter((log) => {
      return [
        'SESSION_START',
        'SESSION_END',
        'MODULE_OPENED',
        'MODULE_ITEM_VIEWED',
        'INTERVENTION_TRIGGERED',
        'INTERVENTION_VIEWED',
        'INTERVENTION_COMPLETED',
        'INTERVENTION_DISMISSED',
        'CHATBOT_MESSAGE_SENT',
        'CHATBOT_MESSAGE_RECEIVED',
        'DIALOGUE_MESSAGE_SENT',
        'DIALOGUE_MESSAGE_RECEIVED',
      ].includes(log.action);
    })
    .map((log) => ({
      t: new Date(log.occurredAt).getTime(),
      action: log.action,
      interventionId: log.interventionId ?? null,
    }))
    .sort((a, b) => a.t - b.t);

  let cur: { type: EpochType; start: number } = {
    type: 'reading_lesson',
    start: sessionStartMs,
  };

  const push = (endMs: number, nextType: EpochType, nextStart: number) => {
    if (endMs > cur.start) {
      epochs.push({ type: cur.type, startMs: cur.start, endMs });
    }
    cur = { type: nextType, start: nextStart };
  };

  for (let i = 0; i < markers.length; i++) {
    const m = markers[i]!;
    // Idle gap: if the previous marker ended long ago, close current
    // epoch, drop in an idle segment, then resume.
    const prevT = i === 0 ? sessionStartMs : markers[i - 1]!.t;
    if (m.t - prevT > idleGapMs) {
      push(prevT + 1, 'idle', prevT + 1);
      push(m.t, 'reading_lesson', m.t);
    }

    if (
      m.action === 'INTERVENTION_TRIGGERED' ||
      m.action === 'INTERVENTION_VIEWED'
    ) {
      push(m.t, 'intervention_active', m.t);
    } else if (
      m.action === 'INTERVENTION_COMPLETED' ||
      m.action === 'INTERVENTION_DISMISSED'
    ) {
      push(m.t, 'reading_lesson', m.t);
    } else if (
      (m.action === 'CHATBOT_MESSAGE_SENT' ||
        m.action === 'CHATBOT_MESSAGE_RECEIVED' ||
        m.action === 'DIALOGUE_MESSAGE_SENT' ||
        m.action === 'DIALOGUE_MESSAGE_RECEIVED') &&
      cur.type !== 'intervention_active'
    ) {
      // Brief chatbot-dialogue epoch around the turn; window arbitrary
      // but bounded — we'll close it back to reading on the next
      // non-chat marker or after a short timeout.
      if (cur.type !== 'chatbot_dialogue') {
        push(m.t, 'chatbot_dialogue', m.t);
      }
    } else if (
      m.action === 'MODULE_OPENED' ||
      m.action === 'MODULE_ITEM_VIEWED'
    ) {
      push(m.t, 'navigating_modules', m.t);
      push(m.t + transitionSettleMs, 'reading_lesson', m.t + transitionSettleMs);
    } else if (m.action === 'SESSION_START') {
      push(m.t, 'reading_lesson', m.t);
    } else if (m.action === 'SESSION_END') {
      push(m.t, 'idle', m.t);
    }
  }
  // Close the trailing epoch.
  if (sessionEndMs > cur.start) {
    epochs.push({ type: cur.type, startMs: cur.start, endMs: sessionEndMs });
  }
  // Merge consecutive same-type epochs.
  const merged: EpochSegment[] = [];
  for (const e of epochs) {
    const last = merged[merged.length - 1];
    if (last && last.type === e.type && Math.abs(last.endMs - e.startMs) < 2) {
      last.endMs = e.endMs;
    } else {
      merged.push({ ...e });
    }
  }
  return merged;
}

// ───── Main compute ──────────────────────────────────────

export interface AoiScoringInput {
  baseWallClockMs: number;
  durationMs: number;
  snapshots: SessionReplaySnapshot[];
  gazeLogs: SessionReplayGazeLog[];
  visibilityLogs: SessionReplayVisibilityLog[];
  activityLogs: SessionReplayActivityLog[];
  params?: Partial<ValidStudyMaskParams>;
  expectedWeights?: ExpectedWeightTable;
}

export function computeAoiScoring(input: AoiScoringInput): AoiScoringResult {
  const params: ValidStudyMaskParams = {
    ...DEFAULT_VALID_STUDY_PARAMS,
    ...(input.params ?? {}),
  };
  const expectedWeights = input.expectedWeights ?? DEFAULT_EXPECTED_WEIGHTS;

  const windowStartAbs =
    input.baseWallClockMs + (params.windowStartMs ?? 0);
  const windowEndAbs =
    input.baseWallClockMs + (params.windowEndMs ?? input.durationMs);

  // Pre-sort streams once.
  const gaze = [...input.gazeLogs]
    .map((g) => ({ ...g, _ms: new Date(g.timestamp).getTime() }))
    .sort((a, b) => a._ms - b._ms);
  const snapshots = [...input.snapshots].sort(
    (a, b) => a.capturedAt - b.capturedAt,
  );

  // Build exclusion-interval indexes.
  const hiddenIntervals = buildHiddenIntervals(input.visibilityLogs, windowEndAbs);
  const transitionIntervals = buildTransitionIntervals(
    snapshots,
    input.activityLogs,
    params.transitionSettleMs,
  );
  const epochs = segmentEpochs(
    input.activityLogs,
    input.baseWallClockMs,
    input.baseWallClockMs + input.durationMs,
    params.idleGapMs,
    params.transitionSettleMs,
  );

  // Walk gaze + snapshots together (two-pointer). For each valid
  // sample, increment the per-epoch + per-bucket counters.
  const hygiene: DataHygieneReadout = {
    totalGazeSamples: gaze.length,
    validGazeSamples: 0,
    excludedByConfidence: 0,
    excludedByVisibility: 0,
    excludedByTransitionSettle: 0,
    excludedByIdle: 0,
    excludedByOutsideWindow: 0,
    validStudyDurationSecs: 0,
  };
  const overallByBucket: Record<AoiBucket, number> = {
    sidebar: 0,
    lesson: 0,
    'pdf-viewer': 0,
    chatbot: 0,
    header: 0,
    'lesson+pdf': 0,
    outside: 0,
  };
  // Per-epoch counters keyed by epoch-index.
  const epochCounters: Array<{
    samples: number;
    buckets: Record<AoiBucket, number>;
  }> = epochs.map(() => ({
    samples: 0,
    buckets: {
      sidebar: 0,
      lesson: 0,
      'pdf-viewer': 0,
      chatbot: 0,
      header: 0,
      'lesson+pdf': 0,
      outside: 0,
    },
  }));

  let snapIdx = 0;
  let epochIdx = 0;
  let validSpanStart: number | null = null;
  let validSpanLast: number | null = null;

  for (const g of gaze) {
    const t = g._ms;
    if (t < windowStartAbs || t > windowEndAbs) {
      hygiene.excludedByOutsideWindow += 1;
      continue;
    }
    if (g.confidence != null && g.confidence < params.confidenceFloor) {
      hygiene.excludedByConfidence += 1;
      continue;
    }
    if (isInsideMerged(hiddenIntervals, t)) {
      hygiene.excludedByVisibility += 1;
      continue;
    }
    if (isInsideMerged(transitionIntervals, t)) {
      hygiene.excludedByTransitionSettle += 1;
      continue;
    }
    // Idle is approximated by gap detection (already folded into the
    // epoch segmentation; we still exclude samples landing inside an
    // idle epoch from scoring).
    while (epochIdx + 1 < epochs.length && epochs[epochIdx + 1]!.startMs <= t) {
      epochIdx += 1;
    }
    const epoch = epochs[epochIdx];
    if (epoch && epoch.type === 'idle') {
      hygiene.excludedByIdle += 1;
      continue;
    }
    // Advance snapshot pointer to the nearest-snapshot ≤ t.
    while (
      snapIdx + 1 < snapshots.length &&
      snapshots[snapIdx + 1]!.capturedAt <= t
    ) {
      snapIdx += 1;
    }
    const snap = snapshots[snapIdx];
    const aois = (snap?.aois ?? null) as SessionReplayAoiRect[] | null;
    const { region, bucket } = pickBucketForGaze(g.gazeX, g.gazeY, aois);

    hygiene.validGazeSamples += 1;
    overallByBucket[bucket] += 1;
    if (region) overallByBucket[region] += 1;
    if (epochCounters[epochIdx]) {
      epochCounters[epochIdx]!.samples += 1;
      epochCounters[epochIdx]!.buckets[bucket] += 1;
      if (region) epochCounters[epochIdx]!.buckets[region] += 1;
    }
    // Track valid-time span (approximation: sum of consecutive valid
    // sample intervals). Good enough for the hygiene readout.
    if (validSpanStart == null) validSpanStart = t;
    if (validSpanLast != null && t - validSpanLast > params.idleGapMs) {
      hygiene.validStudyDurationSecs += (validSpanLast - validSpanStart) / 1000;
      validSpanStart = t;
    }
    validSpanLast = t;
  }
  if (validSpanStart != null && validSpanLast != null) {
    hygiene.validStudyDurationSecs += (validSpanLast - validSpanStart) / 1000;
  }

  // Build PDT metrics.
  const denom = Math.max(1, hygiene.validGazeSamples);
  const metrics: PerBucketMetrics[] = [
    'sidebar',
    'lesson',
    'pdf-viewer',
    'lesson+pdf',
    'chatbot',
    'header',
    'outside',
  ].map((b) => {
    const bucket = b as AoiBucket;
    return {
      bucket,
      samples: overallByBucket[bucket],
      pdt: overallByBucket[bucket] / denom,
    };
  });

  // Build epoch alignment scores.
  const epochScores: EpochScore[] = epochs.map((seg, idx) => {
    const counter = epochCounters[idx]!;
    const obsDenom = Math.max(1, counter.samples);
    const observed: Record<AoiBucket, number> = {
      sidebar: counter.buckets.sidebar / obsDenom,
      lesson: counter.buckets.lesson / obsDenom,
      'pdf-viewer': counter.buckets['pdf-viewer'] / obsDenom,
      chatbot: counter.buckets.chatbot / obsDenom,
      header: counter.buckets.header / obsDenom,
      'lesson+pdf': counter.buckets['lesson+pdf'] / obsDenom,
      outside: counter.buckets.outside / obsDenom,
    };
    // Expected weights → normalized shares for this epoch type.
    const rawWeights = expectedWeights[seg.type] ?? {};
    let weightSum = 0;
    for (const b of SCORED_BUCKETS) weightSum += rawWeights[b] ?? 0;
    const expected: Record<AoiBucket, number> = {
      sidebar: 0,
      lesson: 0,
      'pdf-viewer': 0,
      chatbot: 0,
      header: 0,
      'lesson+pdf': 0,
      outside: 0,
    };
    if (weightSum > 0) {
      for (const b of SCORED_BUCKETS) {
        expected[b] = (rawWeights[b] ?? 0) / weightSum;
      }
    }
    let alignment: number | null = null;
    if (isScoredEpoch(seg.type) && counter.samples > 0 && weightSum > 0) {
      // Total variation distance over SCORED_BUCKETS, then 1 − ½·sum.
      let absDiffSum = 0;
      for (const b of SCORED_BUCKETS) {
        absDiffSum += Math.abs(observed[b] - expected[b]);
      }
      alignment = 1 - 0.5 * absDiffSum;
    }
    return {
      type: seg.type,
      startMs: seg.startMs,
      endMs: seg.endMs,
      durationMs: seg.endMs - seg.startMs,
      validSamples: counter.samples,
      observed,
      expected,
      alignment,
    };
  });

  // Session-level alignment = duration-weighted mean of scored epochs.
  let weightedSum = 0;
  let weightTotal = 0;
  for (const e of epochScores) {
    if (e.alignment == null) continue;
    weightedSum += e.alignment * e.durationMs;
    weightTotal += e.durationMs;
  }
  const sessionAlignment = weightTotal > 0 ? weightedSum / weightTotal : null;

  return { hygiene, metrics, epochs: epochScores, sessionAlignment };
}
