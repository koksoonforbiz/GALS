/**
 * Wide-format CSV exporter for a session replay.
 *
 * Layout per the post-analysis ask:
 *   Row 1:  wall_clock_iso        UTC ISO   <t0>  <t1>  <t2>  ...
 *   Row 2:  relative_s            seconds   0     1     2     ...
 *   Row 3+: <signal>              <unit>    <v0>  <v1>  <v2>  ...
 *
 * Columns are uniform time bins (default 1 s). Time-aligned sampled
 * signals (emotion / AU / gaze / pupil) take the nearest sample inside
 * a ±1.5×binMs window; continuous-state signals (scrollY) carry
 * forward; sparse events (clicks, interventions, chatbot turns) drop
 * a value in the bin they occurred in and leave others blank.
 *
 * Text and value rows are deliberately separated so a post-analysis
 * pipeline can `pd.read_csv(...)` and skip / cast columns by metric
 * name without parsing mixed-type rows.
 *
 * Bin size and window are configurable via the `options` arg. Default
 * 1 s keeps a 4 h session under Excel's 16384-column limit; for higher
 * fidelity drop to 200 ms (matches py-feat's native cadence).
 */

import type {
  SessionReplayActivityLog,
  SessionReplayAoiRect,
  SessionReplayAuResult,
  SessionReplayChatbotMessage,
  SessionReplayClickLog,
  SessionReplayClipboardLog,
  SessionReplayCursorLog,
  SessionReplayDialogueMessage,
  SessionReplayEfDetection,
  SessionReplayEmotionFrame,
  SessionReplayGazeLog,
  SessionReplayKeystrokeLog,
  SessionReplayPupilLog,
  SessionReplayScrollHost,
  SessionReplayScrollLog,
  SessionReplaySnapshot,
  SessionReplayViewportLog,
  SessionReplayVisibilityLog,
} from '../hooks/useSessionReplay';

const AU_KEYS = [
  'au01', 'au02', 'au04', 'au05', 'au06', 'au07', 'au09', 'au10',
  'au12', 'au14', 'au15', 'au17', 'au20', 'au23', 'au24', 'au25', 'au26', 'au28',
] as const;
type AuKey = (typeof AU_KEYS)[number];

const EMOTION_FIELDS: ReadonlyArray<[keyof SessionReplayEmotionFrame, string]> = [
  ['pHappiness', 'p_happy'],
  ['pSadness', 'p_sad'],
  ['pSurprise', 'p_surprise'],
  ['pFear', 'p_fear'],
  ['pAnger', 'p_anger'],
  ['pDisgust', 'p_disgust'],
  ['pContempt', 'p_contempt'],
  ['pNeutral', 'p_neutral'],
];

/**
 * Affective-state thresholds. The exporter accepts a partial override
 * via `options.thresholds` so a teacher can export with whichever
 * thresholds they've dialled in on the Replay tab sliders. Defaults
 * match the Replay tab's hard-coded defaults.
 */
export interface AffectiveStateThresholds {
  engagement_score: number;
  boredom_score: number;
  confusion_surprise: number;
  confusion_fear: number;
  confusion_anger: number;
  confusion_disgust: number;
  frustration_sad: number;
  frustration_anger: number;
  frustration_disgust: number;
}

export const DEFAULT_THRESHOLDS: AffectiveStateThresholds = {
  engagement_score: 0.14,
  boredom_score: 0.2,
  confusion_surprise: 0.0,
  confusion_fear: 0.05,
  confusion_anger: 0.19,
  confusion_disgust: 0.0,
  frustration_sad: 0.2,
  frustration_anger: 0.25,
  frustration_disgust: 0.13,
};

const ACTIVITY_ACTIONS = [
  'SESSION_START',
  'SESSION_END',
  'MODULE_OPENED',
  'MODULE_ITEM_VIEWED',
  'INTERVENTION_TRIGGERED',
  'INTERVENTION_VIEWED',
  'INTERVENTION_COMPLETED',
  'INTERVENTION_DISMISSED',
  // P5 — Practice Testing configuration event row. Detail string
  // mirrors the timeline format; the structured fields land in
  // their own dedicated sparse rows below.
  'PRACTICE_TEST_CONFIGURED',
  'QUESTION_VIEWED',
  'QUESTION_ANSWERED',
  'ASSESSMENT_STARTED',
  'ASSESSMENT_SUBMITTED',
  'DIALOGUE_SESSION_STARTED',
  'DIALOGUE_SESSION_ENDED',
  'SPACED_REP_CARD_VIEWED',
  'SPACED_REP_CARD_RATED',
];

export interface CsvExportData {
  session: {
    id?: string;
    startedAt: string;
    endedAt?: string | null;
    userId?: string;
  } | null;
  snapshots: SessionReplaySnapshot[];
  clickLogs: SessionReplayClickLog[];
  scrollLogs: SessionReplayScrollLog[];
  gazeLogs: SessionReplayGazeLog[];
  pupilLogs: SessionReplayPupilLog[];
  emotionFrames: SessionReplayEmotionFrame[];
  auResults: SessionReplayAuResult[];
  activityLogs?: SessionReplayActivityLog[];
  efDetections?: SessionReplayEfDetection[];
  dialogueMessages?: SessionReplayDialogueMessage[];
  chatbotMessages?: SessionReplayChatbotMessage[];
  keystrokeLogs?: SessionReplayKeystrokeLog[];
  cursorLogs?: SessionReplayCursorLog[];
  clipboardLogs?: SessionReplayClipboardLog[];
  visibilityLogs?: SessionReplayVisibilityLog[];
  // Browser viewport size / orientation. Captured per session-init
  // + on every resize/orientation change. Surfaces as carry-forward
  // rows in the CSV so the consumer can correlate gaze coordinates
  // (which are in viewport-px) against the actual viewport at any
  // given bin. Pre-prompt-06 the field was fetched in the
  // getSessionReplayData fan-out but never reached the CSV — fixed
  // in this prompt.
  viewportLogs?: SessionReplayViewportLog[];
}

export interface CsvExportOptions {
  /** Width of each time bin in milliseconds. Default 1000. */
  binMs?: number;
  /** Window (×binMs) within which to pick the nearest sample. Default 1.5. */
  nearestWindowMultiplier?: number;
  /** Truncate long message bodies to this many characters. Default 500. */
  maxMessageChars?: number;
  /**
   * Affective-state thresholds. Used for both label classification
   * and the `score_*` / `flag_*` rows. Defaults to `DEFAULT_THRESHOLDS`.
   * Pass the teacher's current slider values to make the export
   * reflect what they see in the UI.
   */
  thresholds?: AffectiveStateThresholds;
  /**
   * Restrict the export to a sub-range of the session, in ms offsets
   * from `baseWallClockMs`. Defaults to [0, durationMs]. Useful when
   * a teacher only cares about the segment where an intervention
   * fired. Both are clamped to [0, durationMs].
   */
  startOffsetMs?: number;
  endOffsetMs?: number;
  /**
   * Optional precomputed AOI scoring result. When present, the
   * exporter emits time-aligned rows for per-AOI PDT (carry-forward
   * from the current epoch) plus active epoch type, observed/expected
   * shares per AOI, and per-epoch alignment. Reuses the same bin
   * grid the rest of the export uses so each column lines up.
   */
  aoiScoring?: AoiScoringForExport;
}

