import { prisma } from '../prisma.js';
import type { Aoi } from '@gals-studio/shared';

/**
 * Part B — decision-level activity inference. Fuses four channels per time
 * window and emits an EXPLICIT conflict channel; it never silently picks a
 * winner when DOM and gaze disagree (the divided-attention case).
 */

export type ActivityLabel =
  | 'reading_lesson'
  | 'chatbot'
  | 'intervention'
  | 'navigating'
  | 'idle'
  | 'divided_attention'
  | 'off_task_tab_switch'
  | 'gaze_unknown';

/** Canonical rollup buckets for pctByActivity (per Part A contract). */
export type RollupActivity =
  | 'reading_lesson'
  | 'chatbot'
  | 'intervention'
  | 'navigating'
  | 'idle'
  | 'off_task';

export interface ActivityWindow {
  tMs: number; // window start, relative to baseWallClockMs
  primaryActivity: ActivityLabel;
  domLabel: ActivityLabel | null;
  gazeLabel: ActivityLabel | null;
  interactionLabel: ActivityLabel | null;
  conflict: boolean;
}

export interface ActivityResult {
  binMs: number;
  gazeConf: number;
  windows: ActivityWindow[];
  rollup: {
    pctByActivity: Record<RollupActivity, number>;
    pctReadingButGazeElsewhere: number;
    allocationScore: number;
  };
}

// Default expected attention allocation (researcher-tunable later). TV-distance
// of the observed distribution from this is the allocationScore.
const EXPECTED: Record<RollupActivity, number> = {
  reading_lesson: 0.55,
  chatbot: 0.2,
  intervention: 0.15,
  navigating: 0.05,
  idle: 0.05,
  off_task: 0,
};

const parseJson = <T>(v: string | null | undefined, fb: T): T => {
  if (!v) return fb;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fb;
  }
};

function regionToActivity(region: string | null): ActivityLabel | null {
  if (!region) return null;
  if (region === 'lesson' || region === 'pdf-viewer') return 'reading_lesson';
  if (region === 'chatbot') return 'chatbot';
  if (region === 'sidebar' || region === 'header') return 'navigating';
  return null;
}

/** Smaller/nested rect wins (same rule as the existing AOI coverage). */
function aoiHit(aois: Aoi[], x: number, y: number): string | null {
  let best: string | null = null;
  let bestArea = Infinity;
  for (const a of aois) {
    if (x >= a.x && x <= a.x + a.width && y >= a.y && y <= a.y + a.height) {
      const area = a.width * a.height;
      if (area < bestArea) {
        bestArea = area;
        best = a.region;
      }
    }
  }
  return best;
}

const ROLLUP: Record<ActivityLabel, RollupActivity> = {
  reading_lesson: 'reading_lesson',
  chatbot: 'chatbot',
  intervention: 'intervention',
  navigating: 'navigating',
  idle: 'idle',
  divided_attention: 'off_task',
  off_task_tab_switch: 'off_task',
  gaze_unknown: 'idle',
};

