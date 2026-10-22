import * as path from 'path';
import { loadBatteryFiles } from '../battery/battery-files';
import { advance, isFinished, startProgress } from './engine';
import { evaluateStep } from './evaluate';
import { stepView, taskSteps, type Extras, type Step, type TaskCode } from './steps';

const files = loadBatteryFiles(path.resolve(__dirname, '../../../../../docs/EF_battery_v2'));
const extras = files.extras as unknown as Extras;
const steps = (task: TaskCode, form = 'A') => taskSteps(task, files.stimuli, form, extras);
const t = { onsetMs: 0, submitMs: 1000, focusLostMs: 0 };

describe('taskSteps', () => {
  it.each([
    ['w1', 2 + 16 + 14],
    ['w2', 2 + 12],
    ['w3', 3 + 3 + 4 + 3],
    ['w4', 5],
    ['w5', 2 + 15 + 2 + 15],
    ['w6', 9],
    ['w7', 4],
  ] as const)('%s has %i steps for every form', (task, n) => {
    for (const f of ['A', 'B', 'C']) expect(steps(task, f)).toHaveLength(n);
  });

  it('never sends a key to the browser', () => {
    for (const task of ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'] as const) {
      for (const s of steps(task)) expect(Object.keys(stepView(s))).not.toContain('key');
    }
    // W5: the expected word is not in the payload.
    for (const s of steps('w5')) {
      const expected = (s.key as { expected: string }).expected;
      expect(JSON.stringify(s.payload)).not.toContain(`"${expected}"`);
    }
    // W1 backward shows the presented order, not the reversed answer.
    const bwd = steps('w1').find((s) => s.part === 'bwd' && s.phase === 'test')!;
    expect((bwd.payload as { items: string[] }).items).toEqual(
      files.stimuli.forms.A.dsb.trials[0]!.map(String),
    );
  });

  it('W6 cells follow the reading order of stimuli.json (down the columns)', () => {
    const grid = steps('w6').find((s) => s.id === 'w6.CW.grid')!;
    const cells = (grid.payload as { cells: Array<{ text: string; ink: string }> }).cells;
    expect(cells.map((c) => c.ink)).toEqual(files.stimuli.forms.A.stroop.cw_ink);
    expect(cells.map((c) => c.text.toLowerCase())).toEqual(files.stimuli.forms.A.stroop.cw_words);
  });
});

describe('engine', () => {
  const w1 = steps('w1');

  it('repeats a wrong W1 practice item once, then moves on', () => {
    let p = advance(w1, startProgress(), false);
    expect(p).toEqual(expect.objectContaining({ pos: 0, attempt: 2 }));
    p = advance(w1, p, false);
    expect(p).toEqual(expect.objectContaining({ pos: 1, attempt: 1 }));
  });

  it('discontinues a part after both trials of one length are wrong', () => {
    let p = advance(w1, startProgress(), true); // practice
    p = advance(w1, p, false); // length 2, trial 1
    expect(p.pos).toBe(2);
    p = advance(w1, p, false); // length 2, trial 2 → forward discontinued
    expect(p.discontinued).toEqual(['fwd']);
    expect(w1[p.pos]!.id).toBe('w1.bwd.p0');
  });

  it('one correct trial at a length continues', () => {
    let p = advance(w1, startProgress(), true);
    p = advance(w1, p, true);
    p = advance(w1, p, false);
    expect(p.discontinued).toEqual([]);
    expect(w1[p.pos]!.id).toBe('w1.fwd.t2');
  });

  it('finishes after the last step', () => {
    const w7 = steps('w7');
    let p = startProgress();
    for (let i = 0; i < w7.length; i++) p = advance(w7, p, null);
    expect(isFinished(w7, p)).toBe(true);
  });
});