/**
 * Minimal shape the exporter needs from the AOI scoring kernel —
 * declared here to avoid pulling the full result type just for the
 * export call. Pass the result of `computeAoiScoring()` directly.
 */
export interface AoiScoringForExport {
  epochs: Array<{
    type: string;
    startMs: number;
    endMs: number;
    observed: Record<string, number>;
    expected: Record<string, number>;
    alignment: number | null;
  }>;
  sessionAlignment: number | null;
}

type Cell = string | number | null | undefined;

function csvEscape(value: Cell): string {
  if (value == null) return '';
  const str = typeof value === 'number' ? String(value) : value;
  if (str === '') return '';
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function numRound(value: number | null | undefined, digits = 4): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (Number.isInteger(value)) return value;
  const mul = 10 ** digits;
  return Math.round(value * mul) / mul;
}

/** Binary search nearest sample to `target` within `±windowMs`. */
function nearestWithinWindow<T>(
  samples: T[],
  getTime: (s: T) => number,
  target: number,
  windowMs: number,
): T | null {
  if (samples.length === 0) return null;
  let lo = 0;
  let hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (getTime(samples[mid]!) < target) lo = mid + 1;
    else hi = mid;
  }
  let best: T | null = null;
  let bestDelta = Infinity;
  if (lo > 0) {
    const d = Math.abs(getTime(samples[lo - 1]!) - target);
    if (d <= windowMs) {
      best = samples[lo - 1]!;
      bestDelta = d;
    }
  }
  if (lo < samples.length) {
    const d = Math.abs(getTime(samples[lo]!) - target);
    if (d <= windowMs && d < bestDelta) {
      best = samples[lo]!;
    }
  }
  return best;
}

interface AffectiveState {
  label: string;
  engagement: number;
  boredom: number;
  confusion: 0 | 1;
  frustration: 0 | 1;
}

function predictAffectiveState(
  frame: SessionReplayEmotionFrame,
  thresholds: AffectiveStateThresholds,
): AffectiveState {
  const n = frame.pNeutral ?? 0;
  const d = frame.pDisgust ?? 0;
  const h = frame.pHappiness ?? 0;
  const s = frame.pSadness ?? 0;
  const a = frame.pAnger ?? 0;
  const sp = frame.pSurprise ?? 0;
  const f = frame.pFear ?? 0;

  const engagement = 0.4 * h + 0.4 * n + 0.2 * sp;
  const boredom = 0.5 * n + 0.3 * s + 0.2 * d;
  const confusion: 0 | 1 =
    sp > thresholds.confusion_surprise &&
    f > thresholds.confusion_fear &&
    a > thresholds.confusion_anger &&
    d > thresholds.confusion_disgust
      ? 1
      : 0;
  const frustration: 0 | 1 =
    s > thresholds.frustration_sad ||
    a > thresholds.frustration_anger ||
    d > thresholds.frustration_disgust
      ? 1
      : 0;
  const isBoredom = boredom > thresholds.boredom_score ? 1 : 0;
  const isEngagement = engagement > thresholds.engagement_score ? 1 : 0;

  const labels: string[] = [];
  if (isBoredom) labels.push('boredom');
  if (isEngagement) labels.push('engagement');
  if (confusion) labels.push('confusion');
  if (frustration) labels.push('frustration');

  return {
    label: labels.length ? labels.join(',') : 'none',
    engagement,
    boredom,
    confusion,
    frustration,
  };
}

/**
 * Builds the wide-format CSV text. Returns a string ready to feed
 * into a Blob. Does NOT trigger a download — the caller is responsible
 * for that so this stays testable.
 */
