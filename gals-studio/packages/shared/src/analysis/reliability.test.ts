import { describe, it, expect } from 'vitest';
import {
  cohenKappa,
  pabak,
  krippendorffAlpha,
  percentAgreement,
  fleissKappa,
  dimensionReliability,
} from './reliability.js';

/** Build paired arrays from a 2x2 cell count: [yy, yn, ny, nn]. */
function pairs2x2(yy: number, yn: number, ny: number, nn: number) {
  const r1: string[] = [];
  const r2: string[] = [];
  const push = (a: string, b: string, n: number) => { for (let i = 0; i < n; i++) { r1.push(a); r2.push(b); } };
  push('yes', 'yes', yy); push('yes', 'no', yn); push('no', 'yes', ny); push('no', 'no', nn);
  return { r1, r2 };
}

describe('cohenKappa', () => {
  it('matches the textbook 0.40 example', () => {
    const { r1, r2 } = pairs2x2(20, 5, 10, 15);
    const res = cohenKappa(r1, r2);
    expect(res.observedAgreement).toBeCloseTo(0.7, 6);
    expect(res.expectedAgreement).toBeCloseTo(0.5, 6);
    expect(res.kappa).toBeCloseTo(0.4, 6);
    expect(res.cautionHighKappa).toBe(false);
  });

  it('excludes missing pairs from kappa', () => {
    const res = cohenKappa(['a', 'b', null, 'a'], ['a', 'b', 'a', null]);
    expect(res.n).toBe(2);
    expect(res.kappa).toBe(1);
  });

  it('flags near-perfect agreement (kappa paradox caution)', () => {
    const res = cohenKappa(Array(50).fill('a'), Array(50).fill('a'));
    expect(res.kappa).toBe(1);
    expect(res.cautionHighKappa).toBe(true);
  });
});

describe('pabak vs kappa on a rare class', () => {
  it('shows the prevalence gap', () => {
    const { r1, r2 } = pairs2x2(45, 2, 3, 0);
    const k = cohenKappa(r1, r2);
    const pb = pabak(k.observedAgreement, 2);
    expect(k.observedAgreement).toBeCloseTo(0.9, 6);
    expect(k.kappa).toBeLessThan(0.1); // deflated despite 90% agreement
    expect(pb).toBeCloseTo(0.8, 6); // PABAK corrects
    expect(pb - k.kappa).toBeGreaterThan(0.5);
  });
});

describe('percentAgreement', () => {
  it('reports overall and per-code agreement', () => {
    const pa = percentAgreement(['a', 'a', 'b'], ['a', 'b', 'b']);
    expect(pa.overall).toBeCloseTo(2 / 3, 6);
    // 'a' and 'b' each appear in one agreeing and one disagreeing window.
    expect(pa.perCode.a.agreement).toBeCloseTo(0.5, 6);
    expect(pa.perCode.b.agreement).toBeCloseTo(0.5, 6);
  });
});

describe('krippendorffAlpha', () => {
  it('is 1 for perfect agreement', () => {
    expect(krippendorffAlpha([['a', 'a'], ['b', 'b'], ['a', 'a']], 'nominal')).toBe(1);
  });

  it('matches a hand-computed nominal value', () => {
    // 4 units, 1 disagreement: alpha = 1 - 0.25/0.5357 = 0.5333
    const data = [['a', 'a'], ['a', 'a'], ['b', 'b'], ['a', 'b']];
    expect(krippendorffAlpha(data, 'nominal')).toBeCloseTo(0.5333, 3);
  });

  it('uses ordinal distance when requested', () => {
    const order = ['low', 'med', 'high'];
    const near = krippendorffAlpha([['low', 'med'], ['high', 'high']], 'ordinal', order);
    const far = krippendorffAlpha([['low', 'high'], ['med', 'med']], 'ordinal', order);
    expect(near).toBeGreaterThan(far);
  });
});

describe('fleissKappa', () => {
  it('is 1 when all raters agree on every unit', () => {
    expect(fleissKappa([{ a: 3 }, { b: 3 }, { a: 3 }])).toBe(1);
  });
  it('is below 1 with disagreement', () => {
    expect(fleissKappa([{ a: 2, b: 1 }, { a: 1, b: 2 }])).toBeLessThan(1);
  });
});

describe('dimensionReliability', () => {
  it('bundles kappa, pabak, alpha, agreement, and disagreement count', () => {
    const { r1, r2 } = pairs2x2(20, 5, 10, 15);
    const r = dimensionReliability(r1, r2);
    expect(r.kappa.kappa).toBeCloseTo(0.4, 6);
    expect(r.nWindows).toBe(50);
    expect(r.nDisagreements).toBe(15);
  });
});
