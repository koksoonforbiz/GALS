/**
 * Scoring for the common self-report instruments (stage 06). Pure functions
 * keyed to published scoring schemes. `items` is a map of item-id -> response.
 */

export interface ScoredResult {
  instrument: string;
  subscales: Record<string, number>;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pick = (items: Record<string, number>, keys: string[]): number[] =>
  keys.map((k) => items[k]).filter((v): v is number => typeof v === 'number');

/** Paas mental-effort: single 9-point item. */
export function scorePaas(items: Record<string, number>): ScoredResult {
  const v = items.effort ?? items.paas ?? items.mentalEffort ?? NaN;
  return { instrument: 'paas', subscales: { mentalEffort: v } };
}

/** PANAS: 10 positive-affect + 10 negative-affect items, summed. */
export function scorePanas(items: Record<string, number>): ScoredResult {
  const pa = ['interested', 'excited', 'strong', 'enthusiastic', 'proud', 'alert', 'inspired', 'determined', 'attentive', 'active'];
  const na = ['distressed', 'upset', 'guilty', 'scared', 'hostile', 'irritable', 'ashamed', 'nervous', 'jittery', 'afraid'];
  const sum = (keys: string[]) => pick(items, keys).reduce((a, b) => a + b, 0);
  return { instrument: 'panas', subscales: { PA: sum(pa), NA: sum(na) } };
}

/**
 * IMI 4 subscales (interest/enjoyment, perceived competence, effort/importance,
 * pressure/tension). Item ids prefixed by subscale, e.g. interest_1.
 */
export function scoreImi(items: Record<string, number>): ScoredResult {
  const sub = (prefix: string) =>
    mean(Object.entries(items).filter(([k]) => k.startsWith(prefix)).map(([, v]) => v));
  return {
    instrument: 'imi',
    subscales: {
      interestEnjoyment: sub('interest'),
      perceivedCompetence: sub('competence'),
      effortImportance: sub('effort'),
      pressureTension: sub('pressure'),
    },
  };
}

/** NASA-TLX raw (unweighted mean of 6 subscales, 0-100 each). */
export function scoreNasaTlx(items: Record<string, number>): ScoredResult {
  const keys = ['mental', 'physical', 'temporal', 'performance', 'effort', 'frustration'];
  const vals = pick(items, keys);
  return {
    instrument: 'nasa_tlx',
    subscales: {
      raw: mean(vals),
      ...Object.fromEntries(keys.map((k) => [k, items[k] ?? NaN])),
    },
  };
}

/**
 * AEQ-S subscales (achievement-emotion: enjoyment, hope, pride, anger, anxiety,
 * shame, hopelessness, boredom). Item ids prefixed by subscale.
 */
export function scoreAeqS(items: Record<string, number>): ScoredResult {
  const subscales: Record<string, number> = {};
  for (const sub of ['enjoyment', 'hope', 'pride', 'anger', 'anxiety', 'shame', 'hopelessness', 'boredom']) {
    subscales[sub] = mean(Object.entries(items).filter(([k]) => k.startsWith(sub)).map(([, v]) => v));
  }
  return { instrument: 'aeq_s', subscales };
}

/** MSLQ executive-function / self-regulation core (metacognition, effort regulation). */
export function scoreMslqEf(items: Record<string, number>): ScoredResult {
  const sub = (prefix: string) =>
    mean(Object.entries(items).filter(([k]) => k.startsWith(prefix)).map(([, v]) => v));
  return {
    instrument: 'mslq_ef',
    subscales: {
      metacognitiveSelfRegulation: sub('metacog'),
      effortRegulation: sub('effort'),
      timeStudyEnvironment: sub('time'),
    },
  };
}

export const INSTRUMENT_SCORERS: Record<string, (items: Record<string, number>) => ScoredResult> = {
  paas: scorePaas,
  panas: scorePanas,
  imi: scoreImi,
  nasa_tlx: scoreNasaTlx,
  aeq_s: scoreAeqS,
  mslq_ef: scoreMslqEf,
};

export function scoreInstrument(instrument: string, items: Record<string, number>): ScoredResult | null {
  const fn = INSTRUMENT_SCORERS[instrument.toLowerCase()];
  return fn ? fn(items) : null;
}

/** Pearson correlation (convergent-validity helper). */
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx === 0 || dy === 0 ? NaN : num / Math.sqrt(dx * dy);
}
