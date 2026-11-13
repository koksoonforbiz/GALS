import {
  cohensKappa,
  goldenIG,
  prescoreW4,
  scoreAdexi,
  scoreW1,
  scoreW2,
  scoreW3,
  scoreW4,
  scoreW5,
  scoreW6,
  scoreW7,
  stem,
  W6_PAGE_MS,
  type FinalCodes,
  type ScoreTrial,
} from './scoring';

const trial = (o: Partial<ScoreTrial>): ScoreTrial => ({
  phase: 'test',
  part: 'x',
  trialIndex: 0,
  stimulus: null,
  response: null,
  onsetMs: null,
  firstInputMs: null,
  submitMs: null,
  correct: null,
  ...o,
});

describe('W6 Golden interference', () => {
  it('matches the worked example in ef_report.tex', () => {
    expect(goldenIG(100, 80, 40)).toBe(-4.44);
    expect(goldenIG(100, 80, 50)).toBe(5.56);
  });

  it('items completed = correct presses; corrections counted; RT interference', () => {
    const page = (part: string, presses: Array<[number, boolean]>) =>
      trial({
        part,
        onsetMs: 0,
        response: { presses: presses.map(([atMs, correct], i) => ({ i, atMs, correct })) },
      });
    const s = scoreW6([
      page('W', [
        [500, true],
        [1000, true],
        [1500, true],
      ]),
      page('C', [
        [600, true],
        [1200, true],
      ]),
      page('CW', [
        [700, false],
        [1400, true],
        [2800, true],
      ]),
    ]).scores;
    expect(s).toEqual(
      expect.objectContaining({ w_items: 3, c_items: 2, cw_items: 2, cw_corrected_errors: 1 }),
    );
    expect(s.golden_ig).toBe(goldenIG(3, 2, 2));
    expect(s.c_mean_item_rt_ms).toBe(600);
    expect(s.cw_mean_item_rt_ms).toBe(1400);
    expect(s.rt_interference_ms).toBe(800);
  });

  const pressPage = (part: string, presses: Array<[number, boolean]>) =>
    trial({
      part,
      onsetMs: 1000,
      response: { presses: presses.map(([atMs, correct], i) => ({ i, atMs, correct })) },
    });

  it('presses after the 45 s page are not counted (server-side limit)', () => {
    const late = 1000 + W6_PAGE_MS + 5000;
    const r = scoreW6([
      pressPage('W', [
        [2000, true],
        [late, true],
      ]),
      pressPage('C', [[2000, true]]),
      pressPage('CW', [[2000, true]]),
    ]);
    expect(r.scores.w_items).toBe(1);
    expect(r.flags).toEqual(expect.objectContaining({ w_late_presses_dropped: 1 }));
  });

  it('a page never given is missing (null), and IG is not computed from it', () => {
    const r = scoreW6([pressPage('W', [[2000, true]]), pressPage('C', [[2000, true]])]);
    expect(r.scores.cw_items).toBeNull();
    expect(r.scores.cw_corrected_errors).toBeNull();
    expect(r.scores.golden_ig).toBeNull();
    expect(r.scores.cw_over_c).toBeNull();
  });

  it('flags a page where more than a quarter of presses were wrong (key-guessing)', () => {
    const guess: Array<[number, boolean]> = Array.from({ length: 20 }, (_, i) => [
      2000 + i * 300,
      i % 2 === 0,
    ]);
    const r = scoreW6([
      pressPage('W', [[2000, true]]),
      pressPage('C', [[2000, true]]),
      pressPage('CW', guess),
    ]);
    expect(r.flags).toEqual(expect.objectContaining({ cw_high_error_rate: 0.5 }));
    expect(r.flags).not.toHaveProperty('w_high_error_rate');
  });
});

