import { describe, it, expect } from 'vitest';
import { scorePaas, scorePanas, scoreImi, scoreNasaTlx, scoreAeqS, scoreMslqEf, pearson } from './instruments.js';

describe('instrument scoring', () => {
  it('Paas is the single effort item', () => {
    expect(scorePaas({ effort: 7 }).subscales.mentalEffort).toBe(7);
  });

  it('PANAS sums PA and NA (10 items each)', () => {
    const items: Record<string, number> = {};
    for (const k of ['interested', 'excited', 'strong', 'enthusiastic', 'proud', 'alert', 'inspired', 'determined', 'attentive', 'active']) items[k] = 3;
    for (const k of ['distressed', 'upset', 'guilty', 'scared', 'hostile', 'irritable', 'ashamed', 'nervous', 'jittery', 'afraid']) items[k] = 1;
    const r = scorePanas(items);
    expect(r.subscales.PA).toBe(30);
    expect(r.subscales.NA).toBe(10);
  });

  it('IMI averages by subscale prefix', () => {
    const r = scoreImi({ interest_1: 5, interest_2: 7, competence_1: 4, effort_1: 6, pressure_1: 2 });
    expect(r.subscales.interestEnjoyment).toBe(6);
    expect(r.subscales.perceivedCompetence).toBe(4);
  });

  it('NASA-TLX raw is the mean of 6 subscales', () => {
    const r = scoreNasaTlx({ mental: 60, physical: 20, temporal: 40, performance: 80, effort: 50, frustration: 30 });
    expect(r.subscales.raw).toBeCloseTo((60 + 20 + 40 + 80 + 50 + 30) / 6, 6);
  });

  it('AEQ-S produces all 8 achievement-emotion subscales', () => {
    const r = scoreAeqS({ boredom_1: 4, boredom_2: 2, enjoyment_1: 5 });
    expect(r.subscales.boredom).toBe(3);
    expect(r.subscales.enjoyment).toBe(5);
    expect(Object.keys(r.subscales)).toContain('hopelessness');
  });

  it('MSLQ EF core averages metacognition + effort regulation', () => {
    const r = scoreMslqEf({ metacog_1: 4, metacog_2: 6, effort_1: 5 });
    expect(r.subscales.metacognitiveSelfRegulation).toBe(5);
    expect(r.subscales.effortRegulation).toBe(5);
  });

  it('pearson correlation in the expected convergent-validity band', () => {
    const r = pearson([1, 2, 3, 4, 5], [1.1, 1.9, 3.2, 3.8, 5.1]);
    expect(r).toBeGreaterThan(0.9);
  });
});
