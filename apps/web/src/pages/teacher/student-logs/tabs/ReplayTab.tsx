import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSessionReplay } from '../hooks/useSessionReplay';
import type {
  SessionReplayActivityLog,
  SessionReplayAoiRect,
  SessionReplayIntervention,
  SessionReplaySnapshot,
} from '../hooks/useSessionReplay';
import { exportReplayCsv, downloadCsvFile } from '../lib/exportReplayCsv';
import { api } from '../../../../lib/api';
import { formatTimeSecSGT } from '../../../../lib/formatDateTime';
import {
  computeAoiScoring,
  DEFAULT_VALID_STUDY_PARAMS,
  DEFAULT_EXPECTED_WEIGHTS,
  EPOCH_TYPES,
  type AoiBucket,
  type EpochType,
  type ExpectedWeightTable,
  type ValidStudyMaskParams,
} from '../lib/aoiScoring';
import { useReplayAnnotations } from '../hooks/useReplayAnnotations';
import { AnnotationsPanel } from '../components/AnnotationsPanel';

// Stable colour assignment per region so the same region looks the
// same on the overlay and the coverage panel. Anything not in this
// map falls back to neutral slate so an unknown future region still
// renders sensibly.
const AOI_COLORS: Record<string, { stroke: string; fill: string; chip: string }> = {
  sidebar: {
    stroke: '#8b5cf6',
    fill: 'rgba(139, 92, 246, 0.10)',
    chip: 'bg-violet-100 text-violet-700 border-violet-300',
  },
  lesson: {
    stroke: '#2563eb',
    fill: 'rgba(37, 99, 235, 0.08)',
    chip: 'bg-blue-100 text-blue-700 border-blue-300',
  },
  'pdf-viewer': {
    stroke: '#dc2626',
    fill: 'rgba(220, 38, 38, 0.10)',
    chip: 'bg-red-100 text-red-700 border-red-300',
  },
  chatbot: {
    stroke: '#16a34a',
    fill: 'rgba(22, 163, 74, 0.10)',
    chip: 'bg-green-100 text-green-700 border-green-300',
  },
};
const AOI_FALLBACK = {
  stroke: '#64748b',
  fill: 'rgba(100, 116, 139, 0.10)',
  chip: 'bg-slate-100 text-slate-700 border-slate-300',
};
function aoiColor(region: string) {
  return AOI_COLORS[region] ?? AOI_FALLBACK;
}
const PLAYBACK_STEP_MS = 200; // 5 FPS playback to align with biometrics sampled at 5 FPS

const EMOTION_SIGNALS = [
  { key: 'happiness', label: 'Emotion Happy', color: '#16a34a' },
  { key: 'sadness', label: 'Emotion Sad', color: '#2563eb' },
  { key: 'surprise', label: 'Emotion Surprise', color: '#d97706' },
  { key: 'fear', label: 'Emotion Fear', color: '#7c3aed' },
  { key: 'anger', label: 'Emotion Anger', color: '#dc2626' },
  { key: 'disgust', label: 'Emotion Disgust', color: '#65a30d' },
  { key: 'contempt', label: 'Emotion Contempt', color: '#ea580c' },
  { key: 'neutral', label: 'Emotion Neutral', color: '#6b7280' },
] as const;

const LEARNING_STATE_SIGNALS = [
  { key: 'engagementScore', label: 'State Engagement', color: '#16a34a' },
  { key: 'boredomScore', label: 'State Boredom', color: '#6b7280' },
  { key: 'confusionScore', label: 'State Confusion', color: '#d97706' },
  { key: 'frustrationScore', label: 'State Frustration', color: '#dc2626' },
] as const;

const AU_SIGNALS = [
  { key: 'au01', label: 'AU01', color: '#e11d48' },
  { key: 'au02', label: 'AU02', color: '#db2777' },
  { key: 'au04', label: 'AU04', color: '#be185d' },
  { key: 'au05', label: 'AU05', color: '#a21caf' },
  { key: 'au06', label: 'AU06', color: '#7e22ce' },
  { key: 'au07', label: 'AU07', color: '#6d28d9' },
  { key: 'au09', label: 'AU09', color: '#4f46e5' },
  { key: 'au10', label: 'AU10', color: '#2563eb' },
  { key: 'au12', label: 'AU12', color: '#0284c7' },
  { key: 'au14', label: 'AU14', color: '#0891b2' },
  { key: 'au15', label: 'AU15', color: '#0d9488' },
  { key: 'au17', label: 'AU17', color: '#059669' },
  { key: 'au20', label: 'AU20', color: '#16a34a' },
  { key: 'au23', label: 'AU23', color: '#65a30d' },
  { key: 'au24', label: 'AU24', color: '#84cc16' },
  { key: 'au25', label: 'AU25', color: '#ca8a04' },
  { key: 'au26', label: 'AU26', color: '#d97706' },
  { key: 'au28', label: 'AU28', color: '#ea580c' },
] as const;

type EmotionSignalKey = (typeof EMOTION_SIGNALS)[number]['key'];
type LearningStateSignalKey = (typeof LEARNING_STATE_SIGNALS)[number]['key'];
type AuSignalKey = (typeof AU_SIGNALS)[number]['key'];
type SignalKey = EmotionSignalKey | LearningStateSignalKey | AuSignalKey;

const AU_LABELS: Record<string, string> = {
  au01: 'AU01',
  au02: 'AU02',
  au04: 'AU04',
  au05: 'AU05',
  au06: 'AU06',
  au07: 'AU07',
  au09: 'AU09',
  au10: 'AU10',
  au12: 'AU12',
  au14: 'AU14',
  au15: 'AU15',
  au17: 'AU17',
  au20: 'AU20',
  au23: 'AU23',
  au24: 'AU24',
  au25: 'AU25',
  au26: 'AU26',
  au28: 'AU28',
};

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatTimestamp(ms: number) {
  return formatTimeSecSGT(ms);
}

// Pick a "nice" tick step for the Signal Timeline x-axis so we end up
// with ~6-10 labels regardless of total session length. Returns the
// step in milliseconds. Chosen from a fixed ladder so labels land on
// human-friendly intervals (5s, 10s, 30s, 1m, 5m, 10m, etc.) rather
// than awkward 12.7s spacings.
function chooseTickStepMs(durationMs: number): number {
  const TARGET_TICKS = 8;
  const ladder = [
    1_000,
    2_000,
    5_000,
    10_000,
    15_000,
    30_000,
    60_000,
    2 * 60_000,
    5 * 60_000,
    10 * 60_000,
    15 * 60_000,
    30 * 60_000,
    60 * 60_000,
    2 * 60 * 60_000,
  ];
  const ideal = Math.max(1_000, durationMs / TARGET_TICKS);
  for (const step of ladder) if (step >= ideal) return step;
  return ladder[ladder.length - 1]!;
}

