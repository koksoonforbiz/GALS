/**
 * Server-side scoring for EF battery v2.0, online adaptation (pure).
 * Rules: docs/EF_battery_v2/source/scoring_key.tex, with the online
 * deviations in docs/EF_battery_v2/ONLINE_ADAPTATION.md §4. Everything is
 * recomputed from raw trials (+ final rater codes for W4/W5), so a new
 * SCORING_VERSION can re-score old data. No z-scores or composites here:
 * those are computed at analysis time against the T0 sample.
 */
export const SCORING_VERSION = 'efa-1.0.0';

/** The trial fields scoring needs (subset of efa_trials). */
export interface ScoreTrial {
  phase: string;
  part: string;
  trialIndex: number;
  stimulus: unknown;
  response: unknown;
  onsetMs: number | null;
  firstInputMs: number | null;
  submitMs: number | null;
  correct: boolean | null;
}

/** Final rater codes for one trial, by entry index (W4 entries, W5 = index 0). */
export type FinalCodes = Map<string, { code: string; category: string | null }>; // key `${trialIndex}:${part}:${entry}`

export interface ScoreResult {
  scores: Record<string, number | null>;
  flags: Record<string, unknown>;
}

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const test = (ts: ScoreTrial[], part?: string) =>
  ts.filter((t) => t.phase === 'test' && (!part || t.part === part));
const lengthOf = (t: ScoreTrial) => (t.stimulus as unknown[]).length;

/** Longest length with at least one correct trial (W1; W2 by decision Q9). */
function longest(trials: ScoreTrial[]): number | null {
  const ok = trials.filter((t) => t.correct).map(lengthOf);
  return ok.length ? Math.max(...ok) : null;
}

// ── W1 number repetition ──────────────────────────────────────────────────
export function scoreW1(trials: ScoreTrial[]): ScoreResult {
  const fwd = test(trials, 'fwd');
  const bwd = test(trials, 'bwd');
  return {
    scores: {
      fwd_total: fwd.filter((t) => t.correct).length, // 0–16
      fwd_longest: longest(fwd),
      bwd_total: bwd.filter((t) => t.correct).length, // 0–14
      bwd_longest: longest(bwd),
      fwd_trials_given: fwd.length,
      bwd_trials_given: bwd.length,
    },
    flags: {},
  };
}

// ── W2 letter–number sequencing ───────────────────────────────────────────
export function scoreW2(trials: ScoreTrial[]): ScoreResult {
  const t = test(trials, 'lns');
  return {
    scores: {
      total: t.filter((x) => x.correct).length,
      longest: longest(t),
      trials_given: t.length,
    },
    flags: {},
  };
}

// ── W3 plus–minus ─────────────────────────────────────────────────────────
export function scoreW3(trials: ScoreTrial[]): ScoreResult {
  const scores: Record<string, number | null> = {};
  const flags: Record<string, unknown> = {};
  const times: Array<number | null> = [];
  for (const list of [1, 2, 3]) {
    const items = test(trials, `list${list}`).sort((a, b) => a.trialIndex - b.trialIndex);
    const answered = items.filter((t) => t.submitMs != null);
    const time =
      answered.length === 30 && items[0]!.onsetMs != null
        ? (answered[answered.length - 1]!.submitMs! - items[0]!.onsetMs) / 1000
        : null;
    const errors = items.filter((t) => t.correct !== true).length + (30 - items.length);
    scores[`t${list}_s`] = time == null ? null : round(time);
    scores[`e${list}`] = errors;
    const rts = answered.filter((t) => t.onsetMs != null).map((t) => t.submitMs! - t.onsetMs!);
    scores[`rt${list}_mean_ms`] = rts.length ? round(mean(rts)!, 1) : null;
    if (errors > 3) flags[`list${list}_over3_errors`] = true;
    times.push(time);
  }
  const [t1, t2, t3] = times;
  const base = t1 != null && t2 != null ? (t1 + t2) / 2 : null;
  scores.switch_cost_s = base != null && t3 != null ? round(t3 - base) : null; // primary
  scores.switch_ratio = base != null && t3 != null && base > 0 ? round(t3 / base) : null;
  return { scores, flags };
}

