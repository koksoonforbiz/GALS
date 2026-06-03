/**
 * Affect dynamics: prevalence, dwell times, transition matrices, and the
 * cascade detector. Affect is a time-series problem — the actionable signal is
 * persistent UNRESOLVED confusion -> frustration -> boredom. Instantaneous
 * confusion is often productive and must not be treated as an alarm.
 *
 * Input is a per-window gold (or chosen-rater) affect track: an ordered array
 * of affect codes (or null for uncoded windows), one per 20s window.
 */

export type AffectTrack = (string | null)[];

export interface Prevalence {
  counts: Record<string, number>;
  proportions: Record<string, number>;
  nCoded: number;
}

export function prevalence(track: AffectTrack): Prevalence {
  const counts: Record<string, number> = {};
  let nCoded = 0;
  for (const c of track) {
    if (c == null) continue;
    counts[c] = (counts[c] ?? 0) + 1;
    nCoded += 1;
  }
  const proportions: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) proportions[k] = nCoded ? v / nCoded : 0;
  return { counts, proportions, nCoded };
}

export interface DwellStats {
  /** per state: run lengths in windows. */
  runs: Record<string, number[]>;
  /** per state: total windows, mean run (windows), mean dwell seconds. */
  summary: Record<string, { totalWindows: number; nRuns: number; meanRunWindows: number; meanDwellSec: number }>;
}

/** Consecutive-window run lengths per state (dwell = run length x windowMs). */
export function dwellTimes(track: AffectTrack, windowMs = 20_000): DwellStats {
  const runs: Record<string, number[]> = {};
  let i = 0;
  while (i < track.length) {
    const c = track[i];
    if (c == null) { i++; continue; }
    let j = i;
    while (j < track.length && track[j] === c) j++;
    (runs[c] ??= []).push(j - i);
    i = j;
  }
  const summary: DwellStats['summary'] = {};
  for (const [state, rl] of Object.entries(runs)) {
    const totalWindows = rl.reduce((a, b) => a + b, 0);
    const nRuns = rl.length;
    const meanRunWindows = nRuns ? totalWindows / nRuns : 0;
    summary[state] = {
      totalWindows,
      nRuns,
      meanRunWindows,
      meanDwellSec: (meanRunWindows * windowMs) / 1000,
    };
  }
  return { runs, summary };
}

export interface TransitionMatrix {
  states: string[];
  /** counts[from][to] */
  counts: Record<string, Record<string, number>>;
  /** probabilities[from][to] (row-normalized; self-transitions excluded by default) */
  probabilities: Record<string, Record<string, number>>;
}

/**
 * State -> next-state transitions. By default collapses consecutive identical
 * windows (so a transition is a genuine state change), which is what dwell +
 * cascade analysis want.
 */
export function transitionMatrix(track: AffectTrack, collapseRuns = true): TransitionMatrix {
  const seq: string[] = [];
  for (const c of track) {
    if (c == null) continue;
    if (collapseRuns && seq.length && seq[seq.length - 1] === c) continue;
    seq.push(c);
  }
  const states = [...new Set(seq)].sort();
  const counts: Record<string, Record<string, number>> = {};
  for (const a of states) {
    counts[a] = {};
    for (const b of states) counts[a][b] = 0;
  }
  for (let i = 0; i < seq.length - 1; i++) counts[seq[i]][seq[i + 1]] += 1;
  const probabilities: Record<string, Record<string, number>> = {};
  for (const a of states) {
    const rowTotal = states.reduce((s, b) => s + counts[a][b], 0);
    probabilities[a] = {};
    for (const b of states) probabilities[a][b] = rowTotal ? counts[a][b] / rowTotal : 0;
  }
  return { states, counts, probabilities };
}

export interface CascadeEpisode {
  startWindow: number;
  endWindow: number;
  sequence: string[];
  resolved: boolean;
  kind: 'unresolved_confusion_cascade' | 'resolved_confusion';
}

/**
 * Detect confusion -> frustration -> boredom escalations.
 * - A confusion run that returns to engaged_concentration within
 *   `resolutionWindows` is RESOLVED (productive confusion) and not flagged.
 * - A confusion run that escalates to frustration and/or boredom without
 *   resolving is an UNRESOLVED cascade and is flagged.
 */
export function detectCascades(
  track: AffectTrack,
  opts: { resolutionWindows?: number } = {},
): CascadeEpisode[] {
  const resolutionWindows = opts.resolutionWindows ?? 2;
  const episodes: CascadeEpisode[] = [];
  const ESCALATION = ['confusion', 'frustration', 'boredom'];

  let i = 0;
  while (i < track.length) {
    if (track[i] !== 'confusion') { i++; continue; }
    const start = i;
    // Walk forward through any of the escalation states (and short uncoded gaps).
    let j = i;
    let sawFrustration = false;
    let sawBoredom = false;
    const seq: string[] = [];
    while (j < track.length && (track[j] == null || ESCALATION.includes(track[j]!))) {
      const s = track[j];
      if (s != null) {
        seq.push(s);
        if (s === 'frustration') sawFrustration = true;
        if (s === 'boredom') sawBoredom = true;
      }
      j++;
    }
    // Resolution: does it return to engaged_concentration within N windows after the run?
    let resolved = false;
    for (let k = j; k < Math.min(track.length, j + resolutionWindows); k++) {
      if (track[k] === 'engaged_concentration') { resolved = true; break; }
    }
    const escalated = sawFrustration || sawBoredom;
    if (escalated && !resolved) {
      episodes.push({ startWindow: start, endWindow: j - 1, sequence: seq, resolved: false, kind: 'unresolved_confusion_cascade' });
    } else if (resolved) {
      episodes.push({ startWindow: start, endWindow: j - 1, sequence: seq, resolved: true, kind: 'resolved_confusion' });
    }
    i = Math.max(j, start + 1);
  }
  return episodes;
}

/** Just the actionable (unresolved) cascades. */
export function unresolvedCascades(track: AffectTrack, resolutionWindows = 2): CascadeEpisode[] {
  return detectCascades(track, { resolutionWindows }).filter((e) => !e.resolved);
}