export async function classifyActivity(
  sessionId: string,
  opts: { binMs?: number; gazeConf?: number } = {},
): Promise<ActivityResult | null> {
  const binMs = opts.binMs ?? 1000;
  const gazeConf = opts.gazeConf ?? 0.5;
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return null;
  const base = session.baseWallClockMs;
  const dur = session.durationMs;
  const nWin = Math.max(1, Math.ceil(dur / binMs));

  const [snaps, gaze, clicks, cursors, keys, vis, ivs] = await Promise.all([
    prisma.snapshot.findMany({
      where: { sessionId },
      orderBy: { wallMs: 'asc' },
      select: { wallMs: true, aois: true, pageUrl: true },
    }),
    prisma.gazeSample.findMany({
      where: { sessionId },
      orderBy: { wallMs: 'asc' },
      select: { wallMs: true, x: true, y: true, confidence: true },
    }),
    prisma.click.findMany({
      where: { sessionId },
      orderBy: { wallMs: 'asc' },
      select: { wallMs: true, x: true, y: true },
    }),
    prisma.cursor.findMany({
      where: { sessionId },
      orderBy: { wallMs: 'asc' },
      select: { wallMs: true },
    }),
    prisma.keystroke.findMany({
      where: { sessionId },
      orderBy: { wallMs: 'asc' },
      select: { wallMs: true },
    }),
    prisma.visibility.findMany({
      where: { sessionId },
      orderBy: { wallMs: 'asc' },
      select: { wallMs: true, visibleState: true },
    }),
    prisma.intervention.findMany({ where: { sessionId }, select: { wallMs: true } }),
  ]);

  // Snapshots usually carry only a SUBSET of AOIs (often just `header`), so we
  // carry forward the last-known rect per region to build a composite layout
  // that is valid as of each snapshot's time. The docked course layout is
  // stable, so last-known-wins is a faithful reconstruction.
  const snapMeta = snaps.map((s) => ({ wallMs: s.wallMs, pageUrl: s.pageUrl ?? '' }));
  const layout: Aoi[][] = [];
  {
    const running = new Map<string, Aoi>();
    for (const s of snaps) {
      for (const a of parseJson<Aoi[]>(s.aois, [])) running.set(a.region, a);
      layout.push([...running.values()]);
    }
  }
  // index of the last snapshot whose wallMs <= absolute time
  const idxAtAbs = (absMs: number) => {
    let lo = 0,
      hi = snapMeta.length - 1,
      ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (snapMeta[mid].wallMs <= absMs) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  };
  const winOf = (wallMs: number) => Math.floor((wallMs - base) / binMs);

  // bucket point events by window
  const gazeBy = new Map<number, { x: number; y: number }[]>();
  for (const g of gaze) {
    if (g.confidence != null && g.confidence < gazeConf) continue;
    const w = winOf(g.wallMs);
    if (w < 0 || w >= nWin) continue;
    (gazeBy.get(w) ?? gazeBy.set(w, []).get(w)!).push({ x: g.x, y: g.y });
  }
  const clickBy = new Map<number, { x: number; y: number }[]>();
  for (const c of clicks) {
    const w = winOf(c.wallMs);
    if (w < 0 || w >= nWin) continue;
    (clickBy.get(w) ?? clickBy.set(w, []).get(w)!).push({ x: c.x, y: c.y });
  }
  const keyBy = new Set<number>();
  for (const k of keys) {
    const w = winOf(k.wallMs);
    if (w >= 0 && w < nWin) keyBy.add(w);
  }
  const cursorBy = new Set<number>();
  for (const c of cursors) {
    const w = winOf(c.wallMs);
    if (w >= 0 && w < nWin) cursorBy.add(w);
  }
  const ivWin = new Set<number>();
  for (const iv of ivs) {
    const w = winOf(iv.wallMs);
    if (w >= 0 && w < nWin) ivWin.add(w);
  }

  // visibility: step function — state effective from its (absolute) wallMs onward
  const visSorted = vis.map((v) => ({
    off: v.wallMs,
    hidden: (v.visibleState ?? 'visible') !== 'visible',
  }));
  const isHidden = (absMs: number) => {
    let lo = 0,
      hi = visSorted.length - 1,
      ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (visSorted[mid].off <= absMs) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans >= 0 ? visSorted[ans].hidden : false;
  };

  const majority = (labels: (ActivityLabel | null)[]): ActivityLabel | null => {
    const m: Record<string, number> = {};
    for (const l of labels) if (l) m[l] = (m[l] ?? 0) + 1;
    let best: ActivityLabel | null = null,
      bestN = 0;
    for (const [k, n] of Object.entries(m))
      if (n > bestN) {
        bestN = n;
        best = k as ActivityLabel;
      }
    return best;
  };

  const windows: ActivityWindow[] = [];
  for (let w = 0; w < nWin; w++) {
    const t0 = w * binMs;
    const absT0 = base + t0;
    const idx = idxAtAbs(absT0);
    const aois = idx >= 0 ? layout[idx] : (layout[0] ?? []);
    const pageUrl = idx >= 0 ? snapMeta[idx].pageUrl : (snapMeta[0]?.pageUrl ?? '');

    // DOM channel: route-level. An intervention fired in this window dominates.
    let domLabel: ActivityLabel | null = null;
    if (ivWin.has(w)) domLabel = 'intervention';
    else if (snapMeta.length)
      domLabel = /\/(courses?|student|lesson)/i.test(pageUrl) ? 'reading_lesson' : 'navigating';

    // gaze channel — off-AOI gaze is unknown, NOT navigating
    const gs = gazeBy.get(w);
    const gazeRegion =
      gs && gs.length ? majority(gs.map((p) => regionToActivity(aoiHit(aois, p.x, p.y)))) : null;
    const gazeLabel: ActivityLabel = gazeRegion ?? 'gaze_unknown';
    const gazeKnown = gazeLabel !== 'gaze_unknown';

    // interaction channel — clicks (locus) + keystrokes (≈ chatbot input). Cursor
    // movement is too noisy to be an activity locus; used only for idle detection.
    const cl = clickBy.get(w);
    const clickRegion =
      cl && cl.length ? majority(cl.map((p) => regionToActivity(aoiHit(aois, p.x, p.y)))) : null;
    const interactionLabel: ActivityLabel | null = clickRegion ?? (keyBy.has(w) ? 'chatbot' : null);
    const active = (cl && cl.length > 0) || keyBy.has(w);

    const hidden = isHidden(absT0);
    const anyMotion = active || cursorBy.has(w) || gazeKnown;

    // ── ordered, decision-level fusion ──
    let primary: ActivityLabel;
    let conflict = false;
    if (hidden) {
      primary = 'off_task_tab_switch';
    } else if (active && interactionLabel) {
      // active interaction is the strongest locus signal (typing in chatbot while
      // the page is the lesson = chatbot activity); flag if gaze disagrees.
      primary = interactionLabel;
      conflict = gazeKnown && gazeLabel !== interactionLabel;
    } else if (domLabel === 'reading_lesson' && gazeLabel === 'chatbot') {
      // the case we care most about: page is the lesson, gaze drifts to the chatbot
      // with no active interaction → divided attention, off-task relative to lesson.
      primary = 'divided_attention';
      conflict = true;
    } else if (gazeKnown) {
      primary = gazeLabel;
      conflict =
        !!domLabel &&
        domLabel !== 'intervention' &&
        gazeLabel !== 'navigating' &&
        gazeLabel !== domLabel;
    } else if (!anyMotion) {
      primary = 'idle';
    } else {
      // gaze unreliable but page known and some motion → fall back to the DOM route
      primary = domLabel ?? 'idle';
    }
    windows.push({
      tMs: t0,
      primaryActivity: primary,
      domLabel,
      gazeLabel,
      interactionLabel,
      conflict,
    });
  }

  // ── rollup ──
  const counts: Record<RollupActivity, number> = {
    reading_lesson: 0,
    chatbot: 0,
    intervention: 0,
    navigating: 0,
    idle: 0,
    off_task: 0,
  };
  let dividedReadingGaze = 0;
  for (const win of windows) {
    counts[ROLLUP[win.primaryActivity]] += 1;
    if (
      win.primaryActivity === 'divided_attention' &&
      win.domLabel === 'reading_lesson' &&
      win.gazeLabel === 'chatbot'
    )
      dividedReadingGaze += 1;
  }
  const total = windows.length || 1;
  const pctByActivity = Object.fromEntries(
    (Object.keys(counts) as RollupActivity[]).map((k) => [k, counts[k] / total]),
  ) as Record<RollupActivity, number>;
  const allocationScore =
    0.5 *
    (Object.keys(EXPECTED) as RollupActivity[]).reduce(
      (s, k) => s + Math.abs(pctByActivity[k] - EXPECTED[k]),
      0,
    );

  return {
    binMs,
    gazeConf,
    windows,
    rollup: {
      pctByActivity,
      pctReadingButGazeElsewhere: dividedReadingGaze / total,
      allocationScore,
    },
  };
}
