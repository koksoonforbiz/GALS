/**
 * Inter-rater reliability metrics. Pure functions, hand-checkable.
 *
 * Methodological rule (encode, don't just compute): report Cohen's kappa,
 * PABAK, and Krippendorff's alpha together. Raw kappa deflates when a class is
 * rare (the "kappa paradox"); PABAK corrects for prevalence; alpha handles
 * ordinal/missing data. Treat kappa > 0.85 with skepticism.
 */

export interface ConfusionMatrix {
  labels: string[];
  /** matrix[i][j] = count where rater1=labels[i], rater2=labels[j] */
  matrix: number[][];
  n: number;
}

/** A paired observation; null = uncoded (missing). */
export type Pair = [string | null, string | null];

export function buildConfusionMatrix(pairs: Pair[]): ConfusionMatrix {
  const labelSet = new Set<string>();
  for (const [a, b] of pairs) {
    if (a != null) labelSet.add(a);
    if (b != null) labelSet.add(b);
  }
  const labels = [...labelSet].sort();
  const idx = new Map(labels.map((l, i) => [l, i]));
  const matrix = labels.map(() => labels.map(() => 0));
  let n = 0;
  for (const [a, b] of pairs) {
    if (a == null || b == null) continue; // kappa excludes missing
    matrix[idx.get(a)!][idx.get(b)!] += 1;
    n += 1;
  }
  return { labels, matrix, n };
}

export function observedAgreement(cm: ConfusionMatrix): number {
  if (cm.n === 0) return 0;
  let diag = 0;
  for (let i = 0; i < cm.labels.length; i++) diag += cm.matrix[i][i];
  return diag / cm.n;
}

export interface KappaResult {
  kappa: number;
  observedAgreement: number;
  expectedAgreement: number;
  n: number;
  confusionMatrix: ConfusionMatrix;
  /** true when agreement is near-perfect on collapsed categories. */
  cautionHighKappa: boolean;
}

/** Cohen's kappa for two raters, nominal codes. Missing pairs excluded. */
export function cohenKappa(rater1: (string | null)[], rater2: (string | null)[]): KappaResult {
  const pairs: Pair[] = rater1.map((a, i) => [a, rater2[i] ?? null]);
  const cm = buildConfusionMatrix(pairs);
  const po = observedAgreement(cm);
  let pe = 0;
  if (cm.n > 0) {
    for (let i = 0; i < cm.labels.length; i++) {
      let rowSum = 0;
      let colSum = 0;
      for (let j = 0; j < cm.labels.length; j++) {
        rowSum += cm.matrix[i][j];
        colSum += cm.matrix[j][i];
      }
      pe += (rowSum / cm.n) * (colSum / cm.n);
    }
  }
  const kappa = pe === 1 ? 1 : (po - pe) / (1 - pe);
  return {
    kappa,
    observedAgreement: po,
    expectedAgreement: pe,
    n: cm.n,
    confusionMatrix: cm,
    cautionHighKappa: kappa > 0.85,
  };
}

/**
 * Prevalence-and-bias-adjusted kappa. For k categories:
 *   PABAK = (k * po - 1) / (k - 1)
 */
export function pabak(observed: number, k: number): number {
  if (k <= 1) return observed === 1 ? 1 : 0;
  return (k * observed - 1) / (k - 1);
}

export interface PercentAgreementResult {
  overall: number;
  n: number;
  perCode: Record<string, { agreements: number; total: number; agreement: number }>;
}

/** % agreement overall and per code (which codes drag reliability down). */
export function percentAgreement(rater1: (string | null)[], rater2: (string | null)[]): PercentAgreementResult {
  let agree = 0;
  let n = 0;
  const perCode: PercentAgreementResult['perCode'] = {};
  for (let i = 0; i < rater1.length; i++) {
    const a = rater1[i];
    const b = rater2[i];
    if (a == null || b == null) continue;
    n += 1;
    for (const code of new Set([a, b])) {
      perCode[code] ??= { agreements: 0, total: 0, agreement: 0 };
      perCode[code].total += 1;
      if (a === b) perCode[code].agreements += 1;
    }
    if (a === b) agree += 1;
  }
  for (const code of Object.keys(perCode)) {
    const c = perCode[code];
    c.agreement = c.total ? c.agreements / c.total : 0;
  }
  return { overall: n ? agree / n : 0, n, perCode };
}

/**
 * Krippendorff's alpha for nominal or ordinal data with missing values.
 * `data` is one row per unit (window), each cell a code or null (missing).
 * Supports >=2 raters (columns).
 */
export type ReliabilityLevel = 'nominal' | 'ordinal';