describe('evaluateStep (server re-scores everything)', () => {
  const find = (task: TaskCode, id: string): Step => steps(task).find((s) => s.id === id)!;

  it('W1 backward: the reversed sequence is correct; feedback only on practice', () => {
    const s = find('w1', 'w1.bwd.t0');
    const answer = [...(s.payload as { items: string[] }).items].reverse().join(' ');
    const ev = evaluateStep(s, 1, {
      kind: 'sequence',
      response: answer,
      shownMs: [800, 800],
      ...t,
    });
    expect(ev.correct).toBe(true);
    expect(ev.feedback).toBeUndefined();
    const p = find('w1', 'w1.bwd.p0');
    expect(
      evaluateStep(p, 1, { kind: 'sequence', response: '7 3', shownMs: [800, 800], ...t }).feedback,
    ).toEqual(expect.objectContaining({ correct: false, answer: '3 7', retry: true }));
  });

  it('W2: case and separators are ignored', () => {
    const s = find('w2', 'w2.t0'); // 8-J-4 → 4 8 J
    expect(
      evaluateStep(s, 1, { kind: 'sequence', response: '4, 8 - j', shownMs: [], ...t }).correct,
    ).toBe(true);
  });

  it('W3: list responses are scored item by item', () => {
    const s = find('w3', 'w3.list1');
    const nums = (s.payload as { numbers: number[] }).numbers;
    const responses = nums.map((n, i) => ({
      response: String(i === 3 ? n : n + 3),
      onsetMs: i,
      submitMs: i + 1,
    }));
    const ev = evaluateStep(s, 1, { kind: 'list', responses, startMs: 0, endMs: 60_000 });
    expect(ev.rows).toHaveLength(30);
    expect(ev.rows.filter((r) => !r.correct).map((r) => r.trialIndex)).toEqual([3]);
  });

  it('W6: presses are checked against the page key, wrapping after a restart', () => {
    const s = find('w6', 'w6.CW.grid');
    const key = s.key as string[];
    const wrong = key[1] === 'red' ? 'green' : 'red';
    const ev = evaluateStep(s, 1, {
      kind: 'grid',
      presses: [
        { i: 0, key: key[0] as 'red', atMs: 100 },
        { i: 1, key: wrong as 'red', atMs: 200 },
        { i: 100, key: key[0] as 'red', atMs: 300 },
      ],
      startMs: 0,
      endMs: 45_000,
    });
    expect(
      (ev.rows[0]!.response as { presses: Array<{ correct: boolean }> }).presses.map(
        (p) => p.correct,
      ),
    ).toEqual([true, false, true]);
  });

  it('W7: each click is checked against the next label still to reach', () => {
    const s = find('w7', 'w7.P2');
    const ev = evaluateStep(s, 1, {
      kind: 'trail',
      clicks: [
        { label: '1', atMs: 1 },
        { label: '2', atMs: 2 },
        { label: 'A', atMs: 3 },
      ],
      startMs: 0,
      endMs: 5,
      pxPerMm: 3,
    });
    const r = ev.rows[0]!.response as { clicks: Array<{ correct: boolean }>; reached: number };
    expect(r.clicks.map((c) => c.correct)).toEqual([true, false, true]);
    expect(r.reached).toBe(2);
  });

  it('W5 practice: Part B feedback flags a word that fits; test items are left for coding', () => {
    const pb = find('w5', 'w5.B.p0'); // hens lay fresh ___ → eggs
    expect(
      evaluateStep(pb, 1, { kind: 'sentence', response: 'Eggs', ...t }).feedback?.correct,
    ).toBe(false);
    expect(
      evaluateStep(pb, 1, { kind: 'sentence', response: 'piano', ...t }).feedback?.correct,
    ).toBe(true);
    const test = find('w5', 'w5.B.t0');
    const ev = evaluateStep(test, 1, { kind: 'sentence', response: 'saw', ...t });
    expect(ev.feedback).toBeUndefined();
    expect(ev.rows[0]!.correct).toBeNull();
  });
});