// ── W4 word lists ─────────────────────────────────────────────────────────
type Entry = { text: string; atMs: number };
const COMMON_SUFFIX = /(ingly|edly|ings|ness|ment|ers|ies|ied|ing|est|ed|er|es|ly|s)$/;
/** Very small stemmer for pre-scoring only ("same word with a different ending"). */
export function stem(w: string): string {
  const s = w.toLowerCase().replace(/[^a-z]/g, '');
  return s.length > 4 ? s.replace(COMMON_SUFFIX, '') : s;
}

/** A small, bundled list of common first names / places used only to flag likely proper nouns. */
const NAMES = new Set(
  'adam alice anna ben bob charles david emma fiona frank fred george hannah harry jack james jane john kate lucy mark mary michael nancy nick paul peter rachel sam sarah simon sophie tom asia africa america amsterdam australia berlin boston britain canada china dublin england europe france germany holland hong india italy japan korea london madrid malaysia manila mexico nepal paris peru rome russia scotland singapore spain sydney tokyo wales'.split(
    ' ',
  ),
);

export interface W4Flagged {
  text: string;
  normalised: string;
  atMs: number;
  repeat: boolean;
  sameRoot: boolean;
  wrongLetter: boolean;
  likelyName: boolean;
}

/** Automatic pre-scoring of one prompt's entries (raters make the final call). */
export function prescoreW4(entries: Entry[], letter?: string): W4Flagged[] {
  const seen = new Set<string>();
  const roots = new Set<string>();
  return entries.map((e) => {
    const normalised = e.text.trim().toLowerCase();
    const root = stem(normalised);
    const out = {
      text: e.text,
      normalised,
      atMs: e.atMs,
      repeat: seen.has(normalised),
      sameRoot: !seen.has(normalised) && roots.has(root),
      wrongLetter: !!letter && !normalised.startsWith(letter.toLowerCase()),
      likelyName: /^[A-Z]/.test(e.text.trim()) || NAMES.has(normalised),
    };
    seen.add(normalised);
    roots.add(root);
    return out;
  });
}

const W4_PROMPTS = ['letter1', 'letter2', 'letter3', 'category', 'switch'] as const;

/**
 * W4 scores. Without final codes only automatic counts exist (*_auto);
 * with them: valid words, repeats, rule breaks and, for switching, correct
 * switches (a valid word of the other category right after a valid word),
 * same-category-in-a-row errors and intrusions.
 */
export function scoreW4(trials: ScoreTrial[], codes: FinalCodes): ScoreResult {
  const scores: Record<string, number | null> = {};
  let allCoded = true;
  for (const part of W4_PROMPTS) {
    const t = test(trials, part)[0];
    const entries = ((t?.response as { entries?: Entry[] })?.entries ?? []) as Entry[];
    const letter = (t?.stimulus as { letter?: string } | undefined)?.letter;
    const pre = prescoreW4(entries, letter);
    scores[`${part}_entries`] = entries.length;
    scores[`${part}_valid_auto`] = pre.filter(
      (p) => !p.repeat && !p.sameRoot && !p.wrongLetter && !p.likelyName,
    ).length;
    const final = entries.map((_, i) => codes.get(`0:${part}:${i}`));
    if (!t || final.some((c) => !c)) {
      allCoded = false;
      for (const k of ['valid', 'repeats', 'rule_breaks']) scores[`${part}_${k}`] = null;
      if (part === 'switch')
        for (const k of ['correct_switches', 'same_category', 'intrusions', 'switch_ratio'])
          scores[`switch_${k}`] = null;
      continue;
    }
    const valid = final.map((c) => c!.code === 'valid');
    scores[`${part}_valid`] = valid.filter(Boolean).length;
    scores[`${part}_repeats`] = final.filter((c) => c!.code === 'repeat').length;
    scores[`${part}_rule_breaks`] = final.filter((c) => c!.code === 'rule_break').length;
    if (part === 'switch') {
      let switches = 0;
      let same = 0;
      for (let i = 1; i < final.length; i++) {
        if (!valid[i] || !valid[i - 1]) continue;
        if (final[i]!.category !== final[i - 1]!.category) switches++;
        else same++;
      }
      scores.switch_correct_switches = switches; // primary (shifting sensitivity)
      scores.switch_same_category = same;
      scores.switch_intrusions = final.filter((c) => c!.code === 'intrusion').length;
      scores.switch_switch_ratio = final.length > 1 ? round(switches / (final.length - 1)) : null;
    }
  }
  return { scores, flags: allCoded ? {} : { awaiting_coding: true } };
}