export function krippendorffAlpha(
  data: (string | number | null)[][],
  level: ReliabilityLevel = 'nominal',
  ordinalOrder?: (string | number)[],
): number {
  // Collect values + their order index for ordinal distance.
  const valueIndex = new Map<string | number, number>();
  if (level === 'ordinal' && ordinalOrder) {
    ordinalOrder.forEach((v, i) => valueIndex.set(v, i));
  } else {
    const seen = new Set<string | number>();
    for (const row of data) for (const v of row) if (v != null) seen.add(v);
    [...seen].sort().forEach((v, i) => valueIndex.set(v, i));
  }

  const metricDist = (a: string | number, b: string | number): number => {
    if (level === 'nominal') return a === b ? 0 : 1;
    const ia = valueIndex.get(a) ?? 0;
    const ib = valueIndex.get(b) ?? 0;
    return (ia - ib) * (ia - ib); // ordinal: squared rank distance
  };

  // Build per-unit value lists (drop units with <2 codings).
  const units: (string | number)[][] = [];
  for (const row of data) {
    const present = row.filter((v): v is string | number => v != null);
    if (present.length >= 2) units.push(present);
  }
  if (units.length === 0) return 1; // nothing to disagree on

  // Observed disagreement Do = (1/sum m_u) * sum_u 1/(m_u-1) sum_{i!=j} delta
  let observed = 0;
  let nTotal = 0;
  for (const unit of units) {
    const m = unit.length;
    let s = 0;
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i !== j) s += metricDist(unit[i], unit[j]);
    observed += s / (m - 1);
    nTotal += m;
  }
  const Do = observed / nTotal;

  // Expected disagreement De from the global value distribution.
  const allValues: (string | number)[] = units.flat();
  const N = allValues.length;
  let De = 0;
  for (let i = 0; i < allValues.length; i++) {
    for (let j = 0; j < allValues.length; j++) {
      if (i === j) continue;
      De += metricDist(allValues[i], allValues[j]);
    }
  }
  De = De / (N * (N - 1));

  if (De === 0) return 1;
  return 1 - Do / De;
}

/**
 * Fleiss' kappa generalization for >2 raters (nominal). `data` is one row per
 * unit; each row maps category -> count of raters assigning it. Rows must sum
 * to the same number of raters n.
 */
export function fleissKappa(data: Record<string, number>[]): number {
  const categories = new Set<string>();
  for (const row of data) for (const c of Object.keys(row)) categories.add(c);
  const cats = [...categories];
  const N = data.length;
  if (N === 0) return 1;
  const n = Object.values(data[0]).reduce((a, b) => a + b, 0);
  if (n <= 1) return 1;

  // Pj: proportion of all assignments to category j
  const pj: Record<string, number> = {};
  for (const c of cats) {
    let sum = 0;
    for (const row of data) sum += row[c] ?? 0;
    pj[c] = sum / (N * n);
  }
  // Pi: agreement per unit
  let sumPi = 0;
  for (const row of data) {
    let s = 0;
    for (const c of cats) {
      const nij = row[c] ?? 0;
      s += nij * (nij - 1);
    }
    sumPi += s / (n * (n - 1));
  }
  const PbarObs = sumPi / N;
  const PbarExp = cats.reduce((a, c) => a + pj[c] * pj[c], 0);
  if (PbarExp === 1) return 1;
  return (PbarObs - PbarExp) / (1 - PbarExp);
}

export interface DimensionReliability {
  kappa: KappaResult;
  pabak: number;
  alphaNominal: number;
  alphaOrdinal?: number;
  percentAgreement: PercentAgreementResult;
  nWindows: number;
  nDisagreements: number;
}

/** Convenience: compute the full reliability bundle for a paired dimension. */
export function dimensionReliability(
  rater1: (string | null)[],
  rater2: (string | null)[],
  ordinalOrder?: (string | number)[],
): DimensionReliability {
  const kappa = cohenKappa(rater1, rater2);
  const k = kappa.confusionMatrix.labels.length || 1;
  const pa = percentAgreement(rater1, rater2);
  const data = rater1.map((a, i) => [a, rater2[i] ?? null] as (string | null)[]);
  const alphaNominal = krippendorffAlpha(data, 'nominal');
  const alphaOrdinal = ordinalOrder ? krippendorffAlpha(data, 'ordinal', ordinalOrder) : undefined;
  let disagreements = 0;
  for (let i = 0; i < rater1.length; i++) {
    if (rater1[i] != null && rater2[i] != null && rater1[i] !== rater2[i]) disagreements += 1;
  }
  return {
    kappa,
    pabak: pabak(kappa.observedAgreement, k),
    alphaNominal,
    alphaOrdinal,
    percentAgreement: pa,
    nWindows: kappa.n,
    nDisagreements: disagreements,
  };
}
