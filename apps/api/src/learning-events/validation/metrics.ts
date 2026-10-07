/**
 * Validation metrics (plan Phase 5.1 #3), matching the workbook's
 * Validation sheet: segments are fixed time windows on the session's
 * shared wall-clock time base; for each rule a segment is "trace-coded" if
 * a learning event overlaps it and "think-aloud-coded" if a mapped
 * annotation overlaps it (both with a tolerance).
 *
 *   match rate  = (TP + TN) / total
 *   sensitivity = TP / (TP + FN)
 *   specificity = TN / (TN + FP)
 */
export interface Interval {
  start: number;
  end: number;
}

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export function segments(start: number, end: number, segmentMs: number): Interval[] {
  const out: Interval[] = [];
  if (!(end > start) || segmentMs <= 0) return out;
  for (let t = start; t < end; t += segmentMs)
    out.push({ start: t, end: Math.min(t + segmentMs, end) });
  return out;
}

export function overlaps(seg: Interval, iv: Interval, toleranceMs: number): boolean {
  const s = iv.start - toleranceMs;
  const e = Math.max(iv.end, iv.start) + toleranceMs;
  return s < seg.end && e >= seg.start;
}

export function confusion(
  segs: Interval[],
  trace: Interval[],
  human: Interval[],
  toleranceMs: number,
): Confusion {
  const c: Confusion = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const seg of segs) {
    const t = trace.some((iv) => overlaps(seg, iv, toleranceMs));
    const h = human.some((iv) => overlaps(seg, iv, toleranceMs));
    if (t && h) c.tp++;
    else if (t) c.fp++;
    else if (h) c.fn++;
    else c.tn++;
  }
  return c;
}

export function addConfusion(a: Confusion, b: Confusion): Confusion {
  return { tp: a.tp + b.tp, fp: a.fp + b.fp, fn: a.fn + b.fn, tn: a.tn + b.tn };
}

const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

export function indicators(c: Confusion) {
  const total = c.tp + c.fp + c.fn + c.tn;
  return {
    total,
    matchRate: ratio(c.tp + c.tn, total),
    sensitivity: ratio(c.tp, c.tp + c.fn),
    specificity: ratio(c.tn, c.tn + c.fp),
  };
}

/** Cohen's κ for two raters' categorical labels on the same items. */
export function cohenKappa<T>(a: T[], b: T[]): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  const n = a.length;
  const cats = [...new Set([...a, ...b])];
  let agree = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) agree++;
  const po = agree / n;
  let pe = 0;
  for (const c of cats) {
    const pa = a.filter((x) => x === c).length / n;
    const pb = b.filter((x) => x === c).length / n;
    pe += pa * pb;
  }
  if (pe === 1) return po === 1 ? 1 : null; // no variation: κ undefined
  return (po - pe) / (1 - pe);
}