// ── W5 sentence completion ────────────────────────────────────────────────
/**
 * RT = sentence onset → first keystroke (online definition). Part B error
 * score = 3 × A codes + 1 × B codes (0–45), from final rater codes.
 */
export function scoreW5(trials: ScoreTrial[], codes: FinalCodes): ScoreResult {
  const rt = (t: ScoreTrial) =>
    t.firstInputMs != null && t.onsetMs != null ? t.firstInputMs - t.onsetMs : null;
  const part = (p: 'A' | 'B') => test(trials, p);
  const rts = (p: 'A' | 'B') =>
    part(p)
      .map(rt)
      .filter((v): v is number => v != null);
  const a = mean(rts('A'));
  const b = mean(rts('B'));
  const bCodes = part('B').map((t) => codes.get(`${t.trialIndex}:B:0`)?.code);
  const allCoded = part('B').length === 15 && bCodes.every((c) => !!c);
  const prompted = trials.filter(
    (t) => t.phase === 'test' && (t.response as { prompted?: boolean })?.prompted,
  ).length;
  return {
    scores: {
      a_mean_rt_ms: a == null ? null : round(a, 1),
      b_mean_rt_ms: b == null ? null : round(b, 1),
      b_minus_a_rt_ms: a != null && b != null ? round(b - a, 1) : null,
      b_error_score: allCoded
        ? bCodes.reduce((s, c) => s + (c === 'A' ? 3 : c === 'B' ? 1 : 0), 0)
        : null,
      b_a_codes: allCoded ? bCodes.filter((c) => c === 'A').length : null,
      b_b_codes: allCoded ? bCodes.filter((c) => c === 'B').length : null,
      prompted,
    },
    flags: {
      w5_unnormed: true,
      ...(allCoded ? {} : { awaiting_coding: true }),
      ...(prompted ? { prompted } : {}),
    },
  };
}

// ── W6 colours (Golden) ───────────────────────────────────────────────────
/** Golden interference: IG = CW − (W×C)/(W+C). Higher = better interference control. */
export function goldenIG(w: number, c: number, cw: number): number | null {
  return w + c > 0 ? round(cw - (w * c) / (w + c), 2) : null;
}

