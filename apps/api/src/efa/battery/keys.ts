/**
 * Answer keys for EF battery v2.0, ported from docs/EF_battery_v2/source/ef.py.
 * Server-side only: nothing here is ever sent to the student bundle.
 *
 * stimuli.json stores what is *presented* (or, on paper, spoken); the keys
 * are derived here, exactly as ef.py derives them for the record sheets:
 *  - W1 forward: the sequence as given; backward: reversed (ef.py `t[::-1]`)
 *  - W2: digits ascending, then letters alphabetical (ef.py `lns_answer`)
 *  - W3: n + 3 / n − 3 per the item's op (ef.py `pm_answer`, operand 3)
 *  - W6: W page → the word, C page → the ink, CW page → the ink
 * W5 expected words are stored in stimuli.json itself (`hay`).
 */

export type Colour = 'red' | 'green' | 'blue';

export const PM_OPERAND = 3;
export const STROOP_ROWS = 20;
export const STROOP_COLS = 5;

export function digitSpanAnswer(sequence: readonly number[], direction: 'fwd' | 'bwd'): number[] {
  return direction === 'fwd' ? [...sequence] : [...sequence].reverse();
}

/** ef.py lns_answer: digits sorted numerically, then letters sorted alphabetically. */
export function lnsAnswer(items: readonly string[]): string[] {
  const digits = items.filter((x) => /^\d$/.test(x)).sort((a, b) => Number(a) - Number(b));
  const letters = items.filter((x) => /^[A-Za-z]$/.test(x)).sort();
  return [...digits, ...letters];
}

/** ef.py pm_answer: `n + 3 if op == "+" else n - 3`. */
export function pmAnswer(n: number, op: string): number {
  return op === '+' ? n + PM_OPERAND : n - PM_OPERAND;
}

export type StroopPage = 'W' | 'C' | 'CW';

/** Correct colour per item for a Stroop page (index order = reading order, down the columns). */
export function stroopKey(
  stroop: { words: Colour[]; colours: Colour[]; cw_ink: Colour[] },
  page: StroopPage,
): Colour[] {
  if (page === 'W') return [...stroop.words];
  if (page === 'C') return [...stroop.colours];
  return [...stroop.cw_ink];
}

/** Grid cell (row r, column c) of a column-major Stroop sequence: seq[c*20 + r]. */
export function stroopCell<T>(seq: readonly T[], row: number, col: number): T {
  return seq[col * STROOP_ROWS + row] as T;
}

/** W2 response normalisation: case-insensitive, separators and spaces ignored. */
export function normaliseLnsResponse(raw: string): string[] {
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .split('');
}

/** W1 response normalisation: digits only. */
export function normaliseDigitResponse(raw: string): number[] {
  return raw.replace(/\D/g, '').split('').map(Number);
}