describe('W1 number repetition', () => {
  it('totals and longest span per direction (practice ignored)', () => {
    const t = (part: string, len: number, correct: boolean, phase = 'test') =>
      trial({ part, phase, stimulus: Array(len).fill('1'), correct });
    const s = scoreW1([
      t('fwd', 2, false, 'practice'),
      t('fwd', 2, true),
      t('fwd', 2, true),
      t('fwd', 3, false),
      t('fwd', 3, true),
      t('fwd', 4, false),
      t('fwd', 4, false),
      t('bwd', 2, false),
      t('bwd', 2, false),
    ]).scores;
    expect(s).toEqual(
      expect.objectContaining({
        fwd_total: 3,
        fwd_longest: 3,
        bwd_total: 0,
        bwd_longest: null,
        fwd_trials_given: 6,
      }),
    );
  });
});

describe('W1/W2: parts never given are missing, not zero', () => {
  const t = (part: string, len: number, correct: boolean) =>
    trial({ part, stimulus: Array(len).fill('1'), correct });
  it('W1 backward never reached (interrupted) → bwd_total null', () => {
    const s = scoreW1([t('fwd', 2, true), t('fwd', 2, false)]).scores;
    expect(s.fwd_total).toBe(1);
    expect(s.bwd_total).toBeNull();
    expect(s.bwd_trials_given).toBe(0);
  });
  it('W2 totals and longest; no trials → null', () => {
    const s = scoreW2([t('lns', 3, true), t('lns', 3, true), t('lns', 4, false)]).scores;
    expect(s).toEqual(expect.objectContaining({ total: 2, longest: 3, trials_given: 3 }));
    expect(scoreW2([]).scores.total).toBeNull();
  });
});

describe('W3 plus–minus', () => {
  const list = (n: number, secPerItem: number, wrong: number[] = []) =>
    Array.from({ length: 30 }, (_, i) =>
      trial({
        part: `list${n}`,
        trialIndex: i,
        onsetMs: i * secPerItem * 1000,
        submitMs: (i + 1) * secPerItem * 1000,
        correct: !wrong.includes(i),
      }),
    );
  it('times, errors, switch cost T3 − ½(T1+T2) and the >3-errors flag', () => {
    const r = scoreW3([...list(1, 2), ...list(2, 2, [1]), ...list(3, 3, [0, 1, 2, 3])]);
    expect(r.scores).toEqual(
      expect.objectContaining({
        t1_s: 60,
        t2_s: 60,
        t3_s: 90,
        e2: 1,
        e3: 4,
        switch_cost_s: 30,
        switch_ratio: 1.5,
      }),
    );
    expect(r.flags).toEqual({ list3_over3_errors: true });
  });
  it('an unfinished list has no time and counts missing items as errors', () => {
    const r = scoreW3([...list(1, 2).slice(0, 10)]);
    expect(r.scores.t1_s).toBeNull();
    expect(r.scores.e1).toBe(20);
    expect(r.scores.e2).toBeNull(); // never given: not "30 errors"
    expect(r.scores.switch_cost_s).toBeNull();
  });
});

describe('W4 word lists', () => {
  it('pre-scoring flags repeats, same-root variants, wrong letters and likely names', () => {
    const pre = prescoreW4(
      [
        { text: 'fish', atMs: 1 },
        { text: 'fish', atMs: 2 },
        { text: 'fishing', atMs: 3 },
        { text: 'apple', atMs: 4 },
        { text: 'Frank', atMs: 5 },
      ],
      'F',
    );
    expect(pre.map((p) => [p.repeat, p.sameRoot, p.wrongLetter, p.likelyName])).toEqual([
      [false, false, false, false],
      [true, false, false, false],
      [false, true, false, false],
      [false, false, true, false],
      [false, false, false, true],
    ]);
    expect(stem('eating')).toBe(stem('eat'));
  });

  it('final scores need rater codes; switching counts correct switches', () => {
    const entries = ['apple', 'chair', 'pear', 'plum', 'sofa'].map((text, i) => ({
      text,
      atMs: i * 1000,
    }));
    const sw = trial({
      part: 'switch',
      response: { entries },
      stimulus: { pair: ['fruits', 'furniture'] },
    });
    const uncoded = scoreW4([sw], new Map());
    expect(uncoded.scores.switch_correct_switches).toBeNull();
    expect(uncoded.flags.awaiting_coding).toBe(true);
    const cat = ['fruit', 'furniture', 'fruit', 'fruit', 'furniture'];
    const codes: FinalCodes = new Map(
      cat.map((c, i) => [`0:switch:${i}`, { code: 'valid', category: c }]),
    );
    const s = scoreW4([sw], codes).scores;
    expect(s.switch_valid).toBe(5);
    expect(s.switch_correct_switches).toBe(3); // apple→chair, chair→pear, plum→sofa
    expect(s.switch_same_category).toBe(1); // pear→plum
    expect(s.switch_switch_ratio).toBe(0.75);
  });
});

