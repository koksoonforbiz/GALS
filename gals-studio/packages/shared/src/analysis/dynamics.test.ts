import { describe, it, expect } from 'vitest';
import { prevalence, dwellTimes, transitionMatrix, detectCascades, unresolvedCascades } from './dynamics.js';

describe('prevalence', () => {
  it('counts coded windows and ignores null', () => {
    const p = prevalence(['a', 'a', 'b', null]);
    expect(p.nCoded).toBe(3);
    expect(p.counts).toEqual({ a: 2, b: 1 });
    expect(p.proportions.a).toBeCloseTo(2 / 3, 6);
  });
});

describe('dwellTimes', () => {
  it('computes run lengths and dwell seconds', () => {
    const d = dwellTimes(['a', 'a', 'a', 'b', 'a'], 20_000);
    expect(d.runs.a).toEqual([3, 1]);
    expect(d.runs.b).toEqual([1]);
    expect(d.summary.a.meanDwellSec).toBeCloseTo(((3 + 1) / 2) * 20, 6);
  });
});

describe('transitionMatrix', () => {
  it('collapses runs and computes probabilities', () => {
    const t = transitionMatrix(['a', 'a', 'b', 'a'], true);
    // collapsed sequence: a, b, a => a->b once, b->a once
    expect(t.counts.a.b).toBe(1);
    expect(t.counts.b.a).toBe(1);
    expect(t.probabilities.a.b).toBeCloseTo(1, 6);
  });
});

describe('cascade detector', () => {
  it('flags an unresolved confusion -> frustration -> boredom cascade', () => {
    const track = ['engaged_concentration', 'confusion', 'confusion', 'frustration', 'boredom', 'boredom'];
    const unresolved = unresolvedCascades(track, 2);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].sequence).toContain('frustration');
    expect(unresolved[0].sequence).toContain('boredom');
  });

  it('ignores resolved (productive) confusion that returns to engagement', () => {
    const track = ['engaged_concentration', 'confusion', 'engaged_concentration'];
    expect(unresolvedCascades(track, 2)).toHaveLength(0);
    const all = detectCascades(track, { resolutionWindows: 2 });
    expect(all.some((e) => e.kind === 'resolved_confusion')).toBe(true);
  });
});