function formatTickLabel(offsetMs: number): string {
  const totalSeconds = Math.max(0, Math.round(offsetMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Lenient time-offset parser. Accepts:
 *   - empty string / null  → null (caller decides default)
 *   - bare number          → seconds
 *   - "mm:ss" or "m:ss"    → minutes + seconds
 *   - "h:mm:ss"            → hours + minutes + seconds
 * Returns null when the input is unparseable so callers can fall
 * back to the full session bound rather than NaN-poisoning state.
 */
function parseTimeOffsetMs(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const parts = s.split(':').map((p) => p.trim());
  if (parts.length === 1) {
    const n = Number(parts[0]);
    return Number.isFinite(n) ? Math.max(0, n * 1000) : null;
  }
  if (parts.length === 2 || parts.length === 3) {
    const nums = parts.map((p) => Number(p));
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
    let seconds = 0;
    if (parts.length === 3) {
      seconds = nums[0]! * 3600 + nums[1]! * 60 + nums[2]!;
    } else {
      seconds = nums[0]! * 60 + nums[1]!;
    }
    return Math.max(0, Math.round(seconds * 1000));
  }
  return null;
}

/**
 * Prepare captured HTML for iframe srcDoc playback. The original DOM
 * was captured at a specific URL (snapshot.pageUrl), so any relative
 * stylesheet / image / font path was written assuming that origin.
 * When we load the HTML via `srcDoc` the iframe's base URL becomes
 * `about:srcdoc`, which makes `/assets/index.css` resolve to
 * `about:srcdoc/assets/index.css` → 404 → unstyled blank page (the
 * "DOM replay isn't working" symptom).
 *
 * Fix: inject `<base href="<origin>/">` so relative URLs resolve back
 * to where the page was originally served from. Same-origin fetches
 * succeed without allow-scripts.
 */
function injectBaseForIframe(
  html: string | null | undefined,
  pageUrl: string | null | undefined,
): string {
  if (!html) return '';
  // Strip <script> blocks. The sandbox already blocks them from
  // executing, but the browser logs a console warning per blocked
  // script which gets noisy fast on Vite/React captures (every
  // module + HMR client = its own warning). Removing the tags
  // entirely keeps the console clean and shrinks the srcdoc payload.
  // Greedy-safe variant: handle both `<script ...>...</script>` and
  // self-closing `<script ... />`.
  let cleaned = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/>/gi, '');

  if (!pageUrl) return cleaned;
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return cleaned;
  }
  const baseTag = `<base href="${origin}/">`;
  if (/<base\b/i.test(cleaned)) return cleaned;
  if (/<head\b[^>]*>/i.test(cleaned)) {
    cleaned = cleaned.replace(/<head\b[^>]*>/i, (m) => `${m}${baseTag}`);
  } else {
    cleaned = `${baseTag}${cleaned}`;
  }
  return cleaned;
}

/**
 * Drive inner-scroll restore from the parent. The iframe sandbox is
 * `allow-same-origin` ONLY — no scripts run inside (intentional: the
 * captured DOM is untrusted user content) — so we reach into the
 * iframe's contentDocument from here and write `scrollTop` /
 * `scrollLeft` directly.
 *
 * Why a single pass on iframe.onload isn't enough:
 *
 *   1. `inlineCanvasPixels` in the recorder replaces every `<canvas>`
 *      (including every PDF page) with an `<img src="data:image/...">`.
 *      The browser parses the `<img>` tag synchronously at parse time
 *      but DECODES the JPEG asynchronously. iframe.onload fires when
 *      the document has parsed, not when every image has decoded.
 *      Until the imgs land in the layout tree at their final size, a
 *      scroll-host's `scrollHeight` may still equal `clientHeight`
 *      (no overflow yet), which silently clamps a captured
 *      `scrollTop=5000` write to 0. That was the "PDF is static"
 *      symptom — the scroll value was correct, the host just had
 *      nowhere to scroll TO yet.
 *
 *   2. React-pdf's text layer also lays out asynchronously in some
 *      paths. Same clamp-to-0 issue.
 *
 * Strategy: apply on onLoad, then re-apply on every `<img>`'s `load`
 * event inside the iframe (so each newly-decoded canvas replacement
 * re-triggers a layout reconciliation), and a final safety re-apply
 * after 250ms in case images had already-decoded data-URLs and never
 * fire `load`. The PDF page anchor
 * (`pdfCurrentPage` → `[data-replay-pdf-page="N"]`) acts as a
 * fallback `scrollIntoView` target — semantic, not scroll-px — when
 * the typed scrollTop write doesn't take.
 *
 * Triple-defensive try/catch per the capture-failure-never-blocks
 * invariant from the recorder.
 */
/**
 * Write `scrollTop` / `scrollLeft` to an iframe element. If the
 * write doesn't stick (the browser clamps to 0 because the element's
 * computed `overflow-y` is `visible`, or because `scrollHeight ≈
 * clientHeight`), walk up the DOM looking for the nearest ancestor
 * that DOES have `overflow-y: auto|scroll` and real overflow, and
 * apply the value there.
 *
 * Why this exists: react-pdf scrolls via `.react-pdf__Document`'s
 * own scroll state in the live app, but that element's CSS in the
 * serialized iframe ends up `overflow-y: visible` (the inline style
 * set by react-pdf at runtime doesn't survive serialization /
 * stylesheet-loading semantics in `srcdoc`). The legacy marker
 * (`data-replay-scroll-top`) stamps `.react-pdf__Document`, so
 * naive `el.scrollTop = N` clamps to 0. The actual scroll host in
 * the iframe is `.react-pdf__Document`'s PARENT — `div.flex-1
 * .bg-gray-100.overflow-auto`. Walking up finds it.
 */
function applyScrollWithFallback(el: HTMLElement, top: number, left: number): void {
  const win = el.ownerDocument?.defaultView;
  if (!win) return;
  // Helper: returns the actual scroll host for the requested axis.
  // Walks up from `start`, returning the first ancestor whose
  // computed overflow on that axis is `auto`/`scroll`/`overlay` AND
  // whose scroll size exceeds its client size. Stops at <html>.
  const findScrollableAncestor = (start: HTMLElement, axis: 'y' | 'x'): HTMLElement | null => {
    let p: HTMLElement | null = start.parentElement;
    let depth = 0;
    while (p && depth < 30) {
      try {
        const tag = p.tagName;
        if (tag === 'HTML' || tag === 'BODY') return null;
        const cs = win.getComputedStyle(p);
        const ov = axis === 'y' ? cs.overflowY : cs.overflowX;
        const overflowsAxis =
          axis === 'y' ? p.scrollHeight > p.clientHeight + 1 : p.scrollWidth > p.clientWidth + 1;
        if ((ov === 'auto' || ov === 'scroll' || ov === 'overlay') && overflowsAxis) {
          return p;
        }
      } catch {
        // continue walking; ignore one bad node
      }
      p = p.parentElement;
      depth += 1;
    }
    return null;
  };
  try {
    if (Number.isFinite(top) && top > 0) {
      el.scrollTop = top;
      // Did it take? If not, walk up. Use a 1px tolerance because
      // some browsers round.
      if (Math.abs(el.scrollTop - top) > 1) {
        const realHost = findScrollableAncestor(el, 'y');
        if (realHost) realHost.scrollTop = top;
      }
    }
  } catch {
    // ignore
  }
  try {
    if (Number.isFinite(left) && left > 0) {
      el.scrollLeft = left;
      if (Math.abs(el.scrollLeft - left) > 1) {
        const realHost = findScrollableAncestor(el, 'x');
        if (realHost) realHost.scrollLeft = left;
      }
    }
  } catch {
    // ignore
  }
}

function applyInnerScrollRestore(
  iframe: HTMLIFrameElement | null | undefined,
  snapshot:
    | (Pick<SessionReplaySnapshot, 'scrollX' | 'scrollY' | 'pdfCurrentPage' | 'scrollHosts'> & {
        // Loose type; the caller may pass a stale row missing the new
        // fields. We tolerate undefined gracefully below.
      })
    | null
    | undefined,
): void {
  if (!iframe) return;
  const doc = iframe.contentDocument;
  if (!doc) return;

  // Single restore pass. Three sources of truth, applied in order so
  // a later, more specific anchor overrides an earlier one:
  //   (a) typed `scrollHosts` payload (post-prompt-06 snapshots) —
  //       most reliable because it carries the host's region label
  //       so we can target the lesson / pdf-viewer panel directly
  //       even when the DOM doesn't carry the marker attributes.
  //   (b) in-clone `data-replay-scroll-top` / `-left` markers —
  //       works on legacy snapshots (pre-prompt-06).
  //   (c) PDF page anchor — fallback that semantically maps to the
  //       right page wrapper via `data-replay-pdf-page`.
  const doRestore = () => {
    try {
      // (a) Typed scroll-host payload. Match by region label first
      //     (most reliable across DOM reflows); fall back to a
      //     selector-equality match for untagged hosts.
      const hosts = snapshot?.scrollHosts ?? null;
      if (Array.isArray(hosts) && hosts.length > 0) {
        for (const h of hosts) {
          try {
            let target: HTMLElement | null = null;
            if (h.region) {
              // Tagged panels usually ARE the scroll host. When they
              // wrap an inner scroller (e.g. pdf-viewer wraps
              // PdfReader's scroll div), pick the first overflowing
              // descendant — same logic as the recorder's
              // findInnerScrollHost. Skip if neither the tagged
              // element nor any descendant overflows.
              const tagged = doc.querySelector<HTMLElement>(`[data-replay-region="${h.region}"]`);
              if (tagged) {
                if (
                  tagged.scrollHeight > tagged.clientHeight + 1 ||
                  tagged.scrollWidth > tagged.clientWidth + 1
                ) {
                  target = tagged;
                } else {
                  // Pick any descendant that overflows.
                  const candidates = tagged.querySelectorAll<HTMLElement>('*');
                  for (const c of Array.from(candidates)) {
                    if (c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1) {
                      target = c;
                      break;
                    }
                  }
                }
              }
            }
            if (!target && h.selector) {
              try {
                target = doc.querySelector<HTMLElement>(h.selector);
              } catch {
                target = null;
              }
            }
            if (!target) continue;
            applyScrollWithFallback(target, h.scrollTop ?? 0, h.scrollLeft ?? 0);
          } catch {
            // Per-host failure — skip.
          }
        }
      }

      // (b) Legacy in-clone scroll markers. Still useful: covers
      //     pre-prompt-06 snapshots and any scroll host the recorder
      //     missed (e.g. brand-new popover the recorder didn't yet
      //     have a region tag for).
      const marked = doc.querySelectorAll<HTMLElement>(
        '[data-replay-scroll-top], [data-replay-scroll-left]',
      );
      marked.forEach((el) => {
        try {
          // Skip the document head — the recorder used to stamp it
          // due to <html>/<body> walk artifacts. Restoring scroll
          // there is meaningless.
          const tag = el.tagName;
          if (tag === 'HEAD' || tag === 'HTML' || tag === 'BODY') return;
          const topAttr = el.getAttribute('data-replay-scroll-top');
          const leftAttr = el.getAttribute('data-replay-scroll-left');
          const top = topAttr ? Number(topAttr) : 0;
          const left = leftAttr ? Number(leftAttr) : 0;
          applyScrollWithFallback(el, top, left);
        } catch {
          // skip per-element
        }
      });

      // (c) PDF page anchor fallback. Even when scrollTop restored
      //     cleanly above, scrollIntoView pins the matching page to
      //     the top of the host — keeps the replay aligned to what
      //     the student was reading even if the recorder picked a
      //     slightly off scrollTop or the iframe's column width
      //     differs by a few px.
      //
      //     Prefer the iframe DOM's own `data-replay-pdf-current-page`
      //     attribute (set by the recorder onto the PdfReader root)
      //     because it's always present when the PDF was captured —
      //     independent of whether `snapshot.pdfCurrentPage` was
      //     correctly plumbed through the React state (legacy /
      //     pre-prompt-06 snapshots have the attr but not the DB col).
      let pdfPage: number | null = null;
      try {
        const attrEl = doc.querySelector<HTMLElement>('[data-replay-pdf-current-page]');
        const attrVal = attrEl?.getAttribute('data-replay-pdf-current-page');
        if (attrVal) {
          const n = Number(attrVal);
          if (Number.isFinite(n) && n >= 1) pdfPage = Math.floor(n);
        }
      } catch {
        // ignore attr read failure
      }
      if (
        pdfPage === null &&
        typeof snapshot?.pdfCurrentPage === 'number' &&
        snapshot.pdfCurrentPage >= 1
      ) {
        pdfPage = snapshot.pdfCurrentPage;
      }
      if (pdfPage !== null) {
        const pageEl = doc.querySelector<HTMLElement>(`[data-replay-pdf-page="${pdfPage}"]`);
        if (pageEl) {
          try {
            pageEl.scrollIntoView({ block: 'start', behavior: 'auto' });
          } catch {
            // Older browsers without smooth-scroll polyfill — ignore.
          }
        }
      }

      // Window scroll for pages that DO scroll the body (non-docked
      // layouts). Harmless on docked-layout snapshots where scrollY=0.
      try {
        iframe.contentWindow?.scrollTo(snapshot?.scrollX ?? 0, snapshot?.scrollY ?? 0);
      } catch {
        // cross-origin / detached
      }
    } catch {
      // Whole restore failure — never blocks display.
    }
  };

  // Pass 1: immediate.
  doRestore();
  // Pass 2: re-apply after each in-iframe <img> decodes. Canvas
  // replacements are the main culprit for late layout shifts in the
  // PDF column.
  try {
    const imgs = doc.querySelectorAll('img');
    imgs.forEach((img) => {
      if ((img as HTMLImageElement).complete) return;
      img.addEventListener('load', doRestore, { once: true });
      img.addEventListener('error', doRestore, { once: true });
    });
  } catch {
    // ignore
  }
  // Pass 3: safety net for already-decoded data-URL images that
  // never fire `load`, and for any deferred layout work.
  try {
    setTimeout(doRestore, 250);
  } catch {
    // ignore
  }
}

type LearningThresholds = {
  engagement_score: number;
  boredom_score: number;
  confusion_surprise: number;
  confusion_fear: number;
  confusion_anger: number;
  confusion_disgust: number;
  frustration_sad: number;
  frustration_anger: number;
  frustration_disgust: number;
};

const DEFAULT_THRESHOLDS: LearningThresholds = {
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

type LearningRuleMode = 'single' | 'all_gt' | 'any_gt';
type LearningStateName = 'boredom' | 'engagement' | 'confusion' | 'frustration';
type LearningFeatureKey =
  | 'score_boredom'
  | 'score_engagement'
  | 'prob_Surprise'
  | 'prob_Fear'
  | 'prob_Anger'
  | 'prob_Disgust'
  | 'prob_Sad';
type LearningRule = {
  features: LearningFeatureKey[];
  mode: LearningRuleMode;
  thresholdKeys: (keyof LearningThresholds)[];
};

const STATE_RULES: Record<LearningStateName, LearningRule> = {
  boredom: {
    features: ['score_boredom'],
    mode: 'single',
    thresholdKeys: ['boredom_score'],
  },
  engagement: {
    features: ['score_engagement'],
    mode: 'single',
    thresholdKeys: ['engagement_score'],
  },
  confusion: {
    features: ['prob_Surprise', 'prob_Fear', 'prob_Anger', 'prob_Disgust'],
    mode: 'all_gt',
    thresholdKeys: ['confusion_surprise', 'confusion_fear', 'confusion_anger', 'confusion_disgust'],
  },
  frustration: {
    features: ['prob_Sad', 'prob_Anger', 'prob_Disgust'],
    mode: 'any_gt',
    thresholdKeys: ['frustration_sad', 'frustration_anger', 'frustration_disgust'],
  },
};

function predictRow(
  row: Record<LearningFeatureKey, number>,
  features: LearningFeatureKey[],
  thresholds: number[],
  mode: LearningRuleMode,
) {
  const comparisons = features.map((feature, index) => row[feature] > thresholds[index]!);
  if (mode === 'single') return Number(comparisons[0] ?? false);
  if (mode === 'all_gt') return Number(comparisons.every(Boolean));
  if (mode === 'any_gt') return Number(comparisons.some(Boolean));
  throw new Error(`Unsupported mode: ${mode}`);
}

function predictLearningState(
  probs: {
    neutral: number;
    disgust: number;
    happy: number;
    sad: number;
    anger: number;
    surprise: number;
    fear: number;
  },
  thresholds: LearningThresholds,
) {
  const n = probs.neutral;
  const d = probs.disgust;
  const h = probs.happy;
  const s = probs.sad;
  const a = probs.anger;
  const sp = probs.surprise;
  const f = probs.fear;

  const scoreEngagement = 0.4 * h + 0.4 * n + 0.2 * sp;
  const scoreBoredom = 0.5 * n + 0.3 * s + 0.2 * d;

  const row: Record<LearningFeatureKey, number> = {
    score_boredom: scoreBoredom,
    score_engagement: scoreEngagement,
    prob_Surprise: sp,
    prob_Fear: f,
    prob_Anger: a,
    prob_Disgust: d,
    prob_Sad: s,
  };

  const rulePredictions: Record<LearningStateName, number> = {
    boredom: predictRow(
      row,
      STATE_RULES.boredom.features,
      STATE_RULES.boredom.thresholdKeys.map((key) => thresholds[key]),
      STATE_RULES.boredom.mode,
    ),
    engagement: predictRow(
      row,
      STATE_RULES.engagement.features,
      STATE_RULES.engagement.thresholdKeys.map((key) => thresholds[key]),
      STATE_RULES.engagement.mode,
    ),
    confusion: predictRow(
      row,
      STATE_RULES.confusion.features,
      STATE_RULES.confusion.thresholdKeys.map((key) => thresholds[key]),
      STATE_RULES.confusion.mode,
    ),
    frustration: predictRow(
      row,
      STATE_RULES.frustration.features,
      STATE_RULES.frustration.thresholdKeys.map((key) => thresholds[key]),
      STATE_RULES.frustration.mode,
    ),
  };

  const scores = {
    engagement: scoreEngagement,
    boredom: scoreBoredom,
    confusion: rulePredictions.confusion,
    frustration: rulePredictions.frustration,
  };

  const eligibleScores: Record<string, number> = Object.fromEntries(
    Object.entries(rulePredictions).filter(([, value]) => value > 0),
  );
  const predicted = Object.keys(eligibleScores).length
    ? Object.keys(eligibleScores).join(',')
    : 'none';

  return { predicted, scores, eligibleScores };
}

export function ReplayTab({ sessionId }: { sessionId: string }) {
  const {
    data,
    isLoading,
    isLoadingSnapshots,
    snapshotLoadProgress,
    snapshotContentById,
    fetchSnapshotContent,
    error,
    refresh,
  } = useSessionReplay(sessionId);
  // ─── Double-buffered iframe playback ────────────────────────
  // Two stacked iframes. While one is on screen, the next snapshot's
  // HTML is loaded into the other. When the hidden iframe fires
  // `onLoad`, we scroll-restore it and cross-fade visibility. The
  // user never sees a blank document because a fully-rendered iframe
  // is always at opacity 1.
  //
  // The previous single-iframe path had two flash sources:
  //   1. `key={currentSnapshot.id}` forced a React remount, which
  //      destroyed the iframe element entirely between snapshots.
  //   2. Reassigning `srcDoc` on a single iframe forced the browser
  //      to tear down its document and re-parse — that alone is a
  //      blank frame even without (1).
  // Double-buffer fixes both.
  const iframeARef = useRef<HTMLIFrameElement | null>(null);
  const iframeBRef = useRef<HTMLIFrameElement | null>(null);
  const iframeRefs = useMemo(() => [iframeARef, iframeBRef] as const, []);
  // Tracks the most recent target snapshot id. `onLoad` handlers use
  // this to drop stale flips when the user scrubbed rapidly past a
  // half-loaded buffer.
  const latestTargetSnapshotIdRef = useRef<string | null>(null);
  // Dev counter so we can verify the spec's "srcDoc only on snapshot
  // change" criterion at runtime without grepping the dev tools.
  const srcDocAssignCountRef = useRef(0);

  // ─── Double-buffered pixel screenshot ───────────────────────
  // The Pixel Replay thumbnail used to flash on every snapshot
  // boundary because the <img>'s src attribute was reassigned in-
  // place — the browser briefly clears the painted pixels while it
  // decodes the new data URL. Mirror the iframe approach: render two
  // stacked <img>s, only swap visibility when the new one has fired
  // `onLoad`, so a fully-painted image is always on top.
  type ImageBufferState = { snapshotId: string | null; src: string };
  const [imageBuffers, setImageBuffers] = useState<readonly [ImageBufferState, ImageBufferState]>([
    { snapshotId: null, src: '' },
    { snapshotId: null, src: '' },
  ]);
  const [visibleImageBufferIdx, setVisibleImageBufferIdx] = useState<0 | 1 | null>(null);
  const latestImageTargetIdRef = useRef<string | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const viewportHostRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [isRetryingPyfeat, setIsRetryingPyfeat] = useState(false);
  const [contentScale, setContentScale] = useState(1);
  const [segmentVideoUrls, setSegmentVideoUrls] = useState<Record<string, string | null>>({});
  const [learningThresholds, setLearningThresholds] =
    useState<LearningThresholds>(DEFAULT_THRESHOLDS);
  const [selectedSignals, setSelectedSignals] = useState<Set<SignalKey>>(
    () =>
      new Set<SignalKey>(['boredomScore', 'frustrationScore', 'engagementScore', 'confusionScore']),
  );
  const [showAoiOverlay, setShowAoiOverlay] = useState(true);
  const [isExportingCsv, setIsExportingCsv] = useState(false);

  // Researcher annotation layer (prompt 06). Owns its own
  // load/CRUD via the hook; ReplayTab just hands it the session id +
  // current playhead and renders the panel.
  const annotationsApi = useReplayAnnotations(sessionId);
  // AOI scoring controls (prompt 05). Held in component state so the
  // researcher can adjust thresholds and weights without a reload.
  const [aoiFilterMode, setAoiFilterMode] = useState<'A' | 'B'>('A');
  const [aoiParams, setAoiParams] = useState<ValidStudyMaskParams>(DEFAULT_VALID_STUDY_PARAMS);
  const [aoiWindowStartText, setAoiWindowStartText] = useState<string>('');
  const [aoiWindowEndText, setAoiWindowEndText] = useState<string>('');
  const [expectedWeights, setExpectedWeights] =
    useState<ExpectedWeightTable>(DEFAULT_EXPECTED_WEIGHTS);

  // Export range as session-relative offsets (ms). Null means "use
  // the session bound" — keeps the inputs empty by default so a
  // fresh load defaults to "whole session" without showing 0:00.

  // Local text state for the inputs so the user can type freely
  // (e.g. partially-typed "1:2") without us snapping the value.

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTimeMs(0);
  }, [sessionId]);

  const baseWallClockMs = useMemo(() => {
    if (!data) return 0;
    return (
      data.syncAnchor?.wallClockMs ??
      data.snapshots[0]?.capturedAt ??
      (data.session ? new Date(data.session.startedAt).getTime() : 0)
    );
  }, [data]);

  const durationMs = useMemo(() => {
    if (!data) return 0;
    // Walk each stream once and track the max in-place. Avoids
    // `Math.max(...arr)` which blows the call stack at ~65k args
    // — long sessions easily produce that many gaze/scroll points.
    let maxTime = baseWallClockMs;
    const sessionEnd = data.session?.endedAt ? new Date(data.session.endedAt).getTime() : 0;
    if (sessionEnd > maxTime) maxTime = sessionEnd;
    for (const s of data.snapshots) {
      if (s.capturedAt > maxTime) maxTime = s.capturedAt;
    }
    for (const l of data.clickLogs) {
      if (l.timestamp > maxTime) maxTime = l.timestamp;
    }
    for (const l of data.scrollLogs) {
      if (l.timestamp > maxTime) maxTime = l.timestamp;
    }
    for (const l of data.viewportLogs) {
      if (l.timestamp > maxTime) maxTime = l.timestamp;
    }
    for (const l of data.gazeLogs) {
      const t = new Date(l.timestamp).getTime();
      if (t > maxTime) maxTime = t;
    }
    return Math.max(1_000, maxTime - baseWallClockMs);
  }, [baseWallClockMs, data]);

  const handleExportCsv = useCallback(() => {
    if (!data || isExportingCsv) return;
    setIsExportingCsv(true);
    try {
      const csvText = exportReplayCsv(
        {
          session: data.session,
          snapshots: data.snapshots,
          clickLogs: data.clickLogs,
          scrollLogs: data.scrollLogs,
          gazeLogs: data.gazeLogs,
          pupilLogs: data.pupilLogs,
          emotionFrames: data.emotionFrames,
          auResults: data.auResults,
          activityLogs: data.activityLogs,
          efDetections: data.efDetections,
          dialogueMessages: data.dialogueMessages,
          chatbotMessages: data.chatbotMessages,
          keystrokeLogs: data.keystrokeLogs,
          cursorLogs: data.cursorLogs,
          clipboardLogs: data.clipboardLogs,
          visibilityLogs: data.visibilityLogs,
          viewportLogs: data.viewportLogs,
        },
        baseWallClockMs,
        durationMs,
        { thresholds: learningThresholds },
      );
      const sessionStart = data.session?.startedAt
        ? new Date(data.session.startedAt).toISOString().slice(0, 10)
        : 'session';
      downloadCsvFile(csvText, `replay-${sessionId}-${sessionStart}.csv`);
    } finally {
      setIsExportingCsv(false);
    }
  }, [data, baseWallClockMs, durationMs, learningThresholds, sessionId, isExportingCsv]);

  useEffect(() => {
    if (!isPlaying) return;

    const timer = window.setInterval(() => {
      setCurrentTimeMs((prev) => {
        const next = prev + PLAYBACK_STEP_MS;
        if (next >= durationMs) {
          setIsPlaying(false);
          return durationMs;
        }
        return next;
      });
    }, PLAYBACK_STEP_MS);

    return () => window.clearInterval(timer);
  }, [durationMs, isPlaying]);

  const currentAbsoluteMs = baseWallClockMs + currentTimeMs;

  const snapshotStats = useMemo(() => {
    if (!data?.snapshots.length) {
      return { averageGapMs: null as number | null, latestGapMs: null as number | null };
    }
    if (data.snapshots.length === 1) {
      return { averageGapMs: null as number | null, latestGapMs: null as number | null };
    }

    const gaps: number[] = [];
    for (let index = 1; index < data.snapshots.length; index += 1) {
      gaps.push(data.snapshots[index]!.capturedAt - data.snapshots[index - 1]!.capturedAt);
    }

    const averageGapMs = Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length);
    return {
      averageGapMs,
      latestGapMs: gaps[gaps.length - 1] ?? null,
    };
  }, [data?.snapshots]);

  const currentSnapshot = useMemo(() => {
    if (!data?.snapshots.length) return null;
    let selected = data.snapshots[0]!;
    for (const snapshot of data.snapshots) {
      if (snapshot.capturedAt <= currentAbsoluteMs) selected = snapshot;
      else break;
    }
    return selected;
  }, [currentAbsoluteMs, data?.snapshots]);

  const currentSnapshotWithContent = useMemo(() => {
    if (!currentSnapshot) return null;
    return snapshotContentById[currentSnapshot.id] ?? currentSnapshot;
  }, [currentSnapshot, snapshotContentById]);

  useEffect(() => {
    if (!currentSnapshot?.id) return;
    void fetchSnapshotContent(currentSnapshot.id, { includeScreenshot: true });
  }, [currentSnapshot?.id, fetchSnapshotContent]);

  // Pixel-replay thumbnail: prefer the server-rendered screenshot when
  // present. The previous code had an SVG `<foreignObject>` fallback
  // that wrapped the HTML in escaped form — it rendered as literal
  // source code text (or nothing) because escaped `&lt;div&gt;` isn't
  // real DOM and external resources can't load from data: URLs anyway.
  // Now we just return null when no screenshot is captured; the
  // <iframe> below already provides the live DOM view.
  const currentSnapshotImageDataUrl = useMemo(() => {
    if (!currentSnapshotWithContent) return null;
    return currentSnapshotWithContent.screenshotDataUrl ?? null;
  }, [currentSnapshotWithContent]);

  // Per-buffer srcDoc state. Each entry maps a buffer slot (0|1) to
  // the snapshot id and HTML it currently holds. Stored in state — not
  // a ref — because React renders the srcDoc strings into JSX.
  //
  // `isLoaded` is critical: the load-effect re-runs every time we set
  // state (because `iframeBuffers` is in its deps), and without this
  // flag the effect would see "hidden buffer's snapshotId now matches
  // target" the moment it wrote the srcDoc — and flip visibility BEFORE
  // the browser had parsed the new document. That's the blank flash.
  type IframeBufferState = {
    snapshotId: string | null;
    srcDoc: string;
    isLoaded: boolean;
  };
  const [iframeBuffers, setIframeBuffers] = useState<
    readonly [IframeBufferState, IframeBufferState]
  >([
    { snapshotId: null, srcDoc: '', isLoaded: false },
    { snapshotId: null, srcDoc: '', isLoaded: false },
  ]);
  // Which buffer is on screen. `null` only at the very first render
  // before any snapshot has finished loading — both opacities stay 0
  // so we don't briefly flash an empty iframe.
  const [visibleBufferIdx, setVisibleBufferIdx] = useState<0 | 1 | null>(null);

  // Reset buffers when the session changes so a fresh load doesn't
  // briefly show the previous session's last frame.
  useEffect(() => {
    setIframeBuffers([
      { snapshotId: null, srcDoc: '', isLoaded: false },
      { snapshotId: null, srcDoc: '', isLoaded: false },
    ]);
    setVisibleBufferIdx(null);
    latestTargetSnapshotIdRef.current = null;
    srcDocAssignCountRef.current = 0;
    // Same reset for the image double-buffer.
    setImageBuffers([
      { snapshotId: null, src: '' },
      { snapshotId: null, src: '' },
    ]);
    setVisibleImageBufferIdx(null);
    latestImageTargetIdRef.current = null;
  }, [sessionId]);

  // Image-buffer load effect — mirror of the iframe buffer load
  // effect but for the pixel-screenshot thumbnail. Writes the new
  // src into the hidden image; the onLoad handler swaps once the
  // browser has decoded the data URL. Same `null` snapshotId guard
  // means: when there's no screenshot for the current snapshot,
  // both buffers stay at their previous src and the visible one
  // keeps showing the last loaded image (instead of going blank).
  useEffect(() => {
    if (!currentSnapshotWithContent || !currentSnapshotWithContent.screenshotDataUrl) {
      latestImageTargetIdRef.current = null;
      return;
    }
    const targetId = currentSnapshotWithContent.id;
    const targetSrc = currentSnapshotWithContent.screenshotDataUrl;
    latestImageTargetIdRef.current = targetId;
    if (
      visibleImageBufferIdx != null &&
      imageBuffers[visibleImageBufferIdx].snapshotId === targetId
    ) {
      return;
    }
    const loadIdx: 0 | 1 =
      visibleImageBufferIdx == null ? 0 : ((1 - visibleImageBufferIdx) as 0 | 1);
    if (imageBuffers[loadIdx].snapshotId === targetId) {
      // Already loaded into the hidden buffer — just swap.
      setVisibleImageBufferIdx(loadIdx);
      return;
    }
    setImageBuffers((prev) => {
      const next: [ImageBufferState, ImageBufferState] = [prev[0], prev[1]];
      next[loadIdx] = { snapshotId: targetId, src: targetSrc };
      return next;
    });
  }, [currentSnapshotWithContent, imageBuffers, visibleImageBufferIdx]);

  const handleImageBufferLoaded = useCallback(
    (idx: 0 | 1) => () => {
      const buffer = imageBuffers[idx];
      if (!buffer.snapshotId) return;
      if (buffer.snapshotId !== latestImageTargetIdRef.current) return;
      if (idx !== visibleImageBufferIdx) {
        setVisibleImageBufferIdx(idx);
      }
    },
    [imageBuffers, visibleImageBufferIdx],
  );

  // The buffer load effect + the onLoad handler that flips visibility
  // are defined further down — they depend on `currentScrollY`, which
  // isn't declared yet. Keep this top section limited to state /
  // refs.

  const hasCurrentSnapshotContent = useMemo(
    () => Boolean(currentSnapshot?.id && snapshotContentById[currentSnapshot.id]),
    [currentSnapshot?.id, snapshotContentById],
  );
  // Truthy when the top "Pixel Replay" thumbnail couldn't use a real
  // server-rendered screenshot and we're relying on the live iframe
  // below instead. Used as a small annotation on the timestamp line so
  // the teacher knows what they're looking at.
  const isUsingDomFallbackImage = useMemo(
    () =>
      Boolean(
        currentSnapshotWithContent &&
        !currentSnapshotWithContent.screenshotDataUrl &&
        currentSnapshotWithContent.html,
      ),
    [currentSnapshotWithContent],
  );

  // AOI rectangles active at the current replay time. Falls back to the
  // most recent snapshot's `aois`; we prefer the full-content variant
  // when fetched (carries the freshest data), then the bare snapshot
  // list (still has aois — it's lightweight JSON, comes back on the
  // /replay payload). Null means: no AOI capture for this snapshot.
  const currentAois = useMemo<SessionReplayAoiRect[] | null>(() => {
    const fromContent = currentSnapshotWithContent?.aois;
    if (Array.isArray(fromContent) && fromContent.length > 0) return fromContent;
    const fromList = currentSnapshot?.aois;
    if (Array.isArray(fromList) && fromList.length > 0) return fromList;
    return null;
  }, [currentSnapshot, currentSnapshotWithContent]);

  // Session-wide gaze-coverage breakdown by AOI region.
  //
  // For every gaze sample we look up the nearest-in-time snapshot
  // (snapshots are at ~1Hz, gaze at 10-30Hz, so the snapshot's AOI
  // rects are a fair proxy for the layout at that moment). We then
  // check which region — if any — contains the gaze point. Regions
  // are sorted by area ASC so a smaller inner region (e.g.
  // pdf-viewer) wins over the lesson container it sits inside.
  //
  // Samples falling outside every region are counted as 'outside';
  // samples landing on snapshots without AOI capture are counted as
  // 'no-aoi' and excluded from the coverage percentages (denominator
  // is samples that *could* be allocated).
  const aoiCoverage = useMemo(() => {
    if (!data || data.snapshots.length === 0) return null;
    const snapshots = data.snapshots;
    const counts: Record<string, number> = {};
    let totalWithAoi = 0;
    let outside = 0;
    let noAoi = 0;
    let snapshotIdx = 0;
    // Linear pass — both arrays are sorted by time, so we advance
    // snapshotIdx as needed instead of binary-searching each sample.
    for (const g of data.gazeLogs) {
      const ts = new Date(g.timestamp).getTime();
      while (snapshotIdx + 1 < snapshots.length && snapshots[snapshotIdx + 1]!.capturedAt <= ts) {
        snapshotIdx += 1;
      }
      const snap = snapshots[snapshotIdx];
      const aois = snap?.aois;
      if (!Array.isArray(aois) || aois.length === 0) {
        noAoi += 1;
        continue;
      }
      const sorted = [...aois].sort((a, b) => a.width * a.height - b.width * b.height);
      let hit: string | null = null;
      for (const r of sorted) {
        if (
          g.gazeX >= r.x &&
          g.gazeX < r.x + r.width &&
          g.gazeY >= r.y &&
          g.gazeY < r.y + r.height
        ) {
          hit = r.region;
          break;
        }
      }
      totalWithAoi += 1;
      if (hit) counts[hit] = (counts[hit] ?? 0) + 1;
      else outside += 1;
    }
    return { counts, outside, noAoi, totalWithAoi, totalGaze: data.gazeLogs.length };
  }, [data]);

  // ─── AOI scoring (prompt 05) ─────────────────────────
  // Computes per-AOI PDT over the masked valid-study window plus per-
  // epoch observed-vs-expected alignment. Re-runs whenever data,
  // researcher params, the time-range slice, or the weight table
  // changes. Range params come from the Filter-A text inputs (parsed
  // via the same helper the CSV exporter uses).
  const aoiScoring = useMemo(() => {
    if (!data) return null;
    const startMs = aoiFilterMode === 'A' ? parseTimeOffsetMs(aoiWindowStartText) : null;
    const endMs = aoiFilterMode === 'A' ? parseTimeOffsetMs(aoiWindowEndText) : null;
    return computeAoiScoring({
      baseWallClockMs,
      durationMs,
      snapshots: data.snapshots,
      gazeLogs: data.gazeLogs,
      visibilityLogs: data.visibilityLogs ?? [],
      activityLogs: data.activityLogs ?? [],
      params: {
        ...aoiParams,
        windowStartMs: startMs ?? undefined,
        windowEndMs: endMs ?? undefined,
      },
      expectedWeights,
    });
  }, [
    data,
    baseWallClockMs,
    durationMs,
    aoiParams,
    aoiWindowStartText,
    aoiWindowEndText,
    aoiFilterMode,
    expectedWeights,
  ]);

  const currentViewport = useMemo(() => {
    if (!data) return null;
    const logs = data.viewportLogs;
    let selected = logs[0] ?? null;
    for (const log of logs) {
      if (log.timestamp <= currentAbsoluteMs) selected = log;
      else break;
    }
    return (
      selected ??
      (currentSnapshot ? { width: currentSnapshot.width, height: currentSnapshot.height } : null)
    );
  }, [currentAbsoluteMs, currentSnapshot, data]);

  const currentScrollY = useMemo(() => {
    if (!data) return currentSnapshot?.scrollY ?? 0;
    let scrollY = currentSnapshot?.scrollY ?? 0;
    for (const log of data.scrollLogs) {
      if (log.timestamp <= currentAbsoluteMs) scrollY = log.scrollY;
      else break;
    }
    return scrollY;
  }, [currentAbsoluteMs, currentSnapshot, data]);

  const currentGaze = useMemo(() => {
    if (!data) return null;
    let selected = null;
    for (const log of data.gazeLogs) {
      const ts = new Date(log.timestamp).getTime();
      if (ts <= currentAbsoluteMs) selected = { ...log, timestampMs: ts };
      else break;
    }
    if (!selected) return null;
    if (currentAbsoluteMs - selected.timestampMs > 1_500) return null;
    return selected;
  }, [currentAbsoluteMs, data]);

  const currentClick = useMemo(() => {
    if (!data) return null;
    for (let index = data.clickLogs.length - 1; index >= 0; index -= 1) {
      const click = data.clickLogs[index]!;
      if (click.timestamp <= currentAbsoluteMs) {
        if (currentAbsoluteMs - click.timestamp <= 900) return click;
        return null;
      }
    }
    return null;
  }, [currentAbsoluteMs, data]);

  const currentPupil = useMemo(() => {
    if (!data) return null;
    let selected: ({ timestampMs: number } & (typeof data.pupilLogs)[number]) | null = null;
    for (const log of data.pupilLogs) {
      const timestampMs = new Date(log.timestamp).getTime();
      if (timestampMs <= currentAbsoluteMs) selected = { ...log, timestampMs };
      else break;
    }
    if (!selected) return null;
    if (currentAbsoluteMs - selected.timestampMs > 1_500) return null;
    return selected;
  }, [currentAbsoluteMs, data]);

  const currentEmotionFrame = useMemo(() => {
    if (!data) return null;
    let selected: (typeof data.emotionFrames)[number] | null = null;
    let selectedDelta = Number.POSITIVE_INFINITY;
    for (const frame of data.emotionFrames) {
      const delta = Math.abs(frame.frameWallMs - currentAbsoluteMs);
      if (delta < selectedDelta) {
        selected = frame;
        selectedDelta = delta;
      }
    }
    if (!selected) return null;
    if (selectedDelta > 10_000) return null;
    return selected;
  }, [currentAbsoluteMs, data]);

  const currentAuResult = useMemo(() => {
    if (!data) return null;
    let selected: ({ wallTimeMs: number } & (typeof data.auResults)[number]) | null = null;
    let selectedDelta = Number.POSITIVE_INFINITY;
    for (const result of data.auResults) {
      const wallTimeMs = new Date(result.wallTime).getTime();
      const delta = Math.abs(wallTimeMs - currentAbsoluteMs);
      if (delta < selectedDelta) {
        selected = { ...result, wallTimeMs };
        selectedDelta = delta;
      }
    }
    if (!selected) return null;
    if (selectedDelta > 10_000) return null;
    return selected;
  }, [currentAbsoluteMs, data]);

  const currentRecordingSegment = useMemo(() => {
    const segments = data?.diagnostics?.recordingSegments ?? [];
    if (!segments.length) return null;

    let selected = segments[0] ?? null;
    for (const segment of segments) {
      const startMs = new Date(segment.startWallTime).getTime();
      const endMs = segment.endWallTime
        ? new Date(segment.endWallTime).getTime()
        : Number.POSITIVE_INFINITY;
      if (currentAbsoluteMs >= startMs && currentAbsoluteMs <= endMs) {
        selected = segment;
        break;
      }
      if (startMs <= currentAbsoluteMs) selected = segment;
    }
    return selected;
  }, [currentAbsoluteMs, data?.diagnostics?.recordingSegments]);

  useEffect(() => {
    const segmentId = currentRecordingSegment?.id;
    if (!segmentId || Object.prototype.hasOwnProperty.call(segmentVideoUrls, segmentId)) return;

    let cancelled = false;
    api
      .get<{ url: string }>(`/recording/segments/${segmentId}/download`)
      .then(({ url }) => {
        if (cancelled) return;
        setSegmentVideoUrls((prev) => ({ ...prev, [segmentId]: url }));
      })
      .catch(() => {
        if (cancelled) return;
        setSegmentVideoUrls((prev) => ({ ...prev, [segmentId]: null }));
      });

    return () => {
      cancelled = true;
    };
  }, [currentRecordingSegment?.id, segmentVideoUrls]);

  useEffect(() => {
    const video = cameraVideoRef.current;
    if (!video || !currentRecordingSegment) return;

    const startMs = new Date(currentRecordingSegment.startWallTime).getTime();
    const targetSeconds = Math.max(0, (currentAbsoluteMs - startMs) / 1000);
    if (Math.abs(video.currentTime - targetSeconds) > 0.75) {
      video.currentTime = targetSeconds;
    }

    if (isPlaying) {
      void video.play().catch(() => {
        // Ignore autoplay restriction errors.
      });
    } else {
      video.pause();
    }
  }, [currentAbsoluteMs, currentRecordingSegment, isPlaying]);

  const topAus = useMemo(() => {
    if (!currentAuResult) return [];
    return Object.entries(AU_LABELS)
      .map(([key, label]) => ({
        key,
        label,
        value: currentAuResult[key as keyof typeof currentAuResult] as number | null | undefined,
      }))
      .filter((entry) => typeof entry.value === 'number' && Number.isFinite(entry.value))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      .slice(0, 6);
  }, [currentAuResult]);

  const learningState = useMemo(() => {
    if (!currentEmotionFrame) return null;
    return predictLearningState(
      {
        neutral: currentEmotionFrame.pNeutral ?? 0,
        disgust: currentEmotionFrame.pDisgust ?? 0,
        happy: currentEmotionFrame.pHappiness ?? 0,
        sad: currentEmotionFrame.pSadness ?? 0,
        anger: currentEmotionFrame.pAnger ?? 0,
        surprise: currentEmotionFrame.pSurprise ?? 0,
        fear: currentEmotionFrame.pFear ?? 0,
      },
      learningThresholds,
    );
  }, [currentEmotionFrame, learningThresholds]);

  const failedPyfeatJobs = useMemo(
    () => (data?.diagnostics?.pyfeatJobs ?? []).filter((job) => job.status === 'FAILED'),
    [data?.diagnostics?.pyfeatJobs],
  );

  const chartSeries = useMemo(() => {
    if (!data || durationMs <= 0) return [];
    const series: Array<{ key: SignalKey; label: string; color: string; points: string }> = [];

    const pushSeries = (
      key: SignalKey,
      label: string,
      color: string,
      samples: Array<{ timeMs: number; value: number }>,
    ) => {
      if (!selectedSignals.has(key)) return;
      const points = samples
        .filter((sample) => Number.isFinite(sample.value))
        .map((sample) => {
          const rel = Math.min(1, Math.max(0, (sample.timeMs - baseWallClockMs) / durationMs));
          const x = rel * 1000;
          const y = 180 - Math.min(1, Math.max(0, sample.value)) * 160;
          return `${x},${y}`;
        })
        .join(' ');
      if (points) series.push({ key, label, color, points });
    };

    for (const signal of EMOTION_SIGNALS) {
      const prop = `p${signal.key.charAt(0).toUpperCase()}${signal.key.slice(1)}` as
        | 'pHappiness'
        | 'pSadness'
        | 'pSurprise'
        | 'pFear'
        | 'pAnger'
        | 'pDisgust'
        | 'pContempt'
        | 'pNeutral';
      pushSeries(
        signal.key,
        signal.label,
        signal.color,
        data.emotionFrames.map((frame) => ({
          timeMs: frame.frameWallMs,
          value: Number(frame[prop] ?? Number.NaN),
        })),
      );
    }

    for (const signal of LEARNING_STATE_SIGNALS) {
      pushSeries(
        signal.key,
        signal.label,
        signal.color,
        data.emotionFrames.map((frame) => {
          const scores = predictLearningState(
            {
              neutral: frame.pNeutral ?? 0,
              disgust: frame.pDisgust ?? 0,
              happy: frame.pHappiness ?? 0,
              sad: frame.pSadness ?? 0,
              anger: frame.pAnger ?? 0,
              surprise: frame.pSurprise ?? 0,
              fear: frame.pFear ?? 0,
            },
            learningThresholds,
          ).scores;
          const value =
            signal.key === 'engagementScore'
              ? scores.engagement
              : signal.key === 'boredomScore'
                ? scores.boredom
                : signal.key === 'confusionScore'
                  ? scores.confusion
                  : scores.frustration;
          return {
            timeMs: frame.frameWallMs,
            value,
          };
        }),
      );
    }

    for (const signal of AU_SIGNALS) {
      pushSeries(
        signal.key,
        signal.label,
        signal.color,
        data.auResults.map((result) => ({
          timeMs: new Date(result.wallTime).getTime(),
          value: Number(result[signal.key] ?? Number.NaN),
        })),
      );
    }

    return series;
  }, [baseWallClockMs, data, durationMs, learningThresholds, selectedSignals]);

  useEffect(() => {
    // Only sync the visible buffer — the hidden one is mid-load or
    // holds a stale frame and shouldn't scroll-jump in the background
    // (the swap handler will scroll-restore it before it appears).
    if (visibleBufferIdx == null) return;
    const iframe = iframeRefs[visibleBufferIdx].current;
    if (!iframe) return;
    try {
      iframe.contentWindow?.scrollTo(currentSnapshot?.scrollX ?? 0, currentScrollY);
    } catch {
      // Ignore iframe scroll sync failures
    }
  }, [currentScrollY, currentSnapshot, visibleBufferIdx, iframeRefs]);

  // Drives the load + swap. Fires whenever the target snapshot
  // changes; this effect is the *only* place that writes a new
  // srcDoc into a buffer, which is what guarantees we don't reassign
  // on every tick. Defined here (below `currentScrollY`) rather than
  // up near the buffer state because we need the scroll value to
  // scroll-restore on swap.
  useEffect(() => {
    const target = currentSnapshotWithContent;
    latestTargetSnapshotIdRef.current = target?.id ?? null;
    if (!target) return;
    // Critical: bail when the snapshot's html hasn't been fetched yet.
    //
    // `currentSnapshotWithContent` falls back to the bare list row
    // (no `html`) whenever the on-demand fetch for the new snapshot
    // hasn't resolved. Without this guard the effect would write
    // `injectBaseForIframe(undefined, ...)` → empty string → load an
    // empty document into the hidden buffer, fire onLoad almost
    // instantly, and swap to a blank frame. THAT is the flash you
    // were seeing.
    //
    // Bailing means the previously visible buffer keeps its rendered
    // content on screen until `fetchSnapshotContent` resolves and
    // re-runs this effect with the populated html.
    if (!target.html) return;
    // Already on screen? Nothing to do.
    if (visibleBufferIdx != null && iframeBuffers[visibleBufferIdx].snapshotId === target.id) {
      return;
    }
    // Pick the load target. Before the first swap, load into buffer 0
    // directly so we don't waste a frame on the blank state.
    const loadIdx: 0 | 1 = visibleBufferIdx == null ? 0 : ((1 - visibleBufferIdx) as 0 | 1);
    const hidden = iframeBuffers[loadIdx];
    if (hidden.snapshotId === target.id) {
      // The hidden buffer already targets this snapshot. Two
      // sub-cases:
      //   - It finished loading earlier (user scrubbed back onto a
      //     recently shown frame, or our previous effect-run wrote
      //     this srcDoc and onLoad has fired). Safe to swap now.
      //   - It's still loading (this is the bug the isLoaded flag
      //     guards: setIframeBuffers re-runs the effect synchronously,
      //     and we used to flip visibility before the browser had
      //     even parsed the new document). Wait for onLoad.
      if (hidden.isLoaded) {
        const iframe = iframeRefs[loadIdx].current;
        try {
          iframe?.contentWindow?.scrollTo(target.scrollX ?? 0, currentScrollY);
        } catch {
          // Cross-origin / detached frame — ignore.
        }
        // Re-apply inner-scroll positions on the pre-loaded buffer.
        // It carries the captured `data-replay-scroll-top` attrs but
        // a previous swap may have left its containers in a
        // different state. Goes through the same helper as the
        // initial onLoad path so the PDF-page fallback +
        // typed-scrollHosts payload restore stays consistent.
        applyInnerScrollRestore(iframe, target);
        setVisibleBufferIdx(loadIdx);
      }
      return;
    }
    // Fresh load → write the new srcDoc into the hidden slot.
    const newSrcDoc = injectBaseForIframe(target.html, target.pageUrl);
    srcDocAssignCountRef.current += 1;
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug(
        `[replay] srcDoc reassign #${srcDocAssignCountRef.current} → buffer ${loadIdx} → snapshot ${target.id}`,
      );
    }
    setIframeBuffers((prev) => {
      const next: [IframeBufferState, IframeBufferState] = [prev[0], prev[1]];
      // Marking isLoaded=false here is what stops the *next* effect
      // run (triggered by this setState) from flipping visibility
      // prematurely.
      next[loadIdx] = { snapshotId: target.id, srcDoc: newSrcDoc, isLoaded: false };
      return next;
    });
    // The actual visibility flip happens in the buffer's onLoad
    // handler so the hidden iframe is fully painted before reveal.
  }, [currentSnapshotWithContent, visibleBufferIdx, iframeBuffers, currentScrollY, iframeRefs]);

  const handleBufferLoaded = useCallback(
    (idx: 0 | 1) => () => {
      const buffer = iframeBuffers[idx];
      // The initial render fires onLoad on both empty iframes
      // (`srcDoc=''`). Bail before we touch state.
      if (!buffer.snapshotId) return;
      // Stale load — the user scrubbed past us before we finished.
      // The next effect run will write the latest target into the
      // OTHER buffer, so just drop this one on the floor (but still
      // mark it loaded so a later scrub-back can reuse it).
      const isStale = buffer.snapshotId !== latestTargetSnapshotIdRef.current;
      // Mark this buffer as parsed-and-painted. This unlocks the
      // "pre-loaded swap" branch in the load-effect.
      setIframeBuffers((prev) => {
        if (prev[idx].isLoaded) return prev; // idempotent
        const next: [IframeBufferState, IframeBufferState] = [prev[0], prev[1]];
        next[idx] = { ...next[idx], isLoaded: true };
        return next;
      });
      if (isStale) return;
      // Restore scroll inside the iframe BEFORE it becomes visible so
      // content doesn't jump on the swap.
      const iframe = iframeRefs[idx].current;
      try {
        iframe?.contentWindow?.scrollTo(currentSnapshotWithContent?.scrollX ?? 0, currentScrollY);
      } catch {
        // Cross-origin / detached frame — ignore.
      }
      // Restore per-element scroll positions for inner scroll
      // containers (PDF reader's scroll, lesson MDX overflow, etc.).
      // applyInnerScrollRestore() drives this from the parent (the
      // iframe sandbox is allow-same-origin ONLY — no scripts run
      // inside, so we can't post a script in to do this) and retries
      // a few times because canvas → <img> replacements in the
      // captured DOM decode asynchronously: at iframe.onload the
      // scroll-host's scrollHeight may still be 0, which silently
      // clamps a captured scrollTop=5000 to 0 (the "PDF is static"
      // symptom). PDF page anchor (`data-replay-pdf-page`) acts as a
      // fallback scrollIntoView target once images have decoded.
      applyInnerScrollRestore(iframe, currentSnapshotWithContent);
      if (idx !== visibleBufferIdx) {
        setVisibleBufferIdx(idx);
      }
    },
    [iframeBuffers, visibleBufferIdx, currentSnapshotWithContent, currentScrollY, iframeRefs],
  );

  const viewportWidth = currentViewport?.width ?? currentSnapshot?.width ?? 1280;
  const viewportHeight = currentViewport?.height ?? currentSnapshot?.height ?? 720;
  const scaledViewportWidth = Math.max(1, Math.round(viewportWidth * contentScale));
  const scaledViewportHeight = Math.max(1, Math.round(viewportHeight * contentScale));

  useEffect(() => {
    const host = viewportHostRef.current;
    if (!host) return;

    const updateScale = () => {
      const available = host.clientWidth;
      if (!available || !viewportWidth) return;
      setContentScale(Math.min(1, available / viewportWidth));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(host);
    window.addEventListener('resize', updateScale);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateScale);
    };
  }, [viewportWidth]);

  if (isLoading) {
    return <div className="text-xs text-gray-400 text-center py-12">Loading replay…</div>;
  }

  if (error) {
    return <div className="text-sm text-red-500">Failed to load replay: {error}</div>;
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-sm text-gray-500">
        Replay metadata not available.
      </div>
    );
  }

  if (isLoadingSnapshots && data.snapshots.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-sm text-gray-500">
        Loading full-detail replay snapshots ({snapshotLoadProgress.loaded} /{' '}
        {snapshotLoadProgress.total || '?'}).
      </div>
    );
  }

  if (data.snapshots.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-sm text-gray-500">
        No DOM replay snapshots have been recorded for this session yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <button
          onClick={() => setIsPlaying((prev) => !prev)}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          onClick={() => {
            setIsPlaying(false);
            setCurrentTimeMs(0);
          }}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Restart
        </button>
        <input
          type="range"
          min={0}
          max={durationMs}
          value={currentTimeMs}
          onChange={(event) => {
            setIsPlaying(false);
            setCurrentTimeMs(Number(event.target.value));
          }}
          className="min-w-[240px] flex-1"
        />
        <div className="text-xs font-mono text-gray-500">
          {formatDuration(currentTimeMs)} / {formatDuration(durationMs)}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-gray-900">Signal Timeline</h3>
          <div className="flex items-center gap-3">
            <div className="text-xs text-gray-500">Click chart to seek replay</div>
            <button
              onClick={handleExportCsv}
              disabled={!data || isExportingCsv}
              className="text-xs px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 transition-colors"
            >
              {isExportingCsv ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        </div>
        <div className="mb-3 flex max-h-24 flex-wrap gap-2 overflow-y-auto">
          {[...EMOTION_SIGNALS, ...LEARNING_STATE_SIGNALS, ...AU_SIGNALS].map((signal) => {
            const active = selectedSignals.has(signal.key);
            return (
              <button
                key={signal.key}
                type="button"
                onClick={() =>
                  setSelectedSignals((prev) => {
                    const next = new Set(prev);
                    if (next.has(signal.key)) next.delete(signal.key);
                    else next.add(signal.key);
                    return next;
                  })
                }
                className={`rounded-full border px-2 py-1 text-[11px] ${
                  active
                    ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                    : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                <span
                  className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ backgroundColor: signal.color }}
                />
                {signal.label}
              </button>
            );
          })}
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-2">
          <svg
            viewBox="0 0 1000 220"
            className="h-56 w-full min-w-[680px]"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
              setIsPlaying(false);
              setCurrentTimeMs(Math.round(durationMs * ratio));
            }}
          >
            <line x1="0" y1="180" x2="1000" y2="180" stroke="#d1d5db" strokeWidth="1" />
            <line x1="0" y1="20" x2="0" y2="180" stroke="#d1d5db" strokeWidth="1" />
            <line
              x1="0"
              y1="20"
              x2="1000"
              y2="20"
              stroke="#e5e7eb"
              strokeDasharray="4 4"
              strokeWidth="1"
            />
            <line
              x1="0"
              y1="100"
              x2="1000"
              y2="100"
              stroke="#e5e7eb"
              strokeDasharray="4 4"
              strokeWidth="1"
            />
            {(() => {
              // X-axis time ticks. Step is chosen from a human-friendly
              // ladder so a 4 h session gets 30-min ticks, a 5 min
              // session gets 30 s ticks, etc. Both relative (mm:ss /
              // h:mm:ss) and absolute wall-clock labels are shown so
              // the teacher can match the timeline to external events.
              const stepMs = chooseTickStepMs(durationMs);
              const ticks: Array<{ x: number; relLabel: string; wallLabel: string }> = [];
              for (let t = 0; t <= durationMs + 1; t += stepMs) {
                const x = (t / durationMs) * 1000;
                ticks.push({
                  x,
                  relLabel: formatTickLabel(t),
                  wallLabel: formatTimestamp(baseWallClockMs + t),
                });
              }
              return ticks.map((tick, i) => (
                <g key={`tick-${i}`}>
                  <line
                    x1={tick.x}
                    y1="180"
                    x2={tick.x}
                    y2="186"
                    stroke="#9ca3af"
                    strokeWidth="1"
                  />
                  <line x1={tick.x} y1="20" x2={tick.x} y2="180" stroke="#f3f4f6" strokeWidth="1" />
                  <text
                    x={tick.x}
                    y="198"
                    textAnchor="middle"
                    fill="#374151"
                    fontSize="10"
                    fontFamily="monospace"
                  >
                    {tick.relLabel}
                  </text>
                  <text
                    x={tick.x}
                    y="212"
                    textAnchor="middle"
                    fill="#9ca3af"
                    fontSize="9"
                    fontFamily="monospace"
                  >
                    {tick.wallLabel}
                  </text>
                </g>
              ));
            })()}
            {(
              [
                {
                  signalKey: 'engagementScore' as SignalKey,
                  label: `Eng threshold ${learningThresholds.engagement_score.toFixed(2)}`,
                  color: '#16a34a',
                  value: learningThresholds.engagement_score,
                },
                {
                  signalKey: 'boredomScore' as SignalKey,
                  label: `Boredom threshold ${learningThresholds.boredom_score.toFixed(2)}`,
                  color: '#6b7280',
                  value: learningThresholds.boredom_score,
                },
              ] satisfies Array<{
                signalKey: SignalKey;
                label: string;
                color: string;
                value: number;
              }>
            )
              .filter((guide) => selectedSignals.has(guide.signalKey))
              .map((guide) => {
                const y = 180 - Math.min(1, Math.max(0, guide.value)) * 160;
                return (
                  <g key={guide.signalKey}>
                    <line
                      x1="0"
                      y1={y}
                      x2="1000"
                      y2={y}
                      stroke={guide.color}
                      strokeWidth="1.5"
                      strokeDasharray="6 4"
                      opacity="0.9"
                    />
                    <text
                      x="995"
                      y={Math.max(12, y - 4)}
                      textAnchor="end"
                      fill={guide.color}
                      fontSize="10"
                      fontWeight="600"
                    >
                      {guide.label}
                    </text>
                  </g>
                );
              })}
            {chartSeries.map((series) => (
              <polyline
                key={series.key}
                points={series.points}
                fill="none"
                stroke={series.color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {/* Annotation bands (range) + ticks (point). Drawn just
                above the playhead line so they stay visible. x maps
                offsetMs → 0..1000 with the same scale used by every
                other element in this SVG. */}
            {annotationsApi.annotations.map((a) => {
              const x = Math.max(0, Math.min(1000, (a.startMs / durationMs) * 1000));
              const color = a.code?.color ?? '#94a3b8';
              if (a.endMs != null && a.endMs > a.startMs) {
                const x2 = Math.max(0, Math.min(1000, (a.endMs / durationMs) * 1000));
                return (
                  <g key={a.id}>
                    <rect
                      x={x}
                      y={185}
                      width={Math.max(1, x2 - x)}
                      height={5}
                      fill={color}
                      opacity={0.7}
                    >
                      <title>
                        {a.code?.label ?? 'annotation'}: {a.note ?? ''}
                      </title>
                    </rect>
                  </g>
                );
              }
              return (
                <g key={a.id}>
                  <line x1={x} y1={185} x2={x} y2={194} stroke={color} strokeWidth={2}>
                    <title>
                      {a.code?.label ?? 'annotation'}: {a.note ?? ''}
                    </title>
                  </line>
                </g>
              );
            })}
            <line
              x1={(currentTimeMs / durationMs) * 1000}
              y1="20"
              x2={(currentTimeMs / durationMs) * 1000}
              y2="180"
              stroke="#111827"
              strokeWidth="2"
              opacity="0.7"
            />
          </svg>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-2xl border border-gray-200 bg-slate-950 p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3 text-xs text-slate-200">
            <span>Original viewport size</span>
            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  checked={showAoiOverlay}
                  onChange={(e) => setShowAoiOverlay(e.target.checked)}
                  className="h-3 w-3 cursor-pointer"
                />
                <span>AOI overlay</span>
                {currentAois && currentAois.length > 0 ? (
                  <span className="font-mono text-slate-400">({currentAois.length})</span>
                ) : null}
              </label>
              <span className="font-mono">
                {viewportWidth} x {viewportHeight}
              </span>
            </div>
          </div>
          <div
            ref={viewportHostRef}
            className="max-h-[75vh] overflow-auto rounded-xl border border-slate-700 bg-slate-900 p-3"
          >
            <div className="mb-3 rounded-lg border border-slate-700 bg-slate-950/50 p-2">
              <div className="mb-2 flex items-center justify-between text-[11px] text-slate-300">
                <span>Pixel Replay (1 FPS)</span>
                <span className="font-mono">
                  {formatTimestamp(currentAbsoluteMs)}
                  {isUsingDomFallbackImage ? ' • DOM fallback' : ''}
                </span>
              </div>
              {currentSnapshotImageDataUrl ? (
                // Double-buffered <img>. Both stacked at the same
                // position; only the visible one is at opacity 1.
                // The hidden one decodes the next data URL in the
                // background — when its onLoad fires, we swap. No
                // mid-decode blank frame, no flash.
                <div
                  className="relative w-full"
                  style={{
                    aspectRatio: `${Math.max(1, viewportWidth)} / ${Math.max(1, viewportHeight)}`,
                  }}
                >
                  {[0, 1].map((idx) => {
                    const buffer = imageBuffers[idx as 0 | 1];
                    const isVisible = visibleImageBufferIdx === idx;
                    if (!buffer.src) return null;
                    return (
                      <img
                        key={idx}
                        src={buffer.src}
                        alt={`Pixel screenshot replay (buffer ${idx})`}
                        onLoad={handleImageBufferLoaded(idx as 0 | 1)}
                        className="absolute inset-0 h-full w-full rounded-md border border-slate-700 bg-black object-contain"
                        style={{
                          opacity: isVisible ? 1 : 0,
                          // Hide the back buffer from AT and pointer hits.
                          pointerEvents: 'none',
                        }}
                      />
                    );
                  })}
                </div>
              ) : !hasCurrentSnapshotContent ? (
                <div className="flex aspect-video items-center justify-center rounded-md bg-slate-900 text-xs text-slate-400">
                  Loading pixel snapshot...
                </div>
              ) : (
                <div className="flex aspect-video items-center justify-center rounded-md bg-slate-900 text-xs text-slate-400">
                  No pixel snapshot available.
                </div>
              )}
            </div>
            <div
              className="relative overflow-hidden rounded-lg bg-white shadow-[0_0_0_1px_rgba(148,163,184,0.25)]"
              style={{
                width: `${scaledViewportWidth}px`,
                height: `${scaledViewportHeight}px`,
                minWidth: `${scaledViewportWidth}px`,
                minHeight: `${scaledViewportHeight}px`,
              }}
            >
              {/* Double-buffered playback. Two stacked iframes. Both
                  stay at opacity 1; the swap is a z-index flip rather
                  than an opacity cross-fade. The opacity approach
                  briefly showed BOTH iframes at non-1 opacity during
                  the transition, which let the white wrapper bleed
                  through and read as a flash. With z-index, the back
                  iframe is fully painted but covered by the front
                  one (both have `bg-white`), so the swap is a single-
                  frame jump-cut to the new content with no
                  intermediate visual state.
                  The visible iframe owns pointer events so the back
                  one (which may be mid-parse) can't accidentally
                  intercept scrolls / clicks. */}
              {[0, 1].map((idx) => {
                const buffer = iframeBuffers[idx as 0 | 1];
                const isVisible = visibleBufferIdx === idx;
                return (
                  <iframe
                    key={idx}
                    ref={iframeRefs[idx as 0 | 1]}
                    title={`Session replay (buffer ${idx})`}
                    // allow-same-origin lets the iframe fetch
                    // stylesheets / images from the rebased absolute
                    // URLs we inject via <base>. Scripts stay disabled
                    // — captured DOM is untrusted user content; we
                    // don't want it executing.
                    sandbox="allow-same-origin"
                    srcDoc={buffer.srcDoc}
                    onLoad={handleBufferLoaded(idx as 0 | 1)}
                    className="absolute left-0 top-0 bg-white"
                    style={{
                      width: `${viewportWidth}px`,
                      height: `${viewportHeight}px`,
                      transform: `scale(${contentScale})`,
                      transformOrigin: 'top left',
                      // z-index 2 (front) vs 1 (back). Both > 0 so
                      // they sit above the wrapper's background but
                      // below the gaze/click/AOI overlay layers
                      // (z-10+).
                      zIndex: isVisible ? 2 : 1,
                      // Both buffers: pointer-events:none. The replay
                      // is read-only — if we let events reach the
                      // iframe, the teacher could scroll the PDF /
                      // click links inside the captured DOM, which
                      // would diverge the displayed view from the
                      // recorded state. Seek/playback affordances all
                      // live OUTSIDE the iframe (the SVG timeline,
                      // the seek bar) so blocking iframe events
                      // doesn't lose any researcher capability.
                      pointerEvents: 'none',
                    }}
                  />
                );
              })}

              {currentGaze && (
                <div
                  className="pointer-events-none absolute z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-100 bg-cyan-400/80 shadow-[0_0_18px_rgba(34,211,238,0.8)]"
                  style={{
                    left: `${(currentGaze.gazeX / viewportWidth) * 100}%`,
                    top: `${(currentGaze.gazeY / viewportHeight) * 100}%`,
                  }}
                />
              )}

              {currentClick && (
                <div
                  className="pointer-events-none absolute z-10 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-200 bg-amber-400/25"
                  style={{
                    left: `${(currentClick.x / viewportWidth) * 100}%`,
                    top: `${(currentClick.y / viewportHeight) * 100}%`,
                  }}
                />
              )}

              {/* AOI rectangles. Rendered in the scaled container's
                  coordinate space — multiply each rect by contentScale
                  so it lines up exactly with the (also scaled) iframe.
                  Lower z-index than gaze/click dots so those stay on
                  top. pointer-events-none so they never block the
                  click-to-seek behaviour on the chart above. */}
              {showAoiOverlay &&
                currentAois?.map((rect, idx) => {
                  const color = aoiColor(rect.region);
                  return (
                    <div
                      key={`${rect.region}-${idx}`}
                      className="pointer-events-none absolute z-[5] border-2 text-[10px] font-mono"
                      style={{
                        left: `${rect.x * contentScale}px`,
                        top: `${rect.y * contentScale}px`,
                        width: `${rect.width * contentScale}px`,
                        height: `${rect.height * contentScale}px`,
                        borderColor: color.stroke,
                        backgroundColor: color.fill,
                        color: color.stroke,
                      }}
                    >
                      <span
                        className="absolute left-0 top-0 px-1 py-0.5 text-white"
                        style={{ backgroundColor: color.stroke }}
                      >
                        {rect.region}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600">
            <h3 className="text-sm font-semibold text-gray-900">Camera Frame</h3>
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-2">
              {currentRecordingSegment ? (
                segmentVideoUrls[currentRecordingSegment.id] === undefined ? (
                  <div className="flex aspect-video items-center justify-center rounded-md bg-gray-100 text-gray-500">
                    Loading camera segment...
                  </div>
                ) : segmentVideoUrls[currentRecordingSegment.id] ? (
                  <video
                    key={currentRecordingSegment.id}
                    ref={cameraVideoRef}
                    src={segmentVideoUrls[currentRecordingSegment.id] ?? undefined}
                    className="aspect-video w-full rounded-md bg-black"
                    muted
                    playsInline
                    controls
                    preload="metadata"
                  />
                ) : (
                  <div className="flex aspect-video items-center justify-center rounded-md bg-gray-100 text-gray-500">
                    Camera segment unavailable.
                  </div>
                )
              ) : (
                <div className="flex aspect-video items-center justify-center rounded-md bg-gray-100 text-gray-500">
                  No camera recording segment for current replay time.
                </div>
              )}
            </div>
            {currentRecordingSegment && (
              <p className="mt-2 text-[11px] text-gray-500">
                Segment window:{' '}
                {formatTimestamp(new Date(currentRecordingSegment.startWallTime).getTime())}
                {' - '}
                {currentRecordingSegment.endWallTime
                  ? formatTimestamp(new Date(currentRecordingSegment.endWallTime).getTime())
                  : 'ongoing'}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600">
            <h3 className="text-sm font-semibold text-gray-900">Facial Signals</h3>
            <div className="mt-3 space-y-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-400">
                  Emotion probabilities
                </p>
                {currentEmotionFrame ? (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {[
                      ['Happy', currentEmotionFrame.pHappiness],
                      ['Sad', currentEmotionFrame.pSadness],
                      ['Surprise', currentEmotionFrame.pSurprise],
                      ['Fear', currentEmotionFrame.pFear],
                      ['Anger', currentEmotionFrame.pAnger],
                      ['Disgust', currentEmotionFrame.pDisgust],
                      ['Contempt', currentEmotionFrame.pContempt],
                      ['Neutral', currentEmotionFrame.pNeutral],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-md bg-gray-50 px-2 py-1.5">
                        <div className="text-[11px] text-gray-500">{label}</div>
                        <div className="font-medium text-gray-800">
                          {typeof value === 'number' ? value.toFixed(2) : '-'}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2">No nearby emotion frame.</p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] uppercase tracking-wide text-gray-400">
                    Learning state
                  </p>
                  <button
                    type="button"
                    onClick={() => setLearningThresholds(DEFAULT_THRESHOLDS)}
                    className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50"
                  >
                    Reset thresholds
                  </button>
                </div>
                {learningState ? (
                  <div className="mt-2 space-y-2">
                    <div className="rounded-md bg-gray-50 px-2 py-1.5">
                      <div className="text-[11px] text-gray-500">Predicted state</div>
                      <div className="font-medium text-gray-800">{learningState.predicted}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(learningState.scores).map(([state, score]) => (
                        <div key={state} className="rounded-md bg-gray-50 px-2 py-1.5">
                          <div className="text-[11px] capitalize text-gray-500">{state} score</div>
                          <div className="font-medium text-gray-800">{score.toFixed(3)}</div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2 rounded-md border border-gray-200 bg-white p-2">
                      {(
                        [
                          ['engagement_score', 'Engagement score'],
                          ['boredom_score', 'Boredom score'],
                          ['confusion_surprise', 'Confusion surprise'],
                          ['confusion_fear', 'Confusion fear'],
                          ['confusion_anger', 'Confusion anger'],
                          ['confusion_disgust', 'Confusion disgust'],
                          ['frustration_sad', 'Frustration sad'],
                          ['frustration_anger', 'Frustration anger'],
                          ['frustration_disgust', 'Frustration disgust'],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key} className="block">
                          <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-gray-500">
                            <span>{label}</span>
                            <span className="font-mono text-gray-700">
                              {learningThresholds[key].toFixed(2)}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={learningThresholds[key]}
                            onChange={(event) => {
                              const nextValue = Number(event.target.value);
                              setLearningThresholds((prev) => ({ ...prev, [key]: nextValue }));
                            }}
                            className="w-full"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-2">No nearby emotion frame.</p>
                )}
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-400">
                  Top action units
                </p>
                <div className="mt-2 space-y-2">
                  {topAus.length > 0 ? (
                    topAus.map((au) => (
                      <div key={au.key} className="flex items-center justify-between gap-3">
                        <span className="font-medium text-gray-700">{au.label}</span>
                        <span className="font-mono text-gray-800">
                          {(au.value ?? 0).toFixed(2)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p>No nearby AU frame.</p>
                  )}
                </div>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-400">Pupil size</p>
                <div className="mt-2 rounded-md bg-gray-50 px-2 py-1.5">
                  <div className="text-[11px] text-gray-500">Pupil diameter</div>
                  <div className="font-medium text-gray-800">
                    {currentPupil
                      ? currentPupil.pupilDiameter.toFixed(2)
                      : 'No recent pupil sample'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-900">Replay State</h3>
            <dl className="mt-3 space-y-2 text-xs text-gray-600">
              <div className="flex items-start justify-between gap-3">
                <dt>URL</dt>
                <dd className="max-w-[210px] break-all text-right font-mono text-[11px]">
                  {currentSnapshot?.pageUrl}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt>Snapshot trigger</dt>
                <dd className="font-medium text-gray-800">{currentSnapshot?.trigger}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt>Viewport</dt>
                <dd className="font-medium text-gray-800">
                  {viewportWidth} x {viewportHeight}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt>Captured at</dt>
                <dd className="font-medium text-gray-800">
                  {currentSnapshot ? formatTimestamp(currentSnapshot.capturedAt) : 'Unknown'}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt>Scroll Y</dt>
                <dd className="font-medium text-gray-800">{Math.round(currentScrollY)} px</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt>Eye gaze</dt>
                <dd className="font-medium text-gray-800">
                  {currentGaze
                    ? `${Math.round(currentGaze.gazeX)}, ${Math.round(currentGaze.gazeY)}`
                    : 'No recent gaze sample'}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt>Expression</dt>
                <dd className="font-medium text-gray-800">
                  {currentEmotionFrame?.dominantEmotion ?? 'No recent face frame'}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt>Last click</dt>
                <dd className="max-w-[210px] text-right text-gray-800">
                  {currentClick?.elementText?.trim() || currentClick?.elementSelector || 'None'}
                </dd>
              </div>
            </dl>
          </div>

          {/* AOI Gaze Coverage. Computes once per data refresh from
              the full session's gaze samples + per-snapshot AOI rects.
              Renders nothing useful if no snapshots carried AOIs (e.g.
              session captured before the markers shipped) — shows a
              "no AOI capture" hint instead of misleading zero bars. */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600">
            <h3 className="text-sm font-semibold text-gray-900">Gaze Coverage by Region</h3>
            <div className="mt-3 space-y-2">
              {!aoiCoverage || aoiCoverage.totalWithAoi === 0 ? (
                <p className="text-gray-500">
                  No AOI capture for this session
                  {aoiCoverage && aoiCoverage.noAoi > 0
                    ? ` (${aoiCoverage.noAoi} gaze samples, ${aoiCoverage.totalGaze} total).`
                    : '.'}
                </p>
              ) : (
                <>
                  {Object.entries(aoiCoverage.counts)
                    .sort(([, a], [, b]) => b - a)
                    .map(([region, count]) => {
                      const pct = (count / aoiCoverage.totalWithAoi) * 100;
                      const color = aoiColor(region);
                      return (
                        <div key={region}>
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${color.chip}`}
                            >
                              {region}
                            </span>
                            <span className="font-mono text-gray-700">
                              {pct.toFixed(1)}% · {count}
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded bg-gray-100">
                            <div
                              className="h-full"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: color.stroke,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  {aoiCoverage.outside > 0 && (
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="rounded border border-gray-300 bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-700">
                          outside
                        </span>
                        <span className="font-mono text-gray-700">
                          {((aoiCoverage.outside / aoiCoverage.totalWithAoi) * 100).toFixed(1)}% ·{' '}
                          {aoiCoverage.outside}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded bg-gray-100">
                        <div
                          className="h-full bg-gray-400"
                          style={{
                            width: `${(aoiCoverage.outside / aoiCoverage.totalWithAoi) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                  <p className="mt-2 text-[11px] text-gray-500">
                    {aoiCoverage.totalWithAoi} of {aoiCoverage.totalGaze} gaze samples allocated
                    {aoiCoverage.noAoi > 0
                      ? ` · ${aoiCoverage.noAoi} on snapshots without AOI capture`
                      : ''}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Researcher annotations (prompt 06). Sidebar list + code
              manager + add controls. Bands/ticks on the Signal
              Timeline SVG are rendered separately so they line up
              with the rest of the timeline coordinates. */}
          <AnnotationsPanel
            annotations={annotationsApi.annotations}
            codes={annotationsApi.codes}
            currentTimeMs={currentTimeMs}
            durationMs={durationMs}
            onSeek={(offsetMs) => {
              const t = Math.max(0, Math.min(durationMs, offsetMs));
              setIsPlaying(false);
              setCurrentTimeMs(t);
            }}
            onCreate={annotationsApi.createAnnotation}
            onUpdate={annotationsApi.updateAnnotation}
            onDelete={annotationsApi.deleteAnnotation}
            onCreateCode={annotationsApi.createCode}
            onUpdateCode={annotationsApi.updateCode}
            onDeleteCode={annotationsApi.deleteCode}
          />

          {/* AOI Attention Scoring (prompt 05). PDT over a masked
              valid-study window + observed-vs-expected alignment per
              activity epoch (SEEV/EV). All params surfaced + editable
              so scores stay reproducible and assumptions visible. */}
          <AoiScoringPanel
            scoring={aoiScoring}
            filterMode={aoiFilterMode}
            onFilterModeChange={setAoiFilterMode}
            params={aoiParams}
            onParamsChange={setAoiParams}
            windowStartText={aoiWindowStartText}
            onWindowStartTextChange={setAoiWindowStartText}
            windowEndText={aoiWindowEndText}
            onWindowEndTextChange={setAoiWindowEndText}
            expectedWeights={expectedWeights}
            onExpectedWeightsChange={setExpectedWeights}
            durationMs={durationMs}
            currentTimeMs={currentTimeMs}
            onResetDefaults={() => {
              setAoiParams(DEFAULT_VALID_STUDY_PARAMS);
              setExpectedWeights(DEFAULT_EXPECTED_WEIGHTS);
              setAoiWindowStartText('');
              setAoiWindowEndText('');
            }}
          />

          <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600">
            <h3 className="text-sm font-semibold text-gray-900">Coverage</h3>
            <div className="mt-3 space-y-2">
              <p>{data.snapshots.length} DOM snapshots captured</p>
              {isLoadingSnapshots && (
                <p className="text-gray-500">
                  Loading remaining snapshots: {snapshotLoadProgress.loaded} /{' '}
                  {snapshotLoadProgress.total || data.snapshotCount || '?'}
                </p>
              )}
              <p>
                DOM cadence:{' '}
                {snapshotStats.averageGapMs
                  ? `avg every ${formatDuration(snapshotStats.averageGapMs)}`
                  : 'single snapshot only'}
              </p>
              <p>Recording mode: fixed periodic snapshots every 1s</p>
              <p>{data.clickLogs.length} click events recorded</p>
              <p>{data.gazeLogs.length} gaze samples recorded</p>
              <p>{data.pupilLogs.length} pupil-size samples recorded</p>
              <p>{data.scrollLogs.length} scroll updates recorded</p>
              <p>{data.emotionFrames.length} emotion frames available</p>
              <p>{data.auResults.length} AU frames available</p>
              {/* Per-source message counts. `chatbotFromFallback`
                  reveals turns whose session_id didn't match the
                  current session id but were recovered by the
                  student+time-window union — a non-zero value is a
                  signal that the chatbot's session-id wiring dropped
                  turns and is worth investigating. */}
              {data.diagnostics?.messageCounts && (
                <>
                  <p>
                    {data.diagnostics.messageCounts.dialogueFetched} dialogue turns ·{' '}
                    {data.diagnostics.messageCounts.chatbotFetched} chatbot turns
                  </p>
                  {data.diagnostics.messageCounts.chatbotFromFallback > 0 && (
                    <p className="text-amber-700">
                      ⚠ {data.diagnostics.messageCounts.chatbotFromFallback} chatbot turn(s)
                      recovered via student+time fallback (session id mismatch)
                    </p>
                  )}
                </>
              )}
              <p>
                {data.diagnostics?.recordingSegments.length ?? 0} recording segments in this session
              </p>
              <p>
                OpenFace3 jobs:{' '}
                {data.diagnostics?.openface3Jobs.length
                  ? data.diagnostics.openface3Jobs.map((job) => job.status).join(', ')
                  : 'none'}
              </p>
              <p>
                PyFeat jobs:{' '}
                {data.diagnostics?.pyfeatJobs.length
                  ? data.diagnostics.pyfeatJobs.map((job) => job.status).join(', ')
                  : 'none'}
              </p>
              {failedPyfeatJobs.length > 0 && (
                <div className="pt-2">
                  <button
                    type="button"
                    disabled={isRetryingPyfeat}
                    onClick={async () => {
                      setIsRetryingPyfeat(true);
                      try {
                        await Promise.all(
                          failedPyfeatJobs.map((job) => api.post(`/pyfeat/jobs/${job.id}/retry`)),
                        );
                        await refresh();
                      } finally {
                        setIsRetryingPyfeat(false);
                      }
                    }}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRetryingPyfeat
                      ? 'Retrying failed PyFeat jobs...'
                      : `Retry failed PyFeat jobs (${failedPyfeatJobs.length})`}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Unified event timeline — intervention activity + EF detections
          + dialogue and chatbot turns interleaved chronologically.
          Each row is a clickable seek target so the teacher can jump
          the replay to the exact moment the event occurred. */}
      <EventTimelinePanel
        activityLogs={data.activityLogs ?? []}
        efDetections={data.efDetections ?? []}
        dialogueMessages={data.dialogueMessages ?? []}
        chatbotMessages={data.chatbotMessages ?? []}
        baseWallClockMs={baseWallClockMs}
        durationMs={durationMs}
        onSeek={(absoluteMs) => {
          const target = Math.max(0, Math.min(durationMs, absoluteMs - baseWallClockMs));
          setIsPlaying(false);
          setCurrentTimeMs(target);
        }}
      />

      {/* Per-intervention drill-down. Lists every intervention in the
          session with score + Q&A pairs. Reuses the same seek
          plumbing as the event timeline above. */}
      <InterventionReviewPanel
        interventions={data.interventions ?? []}
        activityLogs={data.activityLogs ?? []}
        onSeek={(absoluteMs) => {
          const target = Math.max(0, Math.min(durationMs, absoluteMs - baseWallClockMs));
          setIsPlaying(false);
          setCurrentTimeMs(target);
        }}
      />
    </div>
  );
}

// ─── EventTimelinePanel ──────────────────────────────────
// Merges 4 backend event streams into one chronological list. Filters
// out high-frequency biometric/recording actions that would drown out
// the interesting ones — those already have dedicated tracks above.
// The panel is the simplest useful surface for the spec's "activity_log
// + ef_detection + dialogue_message + chatbot_message on a unified
// timeline" requirement. Could later evolve into an overlay on the SVG
// signal chart, but listing form is more readable and ships now.

type TimelineEvent = {
  id: string;
  kind: 'activity' | 'ef' | 'dialogue' | 'chatbot';
  timestampMs: number;
  label: string;
  detail: string;
  color: string;
};

// Actions worth showing in the unified timeline. Biometric / recording
// noise (SESSION_HEARTBEAT, *_BATCH_SUBMITTED, PYFEAT_*, WEBGAZER_*,
// PUPIL_*, RECORDING_SEGMENT_*) are filtered — they already live in
// their dedicated charts above and would drown out the signal here.
const TIMELINE_ACTIONS = new Set([
  'SESSION_START',
  'SESSION_END',
  'MODULE_OPENED',
  'MODULE_ITEM_VIEWED',
  'ASSESSMENT_STARTED',
  'ASSESSMENT_SUBMITTED',
  'QUESTION_VIEWED',
  'QUESTION_ANSWERED',
  'DIALOGUE_SESSION_STARTED',
  'DIALOGUE_SESSION_ENDED',
  'DIALOGUE_MESSAGE_SENT',
  'DIALOGUE_MESSAGE_RECEIVED',
  'CHATBOT_MESSAGE_SENT',
  'CHATBOT_MESSAGE_RECEIVED',
  'INTERVENTION_TRIGGERED',
  'INTERVENTION_VIEWED',
  'INTERVENTION_COMPLETED',
  'INTERVENTION_DISMISSED',
  // P5 — Practice Testing configuration event. Carries the student's
  // chosen mcq/short counts + coverage scope so post-analysis can
  // tell which test the student actually asked for.
  'PRACTICE_TEST_CONFIGURED',
  'SPACED_REP_CARD_VIEWED',
  'SPACED_REP_CARD_RATED',
  'MASTERY_UPDATED',
  'STUDY_MATERIAL_UPLOADED',
]);

const ACTION_COLORS: Record<string, string> = {
  SESSION_START: 'bg-green-100 text-green-800',
  SESSION_END: 'bg-gray-100 text-gray-700',
  INTERVENTION_TRIGGERED: 'bg-blue-100 text-blue-800',
  INTERVENTION_VIEWED: 'bg-blue-50 text-blue-700',
  INTERVENTION_COMPLETED: 'bg-emerald-100 text-emerald-800',
  INTERVENTION_DISMISSED: 'bg-amber-100 text-amber-800',
  // P5 — distinct chip so the config row visually anchors against
  // the broader INTERVENTION_TRIGGERED row that follows it.
  PRACTICE_TEST_CONFIGURED: 'bg-blue-50 text-blue-700',
  QUESTION_VIEWED: 'bg-indigo-50 text-indigo-700',
  QUESTION_ANSWERED: 'bg-indigo-100 text-indigo-800',
  SPACED_REP_CARD_VIEWED: 'bg-purple-50 text-purple-700',
  SPACED_REP_CARD_RATED: 'bg-purple-100 text-purple-800',
  DIALOGUE_MESSAGE_SENT: 'bg-cyan-100 text-cyan-800',
  DIALOGUE_MESSAGE_RECEIVED: 'bg-cyan-50 text-cyan-700',
  CHATBOT_MESSAGE_SENT: 'bg-sky-100 text-sky-800',
  CHATBOT_MESSAGE_RECEIVED: 'bg-sky-50 text-sky-700',
  MODULE_OPENED: 'bg-slate-100 text-slate-700',
  MODULE_ITEM_VIEWED: 'bg-slate-50 text-slate-600',
};

function formatTimelineClock(absoluteMs: number, baseWallClockMs: number): string {
  const offset = Math.max(0, absoluteMs - baseWallClockMs);
  const secs = Math.floor(offset / 1000);
  const mm = Math.floor(secs / 60)
    .toString()
    .padStart(2, '0');
  const ss = (secs % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

function EventTimelinePanel({
  activityLogs,
  efDetections,
  dialogueMessages,
  chatbotMessages,
  baseWallClockMs,
  durationMs,
  onSeek,
}: {
  activityLogs: NonNullable<ReturnType<typeof useSessionReplay>['data']>['activityLogs'] extends
    | infer T
    | undefined
    ? T
    : never;
  efDetections: NonNullable<ReturnType<typeof useSessionReplay>['data']>['efDetections'] extends
    | infer T
    | undefined
    ? T
    : never;
  dialogueMessages: NonNullable<
    ReturnType<typeof useSessionReplay>['data']
  >['dialogueMessages'] extends infer T | undefined
    ? T
    : never;
  chatbotMessages: NonNullable<
    ReturnType<typeof useSessionReplay>['data']
  >['chatbotMessages'] extends infer T | undefined
    ? T
    : never;
  baseWallClockMs: number;
  durationMs: number;
  onSeek: (absoluteMs: number) => void;
}) {
  const events = useMemo<TimelineEvent[]>(() => {
    const out: TimelineEvent[] = [];

    for (const log of activityLogs ?? []) {
      if (!TIMELINE_ACTIONS.has(log.action)) continue;
      const meta = (log.metadata ?? {}) as Record<string, unknown>;
      const itype = typeof meta.interventionType === 'string' ? ` · ${meta.interventionType}` : '';
      // Compose a short detail string per action so the row is
      // informative without expanding metadata into a full JSON view.
      let detail = '';
      if (log.action === 'QUESTION_ANSWERED') {
        const correct = meta.isCorrect;
        const latency =
          typeof meta.latencyMs === 'number' ? `${Math.round(meta.latencyMs / 100) / 10}s` : '';
        detail =
          `${correct === true ? '✓' : correct === false ? '✗' : ''} ${latency}${itype}`.trim();
      } else if (log.action === 'PRACTICE_TEST_CONFIGURED') {
        // P5 — render a compact human summary of what the student
        // chose: counts, coverage scope, and (when present) the
        // coverageFallback widening notice from P2.
        const mcq = typeof meta.mcqCount === 'number' ? meta.mcqCount : null;
        const sa = typeof meta.shortAnswerCount === 'number' ? meta.shortAnswerCount : null;
        const mode = typeof meta.coverageMode === 'string' ? meta.coverageMode : 'all';
        const pageStart = typeof meta.pageStart === 'number' ? meta.pageStart : null;
        const pageEnd = typeof meta.pageEnd === 'number' ? meta.pageEnd : null;
        const subtopic =
          typeof meta.subtopic === 'string' && meta.subtopic.trim() ? meta.subtopic.trim() : null;
        let scope = 'whole lesson';
        if (mode === 'pages' && pageStart != null && pageEnd != null) {
          scope = `pp. ${pageStart}-${pageEnd}`;
        } else if (mode === 'subtopic' && subtopic) {
          scope = `sub-topic: ${subtopic}`;
        }
        const counts = mcq != null && sa != null ? `${mcq} MCQ + ${sa} short-answer` : 'questions';
        let summary = `Practice Test configured — ${counts}, ${scope}`;
        // Append the widening notice when the backend flagged a
        // coverageFallback. Pull the requested page range from the
        // nested fallback meta so the row reflects what the student
        // asked for vs what they got.
        const cf =
          meta.coverageFallback && typeof meta.coverageFallback === 'object'
            ? (meta.coverageFallback as Record<string, unknown>)
            : null;
        if (cf) {
          const reqLo = typeof cf.requestedPageStart === 'number' ? cf.requestedPageStart : null;
          const reqHi = typeof cf.requestedPageEnd === 'number' ? cf.requestedPageEnd : null;
          const requested =
            reqLo != null && reqHi != null ? `pp. ${reqLo}-${reqHi}` : 'requested pages';
          summary += ` (requested ${requested}, none found — used whole lesson)`;
        }
        detail = summary;
      } else if (log.action === 'INTERVENTION_COMPLETED') {
        const dur =
          typeof meta.totalDurationMs === 'number'
            ? `${Math.round(meta.totalDurationMs / 1000)}s`
            : '';
        const score = typeof meta.score === 'number' ? `· ${meta.score}%` : '';
        detail = `${dur} ${score}${itype}`.trim();
      } else if (log.action === 'CHATBOT_MESSAGE_SENT' || log.action === 'DIALOGUE_MESSAGE_SENT') {
        const msg = (meta.message ?? meta.messageText ?? '') as string;
        detail = msg ? `"${msg.slice(0, 80)}${msg.length > 80 ? '…' : ''}"` : '';
      } else {
        const title = (meta.itemTitle ??
          meta.contentTitle ??
          meta.courseTitle ??
          meta.summary ??
          '') as string;
        detail = `${title}${itype}`.trim();
      }
      out.push({
        id: `a-${log.id}`,
        kind: 'activity',
        timestampMs: new Date(log.occurredAt).getTime(),
        label: log.action,
        detail,
        color: ACTION_COLORS[log.action] ?? 'bg-gray-100 text-gray-700',
      });
    }

    for (const d of efDetections ?? []) {
      // Skip pending/error placeholders — they're internal bookkeeping,
      // not real detections.
      if (d.label === 'pending' || d.label === 'error') continue;
      out.push({
        id: `ef-${d.id}`,
        kind: 'ef',
        timestampMs: new Date(d.createdAt).getTime(),
        label: `EF · ${d.constructKey}`,
        detail: `${d.label}${typeof d.confidence === 'number' ? ` (${Math.round(d.confidence * 100)}%)` : ''}`,
        color: 'bg-rose-50 text-rose-700',
      });
    }

    for (const m of dialogueMessages ?? []) {
      out.push({
        id: `d-${m.id}`,
        kind: 'dialogue',
        timestampMs: new Date(m.createdAt).getTime(),
        label: `Dialogue · ${m.role.toLowerCase()}`,
        detail: `"${m.content.slice(0, 100)}${m.content.length > 100 ? '…' : ''}"`,
        color: m.role === 'USER' ? 'bg-cyan-100 text-cyan-800' : 'bg-cyan-50 text-cyan-700',
      });
    }

    for (const m of chatbotMessages ?? []) {
      const tag = m.role === 'USER' ? 'student' : 'assistant';
      const ctx = m.contextSource ? ` · ctx:${m.contextSource}` : '';
      const sugg = m.suggestedStrategy ? ` · suggest:${m.suggestedStrategy}` : '';
      out.push({
        id: `c-${m.id}`,
        kind: 'chatbot',
        timestampMs: new Date(m.createdAt).getTime(),
        label: `Chatbot · ${tag}${ctx}${sugg}`,
        detail: `"${m.content.slice(0, 100)}${m.content.length > 100 ? '…' : ''}"`,
        color: m.role === 'USER' ? 'bg-sky-100 text-sky-800' : 'bg-sky-50 text-sky-700',
      });
    }

    // Stable sort: primary by time, secondary by id so same-ms turns
    // from the same or different sources keep a deterministic order
    // across reloads (matters when the merged list is exported or
    // pinned in screenshots for analysis).
    out.sort((a, b) => {
      if (a.timestampMs !== b.timestampMs) return a.timestampMs - b.timestampMs;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return out;
  }, [activityLogs, efDetections, dialogueMessages, chatbotMessages]);

  if (events.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
        <h3 className="text-sm font-semibold text-gray-800">
          Activity &amp; conversation timeline
        </h3>
        <span className="text-xs text-gray-500">{events.length} events</span>
      </div>
      <div className="max-h-[420px] overflow-y-auto divide-y divide-gray-100">
        {events.map((event) => {
          const isInRange = event.timestampMs - baseWallClockMs <= durationMs;
          return (
            <button
              key={event.id}
              onClick={() => isInRange && onSeek(event.timestampMs)}
              disabled={!isInRange}
              className="flex w-full items-start gap-3 px-3 py-2 text-left text-xs hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="mt-0.5 w-12 shrink-0 font-mono text-[10px] text-gray-500">
                {formatTimelineClock(event.timestampMs, baseWallClockMs)}
              </span>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${event.color}`}
              >
                {event.label}
              </span>
              <span className="flex-1 text-gray-700 truncate">{event.detail}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── InterventionReviewPanel ─────────────────────────────
// Per-intervention drill-down. Each card is one LearningIntervention
// row: header shows the type / time / score; the expanded body shows
// the LLM-generated questions with the student's answer below each
// (and a correctness mark when the graded result is available). The
// card header is a click target that seeks the replay to the
// intervention's start time.
//
// Tolerant rendering: questions, answers, and results live on a
// `sessionData` JSON blob whose shape varies by intervention type.
// Practice Testing has the richest payload (questions[] + results[]);
// other types (Interrogative Elaboration, Stepwise Learning, etc.)
// may only carry questions and free-text answers. Anything missing
// renders as an explicit empty state — never a crash.

interface InterventionReviewPanelProps {
  interventions: SessionReplayIntervention[];
  activityLogs: SessionReplayActivityLog[];
  onSeek: (absoluteMs: number) => void;
}

function formatInterventionType(type: string): string {
  // PRACTICE_TESTING → "Practice Testing"
  return type
    .toLowerCase()
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function InterventionReviewPanel({
  interventions,
  activityLogs,
  onSeek,
}: InterventionReviewPanelProps) {
  // Map intervention id → the earliest activity-log timestamp that
  // references it. Click-to-seek uses this rather than
  // `intervention.createdAt` because the activity-log time is the
  // wall-clock moment the user observed something happen, which is
  // what the replay timeline is anchored on.
  const triggerTimeByInterventionId = useMemo(() => {
    const map = new Map<string, number>();
    for (const log of activityLogs) {
      if (!log.interventionId) continue;
      const t = new Date(log.occurredAt).getTime();
      const existing = map.get(log.interventionId);
      if (existing == null || t < existing) map.set(log.interventionId, t);
    }
    return map;
  }, [activityLogs]);

  // Expansion state per-intervention. Default to expanding the first
  // one so the panel reads as populated on load.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    interventions.length > 0 && interventions[0] ? new Set([interventions[0].id]) : new Set(),
  );

  if (interventions.length === 0) return null;

  const toggle = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
        <h3 className="text-sm font-semibold text-gray-800">Intervention Review</h3>
        <span className="text-xs text-gray-500">{interventions.length} interventions</span>
      </div>
      <div className="divide-y divide-gray-100">
        {interventions.map((iv) => {
          const isExpanded = expandedIds.has(iv.id);
          const triggerMs =
            triggerTimeByInterventionId.get(iv.id) ?? new Date(iv.createdAt).getTime();
          const session = iv.sessionData ?? null;
          const score = typeof session?.score === 'number' ? session.score : null;
          const isCompleted = iv.status === 'COMPLETED' || iv.completedAt != null;
          // Prefer graded `results` (has correctness); fall back to
          // raw questions[] when the intervention type didn't grade.
          const gradedResults =
            Array.isArray(session?.results) && session!.results!.length > 0
              ? session!.results!
              : null;
          const rawQuestions =
            !gradedResults && Array.isArray(session?.questions) ? session!.questions! : null;
          const userAnswers =
            session?.userAnswers && typeof session.userAnswers === 'object'
              ? session.userAnswers
              : null;

          return (
            <div key={iv.id}>
              <div className="flex w-full items-center gap-3 px-3 py-2 text-xs">
                <button
                  type="button"
                  onClick={() => toggle(iv.id)}
                  className="shrink-0 rounded border border-gray-300 px-1.5 py-0.5 font-mono text-[10px] text-gray-700 hover:bg-gray-50"
                  aria-label={isExpanded ? 'Collapse' : 'Expand'}
                >
                  {isExpanded ? '▾' : '▸'}
                </button>
                <button
                  type="button"
                  onClick={() => onSeek(triggerMs)}
                  className="flex flex-1 items-center gap-3 text-left hover:underline"
                  title="Seek the replay to this intervention's start"
                >
                  <span className="font-medium text-gray-900">
                    {formatInterventionType(iv.type)}
                  </span>
                  <span className="font-mono text-[10px] text-gray-500">
                    {formatTimeSecSGT(triggerMs)}
                  </span>
                  <span className="truncate text-gray-500">
                    {iv.selectedText.slice(0, 80)}
                    {iv.selectedText.length > 80 ? '…' : ''}
                  </span>
                </button>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                    score != null
                      ? score >= 80
                        ? 'bg-green-100 text-green-800'
                        : score >= 50
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-red-100 text-red-800'
                      : isCompleted
                        ? 'bg-gray-100 text-gray-700'
                        : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {score != null ? `${Math.round(score)}%` : isCompleted ? 'done' : 'pending'}
                </span>
              </div>

              {isExpanded && (
                <div className="bg-gray-50 px-6 py-3 text-xs">
                  <InterventionBody
                    type={iv.type}
                    isCompleted={isCompleted}
                    session={session}
                    gradedResults={gradedResults}
                    rawQuestions={rawQuestions}
                    userAnswers={userAnswers}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── InterventionBody dispatcher ─────────────────────────
// Renders the expanded body per intervention type. Each branch is
// tolerant: missing/malformed fields render an explicit empty state
// rather than crashing. Shapes documented in
// learning-interventions.service.ts:
//   PRACTICE_TESTING        → { questions, userAnswers, results, score }
//   INTERROGATIVE_ELABORATION → { suggestedQuestions, keyConcepts,
//                                conversation, questionsAsked }
//   STEPWISE_LEARNING       → { steps, currentStep, stepResults,
//                              summary }
//   DISTRIBUTED_PRACTICE    → { cards }  (flashcards for future SR;
//                              no answers/score concept)

interface InterventionBodyProps {
  type: string;
  isCompleted: boolean;
  session: NonNullable<SessionReplayIntervention['sessionData']> | null;
  gradedResults: NonNullable<
    NonNullable<SessionReplayIntervention['sessionData']>['results']
  > | null;
  rawQuestions: NonNullable<
    NonNullable<SessionReplayIntervention['sessionData']>['questions']
  > | null;
  userAnswers: NonNullable<
    NonNullable<SessionReplayIntervention['sessionData']>['userAnswers']
  > | null;
}

function InterventionBody({
  type,
  isCompleted,
  session,
  gradedResults,
  rawQuestions,
  userAnswers,
}: InterventionBodyProps) {
  if (!session) {
    return <p className="text-gray-500">No session data captured.</p>;
  }

  // ─── PRACTICE_TESTING ─────────────────────────────────
  if (type === 'PRACTICE_TESTING') {
    if (gradedResults) {
      return (
        <ol className="space-y-3">
          {gradedResults.map((r, idx) => (
            <li key={idx} className="rounded border border-gray-200 bg-white p-2">
              <div className="mb-1 flex items-start gap-2">
                <span className="mt-0.5 font-mono text-[10px] text-gray-500">Q{idx + 1}</span>
                <span className="font-medium text-gray-900">
                  {r.question || '(no question text)'}
                </span>
                <span
                  className={`ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                    r.correct ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}
                >
                  {r.correct ? '✓' : '✗'}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-gray-700 sm:grid-cols-2">
                <div>
                  <span className="text-gray-500">Student: </span>
                  {r.userAnswer != null && r.userAnswer !== '' ? (
                    String(r.userAnswer)
                  ) : (
                    <span className="italic text-gray-400">no answer</span>
                  )}
                </div>
                <div>
                  <span className="text-gray-500">Correct: </span>
                  {String(r.correctAnswer ?? '')}
                </div>
              </div>
              {(r.feedback || r.explanation) && (
                <p className="mt-2 text-[11px] text-gray-600">{r.feedback || r.explanation}</p>
              )}
            </li>
          ))}
        </ol>
      );
    }
    if (rawQuestions) {
      return (
        <ol className="space-y-2">
          {rawQuestions.map((q, idx) => {
            const ans = userAnswers
              ? (userAnswers[String(idx)] ?? userAnswers[idx as unknown as string])
              : undefined;
            return (
              <li key={idx} className="rounded border border-gray-200 bg-white p-2">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 font-mono text-[10px] text-gray-500">Q{idx + 1}</span>
                  <span className="font-medium text-gray-900">
                    {q.question || '(no question text)'}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-gray-700">
                  <span className="text-gray-500">Student: </span>
                  {ans != null && ans !== '' ? (
                    String(ans)
                  ) : (
                    <span className="italic text-gray-400">no answer</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      );
    }
    return (
      <p className="text-gray-500">
        No questions captured for this intervention
        {isCompleted ? '' : ' (still in progress)'}.
      </p>
    );
  }

  // ─── INTERROGATIVE_ELABORATION ────────────────────────
  // The "questions" are the LLM's suggested prompts; the
  // "answers" are an open-ended Socratic conversation. Show
  // both: starter questions up top, the full back-and-forth
  // below. No correctness — by design.
  if (type === 'INTERROGATIVE_ELABORATION') {
    const suggested = Array.isArray(session.suggestedQuestions) ? session.suggestedQuestions : [];
    const concepts = Array.isArray(session.keyConcepts) ? session.keyConcepts : [];
    const conversation = Array.isArray(session.conversation) ? session.conversation : [];
    const questionsAsked = typeof session.questionsAsked === 'number' ? session.questionsAsked : 0;
    if (suggested.length === 0 && conversation.length === 0) {
      return (
        <p className="text-gray-500">
          No questions or conversation captured
          {isCompleted ? '' : ' (still in progress)'}.
        </p>
      );
    }
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
          <span className="font-medium">Questions asked by student:</span>
          <span className="font-mono">{questionsAsked}</span>
          {concepts.length > 0 && (
            <>
              <span className="ml-2 font-medium">Concepts:</span>
              {concepts.map((c, i) => (
                <span key={i} className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700">
                  {c}
                </span>
              ))}
            </>
          )}
        </div>
        {suggested.length > 0 && (
          <div>
            <p className="mb-1 font-medium text-gray-700">LLM suggested questions</p>
            <ol className="space-y-1">
              {suggested.map((q, idx) => (
                <li key={idx} className="rounded border border-gray-200 bg-white p-2 text-[11px]">
                  <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-600">
                    {q.type ?? '?'} · {q.difficulty ?? '?'}
                  </span>
                  {q.question}
                  {q.topic ? <span className="ml-2 text-gray-500">({q.topic})</span> : null}
                </li>
              ))}
            </ol>
          </div>
        )}
        {conversation.length > 0 && (
          <div>
            <p className="mb-1 font-medium text-gray-700">Conversation</p>
            <ol className="space-y-1">
              {conversation.map((m, idx) => (
                <li
                  key={idx}
                  className={`rounded border border-gray-200 p-2 text-[11px] ${
                    m.role === 'user' ? 'bg-cyan-50' : 'bg-white'
                  }`}
                >
                  <div className="mb-0.5 flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                        m.role === 'user'
                          ? 'bg-cyan-100 text-cyan-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {m.role === 'user' ? 'student' : 'assistant'}
                    </span>
                    {m.wasSuggested && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] text-amber-800">
                        from suggested
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-gray-800">{m.content}</p>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    );
  }

  // ─── STEPWISE_LEARNING ───────────────────────────────
  // Each step has a comprehension check; per-step results carry
  // the student's response attempts and per-attempt feedback.
  if (type === 'STEPWISE_LEARNING') {
    const steps = Array.isArray(session.steps) ? session.steps : [];
    const stepResults =
      session.stepResults && typeof session.stepResults === 'object' ? session.stepResults : {};
    const currentStep = typeof session.currentStep === 'number' ? session.currentStep : null;
    if (steps.length === 0) {
      return (
        <p className="text-gray-500">
          No steps captured
          {isCompleted ? '' : ' (still in progress)'}.
        </p>
      );
    }
    return (
      <div className="space-y-3">
        {session.summary && (
          <div className="rounded border border-gray-200 bg-white p-2 text-[11px] text-gray-700">
            <span className="font-medium">Summary: </span>
            {session.summary}
          </div>
        )}
        <ol className="space-y-2">
          {steps.map((s) => {
            const result = stepResults[String(s.stepNumber)] ?? null;
            const isCurrent = currentStep === s.stepNumber;
            return (
              <li
                key={s.stepNumber}
                className={`rounded border p-2 ${
                  result?.passed
                    ? 'border-green-200 bg-green-50'
                    : result
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-gray-200 bg-white'
                }`}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-mono text-[10px] text-gray-500">Step {s.stepNumber}</span>
                  <span className="font-medium text-gray-900">{s.title}</span>
                  {result && (
                    <span
                      className={`ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                        result.passed
                          ? 'bg-green-100 text-green-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {result.passed ? '✓ passed' : `${result.attempts} attempt(s)`}
                    </span>
                  )}
                  {!result && isCurrent && (
                    <span className="ml-auto shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                      current
                    </span>
                  )}
                </div>
                {s.content && (
                  <p className="text-[11px] text-gray-600 whitespace-pre-wrap">{s.content}</p>
                )}
                {s.comprehensionCheck?.question && (
                  <div className="mt-2 rounded border border-gray-200 bg-white p-1.5 text-[11px]">
                    <span className="font-medium text-gray-700">Check: </span>
                    {s.comprehensionCheck.question}
                  </div>
                )}
                {result &&
                  Array.isArray(result.userResponses) &&
                  result.userResponses.length > 0 && (
                    <ol className="mt-2 space-y-1">
                      {result.userResponses.map((u, idx) => (
                        <li
                          key={idx}
                          className="rounded border border-gray-200 bg-white p-1.5 text-[11px]"
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                                u.isCorrect
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              attempt {idx + 1} {u.isCorrect ? '✓' : '✗'}
                            </span>
                            <span className="text-gray-800">{u.response}</span>
                          </div>
                          {u.feedback && (
                            <p className="mt-1 text-[11px] text-gray-600">{u.feedback}</p>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  // ─── DISTRIBUTED_PRACTICE ────────────────────────────
  // Generation-only intervention: the student doesn't answer
  // anything here, just sees the flashcards that were created
  // for future spaced-repetition review. So just list cards.
  if (type === 'DISTRIBUTED_PRACTICE') {
    const cards = Array.isArray(session.cards) ? session.cards : [];
    if (cards.length === 0) {
      return <p className="text-gray-500">No flashcards generated.</p>;
    }
    return (
      <div>
        <p className="mb-2 text-[11px] text-gray-600">
          Flashcards created for spaced-repetition review (no answers expected at this stage):
        </p>
        <ol className="space-y-1">
          {cards.map((c, idx) => (
            <li key={idx} className="rounded border border-gray-200 bg-white p-2 text-[11px]">
              <div className="mb-1">
                <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                  card {idx + 1} · front
                </span>
                <span className="text-gray-800">{c.front}</span>
              </div>
              <div>
                <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                  back
                </span>
                <span className="text-gray-700">{c.back}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  // ─── Unknown / future types ──────────────────────────
  return (
    <p className="text-gray-500">
      No renderer for intervention type <span className="font-mono">{type}</span> yet. Captured
      session data is available in the export.
    </p>
  );
}

// ─── AoiScoringPanel (prompt 05) ─────────────────────────
// Researcher-facing UI for the AOI attention-allocation feature.
// Renders the compute kernel's output (`computeAoiScoring`) and
// exposes every parameter that drives the result so analyses stay
// reproducible. The compute itself is pure and lives in
// `lib/aoiScoring.ts`; this component is presentation + state plumbing.

interface AoiScoringPanelProps {
  scoring: ReturnType<typeof computeAoiScoring> | null;
  filterMode: 'A' | 'B';
  onFilterModeChange: (m: 'A' | 'B') => void;
  params: ValidStudyMaskParams;
  onParamsChange: (p: ValidStudyMaskParams) => void;
  windowStartText: string;
  onWindowStartTextChange: (s: string) => void;
  windowEndText: string;
  onWindowEndTextChange: (s: string) => void;
  expectedWeights: ExpectedWeightTable;
  onExpectedWeightsChange: (t: ExpectedWeightTable) => void;
  durationMs: number;
  currentTimeMs: number;
  onResetDefaults: () => void;
}

const AOI_BUCKET_LABELS: Record<AoiBucket, string> = {
  sidebar: 'Module list',
  lesson: 'Lesson (only)',
  'pdf-viewer': 'PDF viewer (only)',
  chatbot: 'Chatbot',
  header: 'Header',
  'lesson+pdf': 'Lesson + PDF',
  outside: 'Outside any AOI',
};

const SCORED_BUCKET_ORDER: AoiBucket[] = ['sidebar', 'lesson+pdf', 'chatbot', 'header'];

const EPOCH_LABELS: Record<EpochType, string> = {
  reading_lesson: 'Reading lesson',
  intervention_active: 'Intervention active',
  chatbot_dialogue: 'Chatbot dialogue',
  navigating_modules: 'Navigating modules',
  idle: 'Idle / off-task',
};

function fmtPct(p: number, digits = 1): string {
  return `${(p * 100).toFixed(digits)}%`;
}

function AoiScoringPanel({
  scoring,
  filterMode,
  onFilterModeChange,
  params,
  onParamsChange,
  windowStartText,
  onWindowStartTextChange,
  windowEndText,
  onWindowEndTextChange,
  expectedWeights,
  onExpectedWeightsChange,
  durationMs,
  currentTimeMs,
  onResetDefaults,
}: AoiScoringPanelProps) {
  if (!scoring) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-500">
        <h3 className="text-sm font-semibold text-gray-900">AOI Attention Scoring</h3>
        <p className="mt-2">No data loaded.</p>
      </div>
    );
  }

  const { hygiene, metrics, epochs, sessionAlignment } = scoring;
  const scoredEpochs = epochs.filter((e) => e.type !== 'idle' && e.type !== 'navigating_modules');

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">AOI Attention Scoring</h3>
        <div className="flex items-center gap-1 rounded border border-gray-200 bg-gray-50 p-0.5">
          <button
            type="button"
            onClick={() => onFilterModeChange('A')}
            className={`rounded px-2 py-0.5 text-[11px] ${
              filterMode === 'A' ? 'bg-slate-900 text-white' : 'text-gray-600 hover:bg-white'
            }`}
            title="Filter A: per-AOI PDT across a researcher-defined window."
          >
            A · window
          </button>
          <button
            type="button"
            onClick={() => onFilterModeChange('B')}
            className={`rounded px-2 py-0.5 text-[11px] ${
              filterMode === 'B' ? 'bg-slate-900 text-white' : 'text-gray-600 hover:bg-white'
            }`}
            title="Filter B: per-epoch observed-vs-expected alignment (SEEV/EV)."
          >
            B · epochs
          </button>
        </div>
      </div>

      {/* Researcher controls — exclusion thresholds, window, weights */}
      <details className="mb-3 rounded border border-gray-200 bg-gray-50 p-2 text-[11px]">
        <summary className="cursor-pointer font-medium text-gray-700">
          Parameters &amp; weights
        </summary>
        <div className="mt-2 grid gap-2">
          <label className="flex items-center justify-between gap-2">
            <span>Gaze confidence floor</span>
            <input
              type="number"
              step="0.05"
              min={0}
              max={1}
              value={params.confidenceFloor}
              onChange={(e) =>
                onParamsChange({ ...params, confidenceFloor: Number(e.target.value) })
              }
              className="w-16 rounded border border-gray-300 bg-white px-1.5 py-0.5 font-mono text-[11px]"
            />
          </label>
          <label className="flex items-center justify-between gap-2">
            <span>Transition settle window (ms)</span>
            <input
              type="number"
              step="50"
              min={0}
              value={params.transitionSettleMs}
              onChange={(e) =>
                onParamsChange({ ...params, transitionSettleMs: Number(e.target.value) })
              }
              className="w-20 rounded border border-gray-300 bg-white px-1.5 py-0.5 font-mono text-[11px]"
            />
          </label>
          <label className="flex items-center justify-between gap-2">
            <span>Idle gap threshold (ms)</span>
            <input
              type="number"
              step="500"
              min={0}
              value={params.idleGapMs}
              onChange={(e) => onParamsChange({ ...params, idleGapMs: Number(e.target.value) })}
              className="w-24 rounded border border-gray-300 bg-white px-1.5 py-0.5 font-mono text-[11px]"
            />
          </label>
          {filterMode === 'A' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-1">
                From
                <input
                  type="text"
                  placeholder={formatDuration(0)}
                  value={windowStartText}
                  onChange={(e) => onWindowStartTextChange(e.target.value)}
                  className="w-20 rounded border border-gray-300 bg-white px-1.5 py-0.5 font-mono text-[11px]"
                />
                <button
                  type="button"
                  onClick={() => onWindowStartTextChange(formatTickLabel(currentTimeMs))}
                  className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-white"
                >
                  here
                </button>
              </label>
              <label className="flex items-center gap-1">
                To
                <input
                  type="text"
                  placeholder={formatDuration(durationMs)}
                  value={windowEndText}
                  onChange={(e) => onWindowEndTextChange(e.target.value)}
                  className="w-20 rounded border border-gray-300 bg-white px-1.5 py-0.5 font-mono text-[11px]"
                />
                <button
                  type="button"
                  onClick={() => onWindowEndTextChange(formatTickLabel(currentTimeMs))}
                  className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-white"
                >
                  here
                </button>
              </label>
            </div>
          )}
          {filterMode === 'B' && (
            <div className="mt-1 rounded border border-gray-200 bg-white p-2">
              <p className="mb-1 font-medium text-gray-700">
                Expected attention weights (ordinal — normalized per row)
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-gray-500">
                      <th className="text-left font-medium">Epoch</th>
                      {SCORED_BUCKET_ORDER.map((b) => (
                        <th key={b} className="px-1 text-right font-medium">
                          {AOI_BUCKET_LABELS[b]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {EPOCH_TYPES.filter((t) => t !== 'idle').map((t) => (
                      <tr key={t}>
                        <td className="py-0.5 font-medium text-gray-700">{EPOCH_LABELS[t]}</td>
                        {SCORED_BUCKET_ORDER.map((b) => {
                          const v = expectedWeights[t]?.[b] ?? 0;
                          return (
                            <td key={b} className="px-1 text-right">
                              <input
                                type="number"
                                min={0}
                                max={5}
                                step={1}
                                value={v}
                                onChange={(e) =>
                                  onExpectedWeightsChange({
                                    ...expectedWeights,
                                    [t]: {
                                      ...(expectedWeights[t] ?? {}),
                                      [b]: Number(e.target.value),
                                    },
                                  })
                                }
                                className="w-10 rounded border border-gray-300 px-1 py-0.5 text-right font-mono"
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onResetDefaults}
              className="rounded border border-gray-300 px-2 py-0.5 text-[10px] text-gray-600 hover:bg-white"
            >
              Reset to defaults
            </button>
          </div>
        </div>
      </details>

      {/* Data hygiene */}
      <div className="mb-3 rounded border border-gray-200 bg-gray-50 p-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-gray-700">Valid study:</span>
          <span className="font-mono">
            {hygiene.validGazeSamples} / {hygiene.totalGazeSamples} samples
          </span>
          <span className="font-mono">
            ≈ {formatDuration(hygiene.validStudyDurationSecs * 1000)}
          </span>
          {hygiene.excludedByConfidence > 0 && (
            <span className="text-amber-700">–{hygiene.excludedByConfidence} low-conf</span>
          )}
          {hygiene.excludedByVisibility > 0 && (
            <span className="text-amber-700">–{hygiene.excludedByVisibility} tab hidden</span>
          )}
          {hygiene.excludedByTransitionSettle > 0 && (
            <span className="text-amber-700">
              –{hygiene.excludedByTransitionSettle} transition settle
            </span>
          )}
          {hygiene.excludedByIdle > 0 && (
            <span className="text-amber-700">–{hygiene.excludedByIdle} idle</span>
          )}
          {hygiene.excludedByOutsideWindow > 0 && (
            <span className="text-gray-500">–{hygiene.excludedByOutsideWindow} outside window</span>
          )}
        </div>
      </div>

      {filterMode === 'A' ? (
        // ─── Filter A: per-AOI PDT table ────────────────
        <div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-gray-500">
                <th className="text-left font-medium">AOI</th>
                <th className="text-right font-medium">Samples</th>
                <th className="text-right font-medium">PDT</th>
                <th className="text-left font-medium pl-2"></th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.bucket} className="border-t border-gray-100">
                  <td className="py-1 font-medium text-gray-700">{AOI_BUCKET_LABELS[m.bucket]}</td>
                  <td className="py-1 text-right font-mono text-gray-700">{m.samples}</td>
                  <td className="py-1 text-right font-mono text-gray-700">{fmtPct(m.pdt)}</td>
                  <td className="py-1 pl-2">
                    <div className="h-1.5 w-full overflow-hidden rounded bg-gray-100">
                      <div
                        className="h-full bg-slate-700"
                        style={{ width: `${Math.min(100, m.pdt * 100)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        // ─── Filter B: per-epoch observed-vs-expected ───
        <div>
          <div className="mb-2 flex items-center justify-between rounded border border-gray-200 bg-gray-50 px-2 py-1.5">
            <span className="font-medium text-gray-700">Session allocation score</span>
            <span className="font-mono text-base text-slate-900">
              {sessionAlignment != null ? fmtPct(sessionAlignment, 1) : '—'}
            </span>
          </div>
          {scoredEpochs.length === 0 && (
            <p className="text-gray-500">
              No scored epochs in the session (only idle / navigating segments).
            </p>
          )}
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {scoredEpochs.map((e, idx) => (
              <div key={`${e.startMs}-${idx}`} className="rounded border border-gray-200 p-2">
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="font-medium text-gray-700">{EPOCH_LABELS[e.type]}</span>
                  <span className="font-mono text-gray-500">
                    {formatDuration(e.durationMs)} · {e.validSamples} samples
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                      e.alignment == null
                        ? 'bg-gray-100 text-gray-500'
                        : e.alignment >= 0.7
                          ? 'bg-green-100 text-green-800'
                          : e.alignment >= 0.4
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {e.alignment != null ? `align ${fmtPct(e.alignment, 0)}` : '—'}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-1">
                  {SCORED_BUCKET_ORDER.map((b) => {
                    const obs = e.observed[b] ?? 0;
                    const exp = e.expected[b] ?? 0;
                    return (
                      <div key={b} className="flex items-center gap-2 text-[10px]">
                        <span className="w-20 shrink-0 text-gray-600">{AOI_BUCKET_LABELS[b]}</span>
                        <div className="relative flex-1">
                          {/* expected (light) */}
                          <div
                            className="absolute left-0 top-0 h-3 rounded-l bg-indigo-100"
                            style={{ width: `${exp * 100}%` }}
                          />
                          {/* observed (dark) */}
                          <div
                            className="relative h-3 rounded-l bg-slate-700"
                            style={{ width: `${obs * 100}%` }}
                          />
                        </div>
                        <span className="w-24 shrink-0 text-right font-mono text-gray-700">
                          {fmtPct(obs, 0)} / {fmtPct(exp, 0)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-gray-500">
            Bars show <span className="font-medium text-slate-700">observed</span> over{' '}
            <span className="text-indigo-700">expected</span> share per AOI. Alignment uses
            total-variation distance: 1 − ½·Σ|obs − exp| over the four scored AOIs.
          </p>
        </div>
      )}
    </div>
  );
}