describe('W5 sentence completion', () => {
  it('mean first-key RT per part; B error score = 3×A + 1×B once all 15 are coded', () => {
    const t = (part: 'A' | 'B', i: number, rt: number) =>
      trial({
        part,
        trialIndex: i,
        onsetMs: 1000,
        firstInputMs: 1000 + rt,
        response: { prompted: false },
      });
    const trials = [
      ...Array.from({ length: 15 }, (_, i) => t('A', i, 1000)),
      ...Array.from({ length: 15 }, (_, i) => t('B', i, 2000)),
    ];
    const half = scoreW5(trials, new Map([['0:B:0', { code: 'A', category: null }]]));
    expect(half.scores.b_error_score).toBeNull();
    expect(half.flags).toEqual(
      expect.objectContaining({ awaiting_coding: true, w5_unnormed: true }),
    );
    const codes: FinalCodes = new Map(
      Array.from({ length: 15 }, (_, i) => [
        `${i}:B:0`,
        { code: i < 2 ? 'A' : i < 5 ? 'B' : '0', category: null },
      ]),
    );
    const s = scoreW5(trials, codes).scores;
    expect(s).toEqual(
      expect.objectContaining({
        a_mean_rt_ms: 1000,
        b_mean_rt_ms: 2000,
        b_minus_a_rt_ms: 1000,
        b_error_score: 9,
      }),
    );
  });
});

describe('W7 trails', () => {
  it('time, errors, and the 300 s discontinue rule', () => {
    const r = scoreW7([
      trial({
        part: 'P1',
        onsetMs: 0,
        submitMs: 42_500,
        response: { clicks: [{ correct: true }, { correct: false }], reached: 25 },
      }),
      trial({
        part: 'P2',
        onsetMs: 0,
        submitMs: 300_100,
        response: { clicks: [], reached: 17, discontinued: true },
      }),
    ]);
    expect(r.scores).toEqual(
      expect.objectContaining({
        part1_time_s: 42.5,
        part1_errors: 1,
        part2_time_s: 300,
        part2_reached: 17,
      }),
    );
    expect(r.flags).toEqual({ part2_discontinued_300s: true });
  });
});

describe('ADEXI', () => {
  const key = { WM: [1, 2, 5, 7, 8, 9, 11, 12, 13], INH: [3, 4, 6, 10, 14] };
  it('WM 9–45, INH 5–25, and the 12-item variant without items 1 and 14', () => {
    const all5 = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`B${i + 1}`, 5]));
    expect(scoreAdexi(all5, key)!.scores).toEqual({
      wm: 45,
      inh: 25,
      wm_12item: 40,
      inh_12item: 20,
    });
    const all1 = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`B${i + 1}`, 1]));
    expect(scoreAdexi(all1, key)!.scores).toEqual({ wm: 9, inh: 5, wm_12item: 8, inh_12item: 4 });
  });
  it('is not scored with missing items', () => {
    expect(scoreAdexi({ B1: 3 }, key)).toBeNull();
  });
});

describe('Cohen’s kappa', () => {
  it('1 for perfect agreement, 0 for chance-level', () => {
    expect(
      cohensKappa([
        ['A', 'A'],
        ['B', 'B'],
        ['0', '0'],
      ]),
    ).toBe(1);
    expect(
      cohensKappa([
        ['A', 'A'],
        ['A', 'B'],
        ['B', 'A'],
        ['B', 'B'],
      ]),
    ).toBe(0);
  });
});