export function exportReplayCsv(
  data: CsvExportData,
  baseWallClockMs: number,
  durationMs: number,
  options: CsvExportOptions = {},
): string {
  const binMs = Math.max(1, options.binMs ?? 1000);
  const windowMs = (options.nearestWindowMultiplier ?? 1.5) * binMs;
  const maxMessageChars = options.maxMessageChars ?? 500;
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;

  // Clamp the requested range to the session bounds. If the caller
  // passed a reversed pair (end < start), swap them so we never emit
  // a zero-bin file silently — the user's intent is usually clear.
  let startOffset = Math.max(0, Math.min(durationMs, options.startOffsetMs ?? 0));
  let endOffset = Math.max(0, Math.min(durationMs, options.endOffsetMs ?? durationMs));
  if (endOffset < startOffset) {
    [startOffset, endOffset] = [endOffset, startOffset];
  }
  const rangeMs = Math.max(binMs, endOffset - startOffset);
  const numBins = Math.max(1, Math.ceil(rangeMs / binMs));
  // Absolute ms at which bin 0 starts. All downstream lookups use
  // this — the session-relative offset is preserved in the CSV's
  // relative_s row.
  const rangeBaseWallMs = baseWallClockMs + startOffset;

  // Pre-sort and pre-stamp sampled streams. Adding `_ms` lets us
  // binary-search by number rather than re-parsing the ISO string per
  // bin (would make exports unbearably slow on long sessions).
  const emotionFrames = [...data.emotionFrames].sort((a, b) => a.frameWallMs - b.frameWallMs);
  const auResults = data.auResults
    .map((r) => ({ ...r, _ms: new Date(r.wallTime).getTime() }))
    .sort((a, b) => a._ms - b._ms);
  const gazeLogs = data.gazeLogs
    .map((g) => ({ ...g, _ms: new Date(g.timestamp).getTime() }))
    .sort((a, b) => a._ms - b._ms);
  const pupilLogs = data.pupilLogs
    .map((p) => ({ ...p, _ms: new Date(p.timestamp).getTime() }))
    .sort((a, b) => a._ms - b._ms);
  const scrollLogs = [...data.scrollLogs].sort((a, b) => a.timestamp - b.timestamp);
  const snapshots = [...data.snapshots].sort((a, b) => a.capturedAt - b.capturedAt);

  // Bin centers in absolute wall-clock ms — used for nearest-sample
  // lookups so the chosen sample is the one closest to the *middle*
  // of the bin rather than its leading edge.
  const binCenters: number[] = new Array(numBins);
  for (let i = 0; i < numBins; i++) binCenters[i] = rangeBaseWallMs + i * binMs + binMs / 2;

  // Maps an absolute wall-clock ms to its bin index. Returns -1 when
  // the event falls outside the requested range — caller filters
  // those out so we never write past the end of a values array.
  const binOfAbsoluteMs = (ms: number) => {
    const offset = ms - rangeBaseWallMs;
    if (offset < 0) return -1;
    const idx = Math.floor(offset / binMs);
    return idx >= numBins ? -1 : idx;
  };

  type Row = { metric: string; unit: string; values: Cell[] };
  const rows: Row[] = [];
  const addSampledRow = (
    metric: string,
    unit: string,
    fill: (binIndex: number, binCenter: number) => Cell,
  ) => {
    const values: Cell[] = new Array(numBins);
    for (let i = 0; i < numBins; i++) values[i] = fill(i, binCenters[i]!);
    rows.push({ metric, unit, values });
  };

  // ─── Emotion (label + 8 probabilities) ──────────────
  addSampledRow('emotion_dominant_label', 'string (py-feat)', (_i, c) => {
    const f = nearestWithinWindow(emotionFrames, (x) => x.frameWallMs, c, windowMs);
    return f?.dominantEmotion ?? '';
  });
  for (const [propKey, csvName] of EMOTION_FIELDS) {
    addSampledRow(csvName, 'probability 0-1', (_i, c) => {
      const f = nearestWithinWindow(emotionFrames, (x) => x.frameWallMs, c, windowMs);
      if (!f) return '';
      const v = f[propKey] as number | null | undefined;
      return numRound(v) ?? '';
    });
  }

  // ─── Affective state (label + scores + flags) ───────
  addSampledRow('affective_state_label', 'rule-based (default thresholds)', (_i, c) => {
    const f = nearestWithinWindow(emotionFrames, (x) => x.frameWallMs, c, windowMs);
    return f ? predictAffectiveState(f, thresholds).label : '';
  });
  addSampledRow('score_engagement', '0-1', (_i, c) => {
    const f = nearestWithinWindow(emotionFrames, (x) => x.frameWallMs, c, windowMs);
    return f ? numRound(predictAffectiveState(f, thresholds).engagement) ?? '' : '';
  });
  addSampledRow('score_boredom', '0-1', (_i, c) => {
    const f = nearestWithinWindow(emotionFrames, (x) => x.frameWallMs, c, windowMs);
    return f ? numRound(predictAffectiveState(f, thresholds).boredom) ?? '' : '';
  });
  addSampledRow('flag_confusion', '0 or 1', (_i, c) => {
    const f = nearestWithinWindow(emotionFrames, (x) => x.frameWallMs, c, windowMs);
    return f ? predictAffectiveState(f, thresholds).confusion : '';
  });
  addSampledRow('flag_frustration', '0 or 1', (_i, c) => {
    const f = nearestWithinWindow(emotionFrames, (x) => x.frameWallMs, c, windowMs);
    return f ? predictAffectiveState(f, thresholds).frustration : '';
  });

  // ─── Action Units (18 rows) ─────────────────────────
  for (const auKey of AU_KEYS) {
    addSampledRow(auKey, 'intensity (py-feat)', (_i, c) => {
      const r = nearestWithinWindow(auResults, (x) => x._ms, c, windowMs);
      if (!r) return '';
      const v = r[auKey as AuKey] as number | null | undefined;
      return numRound(v) ?? '';
    });
  }

  // ─── Gaze (x, y, confidence) ────────────────────────
  addSampledRow('gaze_x', 'viewport px', (_i, c) => {
    const g = nearestWithinWindow(gazeLogs, (x) => x._ms, c, windowMs);
    return g ? numRound(g.gazeX, 1) ?? '' : '';
  });
  addSampledRow('gaze_y', 'viewport px', (_i, c) => {
    const g = nearestWithinWindow(gazeLogs, (x) => x._ms, c, windowMs);
    return g ? numRound(g.gazeY, 1) ?? '' : '';
  });
  addSampledRow('gaze_confidence', '0-1', (_i, c) => {
    const g = nearestWithinWindow(gazeLogs, (x) => x._ms, c, windowMs);
    return g ? numRound(g.confidence) ?? '' : '';
  });

  // ─── Pupil ──────────────────────────────────────────
  addSampledRow('pupil_diameter', 'px', (_i, c) => {
    const p = nearestWithinWindow(pupilLogs, (x) => x._ms, c, windowMs);
    return p ? numRound(p.pupilDiameter, 3) ?? '' : '';
  });

  // ─── Scroll Y (carry-forward — last scroll <= bin center) ──
  // Seed `cur` with the most recent scroll value from BEFORE the
  // range so a mid-session export doesn't start at 0 when the
  // student is actually scrolled halfway down the page.
  {
    const values: Cell[] = new Array(numBins);
    let cur = 0;
    let idx = 0;
    while (idx < scrollLogs.length && scrollLogs[idx]!.timestamp < rangeBaseWallMs) {
      cur = scrollLogs[idx]!.scrollY;
      idx++;
    }
    for (let i = 0; i < numBins; i++) {
      const center = binCenters[i]!;
      while (idx < scrollLogs.length && scrollLogs[idx]!.timestamp <= center) {
        cur = scrollLogs[idx]!.scrollY;
        idx++;
      }
      values[i] = cur;
    }
    rows.push({ metric: 'scroll_y', unit: 'page px (carry-forward)', values });
  }

  // ─── Cursor trajectory (event — x, y per bin; last sample wins) ──
  {
    const xs: Cell[] = new Array(numBins).fill(null);
    const ys: Cell[] = new Array(numBins).fill(null);
    for (const c of data.cursorLogs ?? []) {
      const b = binOfAbsoluteMs(c.timestamp);
      if (b < 0) continue;
      xs[b] = c.x;
      ys[b] = c.y;
    }
    rows.push({ metric: 'cursor_x', unit: 'viewport px (event)', values: xs });
    rows.push({ metric: 'cursor_y', unit: 'viewport px (event)', values: ys });
  }

  // ─── Keystroke aggregates (per-field count, pause, WPM) ─────
  {
    const counts: Cell[] = new Array(numBins).fill(null);
    const pauses: Cell[] = new Array(numBins).fill(null);
    const wpms: Cell[] = new Array(numBins).fill(null);
    const fields: Cell[] = new Array(numBins).fill(null);
    for (const k of data.keystrokeLogs ?? []) {
      const b = binOfAbsoluteMs(k.timestamp);
      if (b < 0) continue;
      // Multiple keystroke batches in the same bin: sum counts /
      // pauses, take the latest WPM and field id. WPM averaging is
      // misleading so leave it to the consumer if they care.
      counts[b] = (typeof counts[b] === 'number' ? (counts[b] as number) : 0) + k.keystrokeCount;
      pauses[b] = (typeof pauses[b] === 'number' ? (pauses[b] as number) : 0) + k.pauseDurationMs;
      wpms[b] = numRound(k.typingSpeedWPM, 2) ?? '';
      fields[b] = k.fieldId;
    }
    rows.push({ metric: 'keystroke_count', unit: 'keys (event sum)', values: counts });
    rows.push({ metric: 'keystroke_pause_ms', unit: 'ms (event sum)', values: pauses });
    rows.push({ metric: 'keystroke_wpm', unit: 'WPM (latest)', values: wpms });
    rows.push({ metric: 'keystroke_field', unit: 'field id (latest)', values: fields });
  }

  // ─── Clipboard events ───────────────────────────────
  {
    const actions: Cell[] = new Array(numBins).fill(null);
    const lengths: Cell[] = new Array(numBins).fill(null);
    for (const c of data.clipboardLogs ?? []) {
      const b = binOfAbsoluteMs(c.timestamp);
      if (b < 0) continue;
      const existing = actions[b];
      actions[b] = existing ? `${existing} | ${c.action}` : c.action;
      lengths[b] = c.textLength;
    }
    rows.push({ metric: 'clipboard_action', unit: 'copy/cut/paste (event)', values: actions });
    rows.push({ metric: 'clipboard_text_length', unit: 'chars (event)', values: lengths });
  }

  // ─── Tab visibility (event — state + duration of previous state) ──
  {
    const states: Cell[] = new Array(numBins).fill(null);
    const durs: Cell[] = new Array(numBins).fill(null);
    for (const v of data.visibilityLogs ?? []) {
      const b = binOfAbsoluteMs(v.timestamp);
      if (b < 0) continue;
      states[b] = v.visibleState;
      if (v.hiddenDurationMs != null) durs[b] = v.hiddenDurationMs;
    }
    rows.push({ metric: 'visibility_state', unit: 'visible|hidden (event)', values: states });
    rows.push({
      metric: 'visibility_prev_duration_ms',
      unit: 'ms in previous state (event)',
      values: durs,
    });
  }

  // ─── Mouse clicks (sparse — x / y / target on each click bin) ──
  {
    const xs: Cell[] = new Array(numBins).fill(null);
    const ys: Cell[] = new Array(numBins).fill(null);
    const targets: Cell[] = new Array(numBins).fill(null);
    for (const c of data.clickLogs) {
      const b = binOfAbsoluteMs(c.timestamp);
      if (b < 0 || b >= numBins) continue;
      xs[b] = c.x;
      ys[b] = c.y;
      const t = (c.elementText?.trim() || c.elementSelector || '').slice(0, 200);
      targets[b] = t;
    }
    rows.push({ metric: 'click_x', unit: 'viewport px (event)', values: xs });
    rows.push({ metric: 'click_y', unit: 'viewport px (event)', values: ys });
    rows.push({ metric: 'click_target', unit: 'selector / text (event)', values: targets });
  }

  // ─── Activity events (interventions, session boundaries, modules) ──
  for (const action of ACTIVITY_ACTIONS) {
    const values: Cell[] = new Array(numBins).fill(null);
    for (const log of data.activityLogs ?? []) {
      if (log.action !== action) continue;
      const b = binOfAbsoluteMs(new Date(log.occurredAt).getTime());
      if (b < 0 || b >= numBins) continue;
      const meta = (log.metadata ?? {}) as Record<string, unknown>;
      const itype = typeof meta.interventionType === 'string' ? meta.interventionType : '';
      const title = (meta.itemTitle ?? meta.contentTitle ?? '') as string;
      const correct =
        typeof meta.isCorrect === 'boolean' ? (meta.isCorrect ? 'correct' : 'incorrect') : '';
      const latency =
        typeof meta.latencyMs === 'number' ? `${Math.round(meta.latencyMs / 100) / 10}s` : '';
      const detail = [itype, title, correct, latency].filter(Boolean).join(' · ');
      const cell = detail || '1';
      const existing = values[b];
      values[b] = existing ? `${existing} | ${cell}` : cell;
    }
    rows.push({ metric: action.toLowerCase(), unit: 'event detail', values });
  }

  // ─── Practice Testing config (P5) ──────────────────
  // Sparse rows that land in the bin the PRACTICE_TEST_CONFIGURED
  // event falls into, so each field stays time-aligned with the
  // student's intervention boundary. Multiple events in the same bin
  // collide via ' | ' (matches the activity-row pattern above).
  //
  // Field names match the activity-log meta keys so post-analysis
  // can cross-reference the JSON row with this wide-format export.
  {
    const mcq: Cell[] = new Array(numBins).fill(null);
    const sa: Cell[] = new Array(numBins).fill(null);
    const mode: Cell[] = new Array(numBins).fill(null);
    const detail: Cell[] = new Array(numBins).fill(null);
    const usedDefaults: Cell[] = new Array(numBins).fill(null);
    const usedTeacherDefaults: Cell[] = new Array(numBins).fill(null);
    const fallback: Cell[] = new Array(numBins).fill(null);
    const append = (arr: Cell[], b: number, v: Cell) => {
      const cur = arr[b];
      arr[b] = cur != null && cur !== '' ? `${cur} | ${v}` : v;
    };
    for (const log of data.activityLogs ?? []) {
      if (log.action !== 'PRACTICE_TEST_CONFIGURED') continue;
      const b = binOfAbsoluteMs(new Date(log.occurredAt).getTime());
      if (b < 0 || b >= numBins) continue;
      const meta = (log.metadata ?? {}) as Record<string, unknown>;
      if (typeof meta.mcqCount === 'number') append(mcq, b, meta.mcqCount);
      if (typeof meta.shortAnswerCount === 'number')
        append(sa, b, meta.shortAnswerCount);
      const m =
        typeof meta.coverageMode === 'string' ? meta.coverageMode : 'all';
      append(mode, b, m);
      let detailStr = '';
      if (
        m === 'pages' &&
        typeof meta.pageStart === 'number' &&
        typeof meta.pageEnd === 'number'
      ) {
        detailStr = `${meta.pageStart}-${meta.pageEnd}`;
      } else if (m === 'subtopic' && typeof meta.subtopic === 'string') {
        detailStr = meta.subtopic;
      }
      if (detailStr) append(detail, b, detailStr);
      if (typeof meta.usedDefaults === 'boolean')
        append(usedDefaults, b, meta.usedDefaults ? 1 : 0);
      if (typeof meta.usedTeacherDefaults === 'boolean')
        append(usedTeacherDefaults, b, meta.usedTeacherDefaults ? 1 : 0);
      // coverageFallback is the structured object from P2; presence
      // alone signals a widening occurred.
      append(fallback, b, meta.coverageFallback ? 1 : 0);
    }
    rows.push({ metric: 'practice_test_mcq_count', unit: 'count (event)', values: mcq });
    rows.push({
      metric: 'practice_test_short_answer_count',
      unit: 'count (event)',
      values: sa,
    });
    rows.push({
      metric: 'practice_test_coverage_mode',
      unit: 'all|pages|subtopic (event)',
      values: mode,
    });
    rows.push({
      metric: 'practice_test_coverage_detail',
      unit: 'pages "lo-hi" or subtopic string (event)',
      values: detail,
    });
    rows.push({
      metric: 'practice_test_used_defaults',
      unit: '0|1 (event)',
      values: usedDefaults,
    });
    rows.push({
      metric: 'practice_test_used_teacher_defaults',
      unit: '0|1 (event)',
      values: usedTeacherDefaults,
    });
    rows.push({
      metric: 'practice_test_coverage_fallback',
      unit: '0|1 (event)',
      values: fallback,
    });
  }

  // ─── Chatbot turns (USER and ASSISTANT separate rows) ──
  {
    const userMsgs: Cell[] = new Array(numBins).fill(null);
    const asstMsgs: Cell[] = new Array(numBins).fill(null);
    for (const m of data.chatbotMessages ?? []) {
      const b = binOfAbsoluteMs(new Date(m.createdAt).getTime());
      if (b < 0 || b >= numBins) continue;
      const target = m.role === 'USER' ? userMsgs : asstMsgs;
      const content = m.content.slice(0, maxMessageChars);
      const existing = target[b];
      target[b] = existing ? `${existing} | ${content}` : content;
    }
    rows.push({ metric: 'chatbot_user_message', unit: 'text (event)', values: userMsgs });
    rows.push({ metric: 'chatbot_assistant_message', unit: 'text (event)', values: asstMsgs });
  }

  // ─── Dialogue turns (LLM dialogue mode) ─────────────
  {
    const userMsgs: Cell[] = new Array(numBins).fill(null);
    const asstMsgs: Cell[] = new Array(numBins).fill(null);
    for (const m of data.dialogueMessages ?? []) {
      const b = binOfAbsoluteMs(new Date(m.createdAt).getTime());
      if (b < 0 || b >= numBins) continue;
      const target = m.role === 'USER' ? userMsgs : asstMsgs;
      const content = m.content.slice(0, maxMessageChars);
      const existing = target[b];
      target[b] = existing ? `${existing} | ${content}` : content;
    }
    rows.push({ metric: 'dialogue_user_message', unit: 'text (event)', values: userMsgs });
    rows.push({ metric: 'dialogue_assistant_message', unit: 'text (event)', values: asstMsgs });
  }

  // ─── EF text-mining detections ──────────────────────
  {
    const labels: Cell[] = new Array(numBins).fill(null);
    const confs: Cell[] = new Array(numBins).fill(null);
    for (const d of data.efDetections ?? []) {
      if (d.label === 'pending' || d.label === 'error') continue;
      const b = binOfAbsoluteMs(new Date(d.createdAt).getTime());
      if (b < 0 || b >= numBins) continue;
      const lbl = `${d.constructKey}:${d.label}`;
      const existingL = labels[b];
      labels[b] = existingL ? `${existingL} | ${lbl}` : lbl;
      confs[b] = numRound(d.confidence) ?? '';
    }
    rows.push({ metric: 'ef_detection_label', unit: 'construct:label (event)', values: labels });
    rows.push({ metric: 'ef_detection_confidence', unit: '0-1', values: confs });
  }

  // ─── AOI scoring rows (prompt 05) ──────────────────
  // Carry-forward the active epoch + observed/expected/alignment from
  // the AOI scoring result onto the same time grid. Only emitted when
  // `options.aoiScoring` is passed; otherwise these rows are skipped.
  if (options.aoiScoring) {
    const aoiEpochs = [...options.aoiScoring.epochs].sort(
      (a, b) => a.startMs - b.startMs,
    );
    const AOI_BUCKETS = ['sidebar', 'lesson+pdf', 'chatbot', 'header'] as const;
    const epochTypes: Cell[] = new Array(numBins).fill('');
    const alignments: Cell[] = new Array(numBins).fill('');
    const observedRows: Record<string, Cell[]> = {};
    const expectedRows: Record<string, Cell[]> = {};
    for (const b of AOI_BUCKETS) {
      observedRows[b] = new Array(numBins).fill('');
      expectedRows[b] = new Array(numBins).fill('');
    }
    let aoiIdx = 0;
    for (let i = 0; i < numBins; i++) {
      const t = rangeBaseWallMs + i * binMs;
      while (
        aoiIdx + 1 < aoiEpochs.length &&
        aoiEpochs[aoiIdx + 1]!.startMs <= t
      ) {
        aoiIdx += 1;
      }
      const ep = aoiEpochs[aoiIdx];
      if (!ep) continue;
      // Only fill rows when the bin sits inside this epoch's span.
      if (t < ep.startMs || t > ep.endMs) continue;
      epochTypes[i] = ep.type;
      alignments[i] =
        ep.alignment != null ? numRound(ep.alignment, 4) ?? '' : '';
      for (const b of AOI_BUCKETS) {
        observedRows[b]![i] = numRound(ep.observed[b] ?? 0, 4) ?? '';
        expectedRows[b]![i] = numRound(ep.expected[b] ?? 0, 4) ?? '';
      }
    }
    rows.push({ metric: 'aoi_epoch_type', unit: 'active epoch (carry-fwd)', values: epochTypes });
    rows.push({
      metric: 'aoi_epoch_alignment',
      unit: '0-1 alignment (carry-fwd)',
      values: alignments,
    });
    for (const b of AOI_BUCKETS) {
      rows.push({
        metric: `aoi_observed_${b.replace('+', '_')}`,
        unit: 'PDT share 0-1',
        values: observedRows[b]!,
      });
      rows.push({
        metric: `aoi_expected_${b.replace('+', '_')}`,
        unit: 'expected share 0-1',
        values: expectedRows[b]!,
      });
    }
  }

  // ─── Viewport size / orientation (event — carry-forward) ──
  // Captured per session-init + on every resize / orientation
  // change. Without this in the CSV, downstream consumers can't tell
  // whether a gaze x=900 sample fell inside a 1280-px viewport (sure)
  // or a 360-px portrait viewport (way off-screen).
  {
    const widths: Cell[] = new Array(numBins).fill(null);
    const heights: Cell[] = new Array(numBins).fill(null);
    const orientations: Cell[] = new Array(numBins).fill(null);
    const viewportLogs = [...(data.viewportLogs ?? [])].sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    let curW: number | null = null;
    let curH: number | null = null;
    let curO: string | null = null;
    let vIdx = 0;
    // Seed with the most recent viewport from BEFORE the range so a
    // mid-session export starts at the correct viewport, not blank.
    while (vIdx < viewportLogs.length && viewportLogs[vIdx]!.timestamp < rangeBaseWallMs) {
      curW = viewportLogs[vIdx]!.width;
      curH = viewportLogs[vIdx]!.height;
      curO = viewportLogs[vIdx]!.orientation;
      vIdx++;
    }
    for (let i = 0; i < numBins; i++) {
      const center = binCenters[i]!;
      while (vIdx < viewportLogs.length && viewportLogs[vIdx]!.timestamp <= center) {
        curW = viewportLogs[vIdx]!.width;
        curH = viewportLogs[vIdx]!.height;
        curO = viewportLogs[vIdx]!.orientation;
        vIdx++;
      }
      widths[i] = curW;
      heights[i] = curH;
      orientations[i] = curO;
    }
    rows.push({ metric: 'viewport_width', unit: 'px (carry-forward)', values: widths });
    rows.push({ metric: 'viewport_height', unit: 'px (carry-forward)', values: heights });
    rows.push({
      metric: 'viewport_orientation',
      unit: 'portrait|landscape (carry-forward)',
      values: orientations,
    });
  }

  // ─── Snapshot trigger + page URL (carry-forward) ─────────
  // The snapshot stream itself has metadata that's useful in a
  // post-analysis CSV: `trigger` (initial | periodic | route |
  // hidden | pagehide | beforeunload | cleanup) tells you whether a
  // moment was a regular periodic capture or a special transition,
  // and `pageUrl` lets you slice by route without re-joining against
  // activity_logs. Carry-forward from the most recent snapshot ≤ bin
  // center (same pattern as aoi_active_regions).
  {
    const triggerVals: Cell[] = new Array(numBins);
    const urlVals: Cell[] = new Array(numBins);
    let idx = 0;
    let lastTrigger = '';
    let lastUrl = '';
    while (idx < snapshots.length && snapshots[idx]!.capturedAt < rangeBaseWallMs) {
      lastTrigger = snapshots[idx]!.trigger ?? '';
      lastUrl = snapshots[idx]!.pageUrl ?? '';
      idx++;
    }
    for (let i = 0; i < numBins; i++) {
      const center = binCenters[i]!;
      while (idx < snapshots.length && snapshots[idx]!.capturedAt <= center) {
        lastTrigger = snapshots[idx]!.trigger ?? '';
        lastUrl = snapshots[idx]!.pageUrl ?? '';
        idx++;
      }
      triggerVals[i] = lastTrigger;
      urlVals[i] = lastUrl;
    }
    rows.push({
      metric: 'snapshot_trigger',
      unit: 'periodic|route|hidden|... (carry-forward)',
      values: triggerVals,
    });
    rows.push({
      metric: 'snapshot_page_url',
      unit: 'pathname (carry-forward)',
      values: urlVals,
    });
  }

  // ─── PDF reader semantic anchor (carry-forward) ──────────
  // `pdf_current_page` and `pdf_total_pages` are persisted on the
  // snapshot row for any moment a PdfReader was mounted. Carry-
  // forward across periodic snapshots so the consumer can answer
  // "what page was the student on at t=37s?" without parsing the
  // captured HTML. Both are null when no PDF was on screen.
  {
    const cur: Cell[] = new Array(numBins).fill(null);
    const tot: Cell[] = new Array(numBins).fill(null);
    let idx = 0;
    let lastCur: number | null = null;
    let lastTot: number | null = null;
    while (idx < snapshots.length && snapshots[idx]!.capturedAt < rangeBaseWallMs) {
      const sn = snapshots[idx]!;
      if (typeof sn.pdfCurrentPage === 'number') lastCur = sn.pdfCurrentPage;
      if (typeof sn.pdfTotalPages === 'number') lastTot = sn.pdfTotalPages;
      idx++;
    }
    for (let i = 0; i < numBins; i++) {
      const center = binCenters[i]!;
      while (idx < snapshots.length && snapshots[idx]!.capturedAt <= center) {
        const sn = snapshots[idx]!;
        if (typeof sn.pdfCurrentPage === 'number') lastCur = sn.pdfCurrentPage;
        if (typeof sn.pdfTotalPages === 'number') lastTot = sn.pdfTotalPages;
        idx++;
      }
      cur[i] = lastCur;
      tot[i] = lastTot;
    }
    rows.push({ metric: 'pdf_current_page', unit: '1-based (carry-forward)', values: cur });
    rows.push({ metric: 'pdf_total_pages', unit: 'count (carry-forward)', values: tot });
  }

  // ─── Per-panel AOI rectangle (carry-forward) ─────────────
  // For each of the four scored panels (sidebar / lesson / pdf-
  // viewer / chatbot), emit one row per geometry field
  // (x, y, width, height). Carry-forward from the most recent
  // snapshot ≤ bin center. Null when that panel wasn't on screen.
  //
  // Why this is useful alongside `aoi_active_regions`: the comma-
  // separated regions list tells you WHICH panels are on screen, but
  // not WHERE. The per-panel x/y/w/h lets a researcher correlate
  // gaze coordinates against the actual panel layout (panel widths
  // can change as the chatbot resizer is dragged, etc.) without
  // having to parse the raw `aois` JSON column.
  {
    const PANELS = ['sidebar', 'lesson', 'pdf-viewer', 'chatbot'] as const;
    type PanelKey = (typeof PANELS)[number];
    type Field = 'x' | 'y' | 'width' | 'height';
    const FIELDS: ReadonlyArray<Field> = ['x', 'y', 'width', 'height'];
    // Initialize one carry-forward state map per panel.
    const last: Record<PanelKey, Record<Field, number | null>> = {
      sidebar: { x: null, y: null, width: null, height: null },
      lesson: { x: null, y: null, width: null, height: null },
      'pdf-viewer': { x: null, y: null, width: null, height: null },
      chatbot: { x: null, y: null, width: null, height: null },
    };
    // Per-panel per-field column arrays.
    const cols: Record<PanelKey, Record<Field, Cell[]>> = {
      sidebar: { x: [], y: [], width: [], height: [] },
      lesson: { x: [], y: [], width: [], height: [] },
      'pdf-viewer': { x: [], y: [], width: [], height: [] },
      chatbot: { x: [], y: [], width: [], height: [] },
    };
    for (const p of PANELS) {
      for (const f of FIELDS) cols[p][f] = new Array(numBins).fill(null);
    }
    const ingest = (snap: SessionReplaySnapshot) => {
      const aois = snap.aois;
      if (!Array.isArray(aois)) return;
      // Seen-set: a snapshot whose aois don't include a given panel
      // means the panel wasn't on screen — reset that panel's
      // carry-forward to null so we don't show stale geometry from
      // a previous page.
      const seen = new Set<string>();
      for (const r of aois as SessionReplayAoiRect[]) {
        if (!PANELS.includes(r.region as PanelKey)) continue;
        const p = r.region as PanelKey;
        seen.add(p);
        last[p].x = r.x;
        last[p].y = r.y;
        last[p].width = r.width;
        last[p].height = r.height;
      }
      for (const p of PANELS) {
        if (!seen.has(p)) {
          last[p].x = null;
          last[p].y = null;
          last[p].width = null;
          last[p].height = null;
        }
      }
    };
    let idx = 0;
    while (idx < snapshots.length && snapshots[idx]!.capturedAt < rangeBaseWallMs) {
      ingest(snapshots[idx]!);
      idx++;
    }
    for (let i = 0; i < numBins; i++) {
      const center = binCenters[i]!;
      while (idx < snapshots.length && snapshots[idx]!.capturedAt <= center) {
        ingest(snapshots[idx]!);
        idx++;
      }
      for (const p of PANELS) {
        for (const f of FIELDS) cols[p][f]![i] = last[p][f];
      }
    }
    for (const p of PANELS) {
      const safeName = p.replace('-', '_'); // pdf-viewer → pdf_viewer
      rows.push({
        metric: `aoi_${safeName}_x`,
        unit: 'viewport px (carry-forward)',
        values: cols[p].x,
      });
      rows.push({
        metric: `aoi_${safeName}_y`,
        unit: 'viewport px (carry-forward)',
        values: cols[p].y,
      });
      rows.push({
        metric: `aoi_${safeName}_w`,
        unit: 'viewport px (carry-forward)',
        values: cols[p].width,
      });
      rows.push({
        metric: `aoi_${safeName}_h`,
        unit: 'viewport px (carry-forward)',
        values: cols[p].height,
      });
    }
  }

  // ─── Per-scroll-host inner scrollTop + percent (carry-forward) ──
  // window.scrollY is pinned to 0 in the docked layout because both
  // the lesson MDX and the PDF reader scroll inside inner overflow
  // containers. The recorder captures per-host scroll state (typed
  // `scrollHosts` payload, prompt 06) so the export can surface
  // scrollTop + percent per panel — that's the actual reading-
  // position signal for any layout where the body doesn't scroll.
  {
    type HostKey = 'sidebar' | 'lesson' | 'pdf-viewer' | 'chatbot';
    const HOSTS: ReadonlyArray<HostKey> = ['sidebar', 'lesson', 'pdf-viewer', 'chatbot'];
    const tops: Record<HostKey, Cell[]> = {
      sidebar: new Array(numBins).fill(null),
      lesson: new Array(numBins).fill(null),
      'pdf-viewer': new Array(numBins).fill(null),
      chatbot: new Array(numBins).fill(null),
    };
    const percents: Record<HostKey, Cell[]> = {
      sidebar: new Array(numBins).fill(null),
      lesson: new Array(numBins).fill(null),
      'pdf-viewer': new Array(numBins).fill(null),
      chatbot: new Array(numBins).fill(null),
    };
    const last: Record<HostKey, { top: number | null; pct: number | null }> = {
      sidebar: { top: null, pct: null },
      lesson: { top: null, pct: null },
      'pdf-viewer': { top: null, pct: null },
      chatbot: { top: null, pct: null },
    };
    const ingest = (snap: SessionReplaySnapshot) => {
      const hosts = snap.scrollHosts;
      if (!Array.isArray(hosts)) return;
      // Same seen-set discipline as the AOI rects above: a panel
      // missing from this snapshot's hosts means it wasn't on
      // screen → reset carry-forward to null.
      const seen = new Set<HostKey>();
      for (const h of hosts as SessionReplayScrollHost[]) {
        const region = h.region;
        if (!region) continue;
        if (!HOSTS.includes(region as HostKey)) continue;
        const k = region as HostKey;
        seen.add(k);
        last[k].top = h.scrollTop;
        last[k].pct = numRound(h.scrollTopPercent, 4);
      }
      for (const k of HOSTS) {
        if (!seen.has(k)) {
          last[k].top = null;
          last[k].pct = null;
        }
      }
    };
    let idx = 0;
    while (idx < snapshots.length && snapshots[idx]!.capturedAt < rangeBaseWallMs) {
      ingest(snapshots[idx]!);
      idx++;
    }
    for (let i = 0; i < numBins; i++) {
      const center = binCenters[i]!;
      while (idx < snapshots.length && snapshots[idx]!.capturedAt <= center) {
        ingest(snapshots[idx]!);
        idx++;
      }
      for (const k of HOSTS) {
        tops[k][i] = last[k].top;
        percents[k][i] = last[k].pct;
      }
    }
    for (const k of HOSTS) {
      const safe = k.replace('-', '_');
      rows.push({
        metric: `scroll_top_${safe}`,
        unit: 'in-host px (carry-forward)',
        values: tops[k],
      });
      rows.push({
        metric: `scroll_percent_${safe}`,
        unit: '0-1 (carry-forward)',
        values: percents[k],
      });
    }
  }

  // ─── Catch-all activity row ──────────────────────────────
  // The curated ACTIVITY_ACTIONS list above covers the standard
  // session / module / intervention / dialogue lifecycle. But the
  // ActivityAction enum also includes biometric infrastructure
  // events (WEBGAZER_CALIBRATION_COMPLETED, PYFEAT_JOB_FAILED,
  // RECORDING_RESUMED, etc.) and CHATBOT / DIALOGUE message
  // markers. Some of those overlap with the chatbot_*_message /
  // dialogue_*_message rows above (intentional dup-ish — message
  // events have a 1-to-1 marker with no content), but the rest
  // would silently drop out of the CSV. Emit one catch-all row that
  // bundles every activity action NOT in the curated list so
  // nothing is lost — researchers can still see e.g. a calibration
  // event landing inside a confusion-flag window.
  {
    const curated = new Set(ACTIVITY_ACTIONS);
    const values: Cell[] = new Array(numBins).fill(null);
    for (const log of data.activityLogs ?? []) {
      if (curated.has(log.action)) continue;
      const b = binOfAbsoluteMs(new Date(log.occurredAt).getTime());
      if (b < 0 || b >= numBins) continue;
      const existing = values[b];
      values[b] = existing ? `${existing} | ${log.action}` : log.action;
    }
    rows.push({
      metric: 'activity_other',
      unit: 'action name (event, not in curated list)',
      values,
    });
  }

  // ─── Active AOIs (carry-forward from nearest snapshot ≤ bin center) ──
  // Seed with the most recent snapshot from BEFORE the range so a
  // mid-session export reflects the layout at the slice start, not
  // an empty AOI list.
  {
    const values: Cell[] = new Array(numBins);
    let idx = 0;
    let lastRegions: string = '';
    while (idx < snapshots.length && snapshots[idx]!.capturedAt < rangeBaseWallMs) {
      const aois = snapshots[idx]!.aois;
      if (Array.isArray(aois) && aois.length > 0) {
        lastRegions = (aois as SessionReplayAoiRect[]).map((r) => r.region).join(',');
      }
      idx++;
    }
    // After the seed pass, `idx` points at the first in-range
    // snapshot (or past-the-end). Carry-forward from there.
    for (let i = 0; i < numBins; i++) {
      const center = binCenters[i]!;
      while (idx < snapshots.length && snapshots[idx]!.capturedAt <= center) {
        const aois = snapshots[idx]!.aois;
        if (Array.isArray(aois) && aois.length > 0) {
          lastRegions = (aois as SessionReplayAoiRect[]).map((r) => r.region).join(',');
        }
        idx++;
      }
      values[i] = lastRegions;
    }
    rows.push({
      metric: 'aoi_active_regions',
      unit: 'comma-separated (snapshot)',
      values,
    });
  }

  // ─── AOI scoring (prompt 05) ────────────────────────
  // When the caller passes a precomputed AOI scoring result, emit
  // bin-aligned rows for the currently-active epoch, the per-AOI
  // observed and expected shares, the per-epoch alignment, and the
  // overall session allocation score (constant across all bins). The
  // researcher can then correlate moment-by-moment gaze allocation
  // against the EV/SEEV expected distribution in pandas/R.
  if (options.aoiScoring && options.aoiScoring.epochs.length > 0) {
    const aoiScoring = options.aoiScoring;
    // Sort epochs by start so the linear walk below is monotonic.
    const sortedEpochs = [...aoiScoring.epochs].sort((a, b) => a.startMs - b.startMs);

    // Pre-build a function that returns the epoch covering a given
    // bin center. Linear two-pointer walk amortizes to O(n_bins).
    const epochAt: Array<(typeof sortedEpochs)[number] | null> = new Array(numBins).fill(null);
    {
      let idx = 0;
      for (let i = 0; i < numBins; i++) {
        const center = binCenters[i]!;
        while (idx + 1 < sortedEpochs.length && sortedEpochs[idx + 1]!.startMs <= center) {
          idx += 1;
        }
        const candidate = sortedEpochs[idx];
        if (candidate && candidate.startMs <= center && center <= candidate.endMs) {
          epochAt[i] = candidate;
        } else {
          epochAt[i] = null;
        }
      }
    }

    // Active epoch type per bin.
    rows.push({
      metric: 'aoi_epoch_type',
      unit: 'string',
      values: epochAt.map((e) => e?.type ?? null),
    });
    rows.push({
      metric: 'aoi_epoch_alignment',
      unit: '0-1 (TV-distance; null = idle/nav/empty)',
      values: epochAt.map((e) => (e?.alignment != null ? numRound(e.alignment) ?? '' : null)),
    });
    // Per-AOI observed / expected shares. Stick to the four scored
    // buckets plus the rolled-up combo and the "outside" residual.
    const SCORED_BUCKETS_FOR_CSV = [
      'sidebar',
      'lesson+pdf',
      'chatbot',
      'header',
      'outside',
    ] as const;
    for (const bucket of SCORED_BUCKETS_FOR_CSV) {
      rows.push({
        metric: `aoi_pdt_observed_${bucket.replace('+', '_plus_')}`,
        unit: '0-1 share',
        values: epochAt.map((e) => {
          if (!e) return null;
          const v = e.observed[bucket] ?? 0;
          return numRound(v) ?? '';
        }),
      });
      // Expected for the residual `outside` bucket is by construction
      // 0 (only the four scored buckets get expected weight).
      if (bucket !== 'outside') {
        rows.push({
          metric: `aoi_pdt_expected_${bucket.replace('+', '_plus_')}`,
          unit: '0-1 share (SEEV/EV)',
          values: epochAt.map((e) => {
            if (!e) return null;
            const v = e.expected[bucket] ?? 0;
            return numRound(v) ?? '';
          }),
        });
      }
    }
    // Session-level allocation score — constant across the export,
    // but useful as a one-line readout in pandas (`.iloc[0]`).
    const sessionAlignmentStr =
      aoiScoring.sessionAlignment != null
        ? numRound(aoiScoring.sessionAlignment) ?? ''
        : '';
    rows.push({
      metric: 'aoi_session_allocation_score',
      unit: '0-1 (duration-weighted mean of epoch alignments)',
      values: new Array(numBins).fill(sessionAlignmentStr),
    });
  }

  // ─── Serialize ──────────────────────────────────────
  const lines: string[] = [];
  // Timeline rows first. relative_s is relative to the SESSION
  // start, not the export start — that way two slices of the same
  // session can be lined up by timestamp without rebasing.
  {
    const headerCols = ['wall_clock_iso', 'UTC ISO 8601'];
    for (let i = 0; i < numBins; i++) {
      headerCols.push(new Date(rangeBaseWallMs + i * binMs).toISOString());
    }
    lines.push(headerCols.map(csvEscape).join(','));
  }
  {
    const relCols = ['relative_s', 'seconds from session start'];
    for (let i = 0; i < numBins; i++) {
      relCols.push(String((startOffset + i * binMs) / 1000));
    }
    lines.push(relCols.map(csvEscape).join(','));
  }
  for (const row of rows) {
    const cols: string[] = [csvEscape(row.metric), csvEscape(row.unit)];
    for (let i = 0; i < numBins; i++) cols.push(csvEscape(row.values[i]));
    lines.push(cols.join(','));
  }

  return lines.join('\n');
}

/**
 * Triggers a browser download of the CSV. Caller passes the already-
 * built CSV string (so the heavy work can be measured / awaited
 * separately).
 */
export function downloadCsvFile(csvText: string, filename: string): void {
  // Prepend UTF-8 BOM so Excel opens the file in UTF-8 instead of
  // mangling non-ASCII chars (intervention names, chatbot replies).
  const blob = new Blob(['﻿', csvText], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Browser holds the blob alive until the URL is revoked. Defer so
  // the click handler completes before we tear it down.
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