export function scoreW6(trials: ScoreTrial[]): ScoreResult {
  const scores: Record<string, number | null> = {};
  const page = (p: string) => {
    const t = test(trials, p)[0];
    const presses = (
      (t?.response as { presses?: Array<{ i: number; atMs: number; correct: boolean }> })
        ?.presses ?? []
    ).slice();
    const done = presses.filter((x) => x.correct);
    // per-item RT: time from the previous completed item (or page start) to this item's correct press
    const rts: number[] = [];
    let prev = t?.onsetMs ?? null;
    for (const d of done) {
      if (prev != null) rts.push(d.atMs - prev);
      prev = d.atMs;
    }
    return {
      items: done.length,
      errors: presses.length - done.length,
      rt: mean(rts),
      present: !!t,
    };
  };
  const W = page('W');
  const C = page('C');
  const CW = page('CW');
  if (!W.present && !C.present && !CW.present) return { scores: {}, flags: { skipped: true } };
  scores.w_items = W.items;
  scores.c_items = C.items;
  scores.cw_items = CW.items;
  scores.w_corrected_errors = W.errors;
  scores.c_corrected_errors = C.errors;
  scores.cw_corrected_errors = CW.errors;
  scores.golden_ig = goldenIG(W.items, C.items, CW.items); // primary (+z)
  scores.cw_over_c = C.items ? round(CW.items / C.items) : null;
  scores.c_mean_item_rt_ms = C.rt == null ? null : round(C.rt, 1);
  scores.cw_mean_item_rt_ms = CW.rt == null ? null : round(CW.rt, 1);
  scores.rt_interference_ms = C.rt != null && CW.rt != null ? round(CW.rt - C.rt, 1) : null;
  return { scores, flags: {} };
}

// ── W7 trails ─────────────────────────────────────────────────────────────
export function scoreW7(trials: ScoreTrial[]): ScoreResult {
  const scores: Record<string, number | null> = {};
  const flags: Record<string, unknown> = {};
  for (const p of ['P1', 'P2'] as const) {
    const t = test(trials, p)[0];
    const r = t?.response as
      | { clicks?: Array<{ correct: boolean }>; reached?: number; discontinued?: boolean }
      | undefined;
    const time = t?.onsetMs != null && t.submitMs != null ? (t.submitMs - t.onsetMs) / 1000 : null;
    const key = p === 'P1' ? 'part1' : 'part2';
    scores[`${key}_time_s`] = r?.discontinued ? 300 : time == null ? null : round(time);
    scores[`${key}_errors`] = r?.clicks ? r.clicks.filter((c) => !c.correct).length : null;
    scores[`${key}_reached`] = r?.reached ?? null;
    if (r?.discontinued) flags[`${key}_discontinued_300s`] = true;
  }
  return { scores, flags }; // primary: part2 time, residualised on part1 at analysis
}

// ── ADEXI ("How you usually are") ─────────────────────────────────────────
export function scoreAdexi(
  answers: Record<string, number>,
  key: { WM: number[]; INH: number[] },
): ScoreResult | null {
  const v = (n: number) => answers[`B${n}`];
  if ([...key.WM, ...key.INH].some((n) => typeof v(n) !== 'number')) return null;
  const sum = (ns: number[]) => ns.reduce((s, n) => s + v(n)!, 0);
  return {
    scores: {
      wm: sum(key.WM), // 9–45
      inh: sum(key.INH), // 5–25
      wm_12item: sum(key.WM.filter((n) => n !== 1)), // 12-item variant (without items 1 and 14)
      inh_12item: sum(key.INH.filter((n) => n !== 14)),
    },
    flags: {},
  };
}

export function scoreTask(task: string, trials: ScoreTrial[], codes: FinalCodes): ScoreResult {
  switch (task) {
    case 'w1':
      return scoreW1(trials);
    case 'w2':
      return scoreW2(trials);
    case 'w3':
      return scoreW3(trials);
    case 'w4':
      return scoreW4(trials, codes);
    case 'w5':
      return scoreW5(trials, codes);
    case 'w6':
      return scoreW6(trials);
    case 'w7':
      return scoreW7(trials);
    default:
      throw new Error(`unknown task ${task}`);
  }
}

/** Cohen's kappa for two raters over the same items (nominal codes). */
export function cohensKappa(pairs: Array<[string, string]>): number | null {
  if (!pairs.length) return null;
  const n = pairs.length;
  const cats = [...new Set(pairs.flat())];
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const pe = cats.reduce((s, c) => {
    const p1 = pairs.filter(([a]) => a === c).length / n;
    const p2 = pairs.filter(([, b]) => b === c).length / n;
    return s + p1 * p2;
  }, 0);
  return pe === 1 ? 1 : round((po - pe) / (1 - pe));
}
