/**
 * Task scripts: each puzzle as an ordered list of steps, generated
 * deterministically from the student's form (stimuli.json) and the battery
 * extras. Pure — regenerated on every request, never stored.
 *
 * A step has a `payload` (sent to the browser, no answers) and a `key`
 * (server-only). The engine (engine.ts) walks the list, applying practice
 * repeats and the discontinue rules; evaluate.ts scores each result.
 */
import { digitSpanAnswer, lnsAnswer, pmAnswer } from '../battery/keys';
import type { Colour } from '../battery/keys';
import type { EfaForm, EfaStimuli } from '../battery/stimuli.types';

export type TaskCode = 'w1' | 'w2' | 'w3' | 'w4' | 'w5' | 'w6' | 'w7';
export type StepKind = 'sequence' | 'item' | 'list' | 'prompt' | 'sentence' | 'grid' | 'trail';

export interface Step {
  id: string;
  kind: StepKind;
  phase: 'practice' | 'test';
  /** part code stored on the trial (fwd, bwd, list1, letter1, A, B, W, C, CW, P1, P2, …) */
  part: string;
  index: number;
  /** discontinue group: both trials of a length within a part */
  group?: string;
  /** practice item that is given once more if answered wrongly */
  repeatOnFail?: boolean;
  payload: Record<string, unknown>;
  key?: unknown;
}

export interface Extras {
  digitSpan: { onMs: number; offMs: number };
  fluency: { secondsPerPrompt: number };
  hayling: {
    practice: Record<'A' | 'B', Array<{ sentence: string; expected: string }>>;
    codingExamples: Record<string, { a: string; b: string }>;
    promptAfterMs: number;
  };
  stroop: { rows: number; cols: number; secondsPerPage: number };
  tmt: {
    fieldMm: [number, number];
    sampleFieldMm: [number, number];
    circleDiameterMm: number;
    beginEndOffsetMm: number;
    labelsA: string[];
    labelsB: string[];
    discontinueSeconds: number;
  };
}

const SEQ = (ex: Extras) => ({ onMs: ex.digitSpan.onMs, offMs: ex.digitSpan.offMs });

function digitSpan(form: EfaForm, ex: Extras): Step[] {
  const out: Step[] = [];
  for (const part of ['fwd', 'bwd'] as const) {
    const src = part === 'fwd' ? form.dsf : form.dsb;
    src.practice.forEach((seq, i) =>
      out.push({
        id: `w1.${part}.p${i}`,
        kind: 'sequence',
        phase: 'practice',
        part,
        index: i,
        repeatOnFail: true,
        payload: { items: seq.map(String), direction: part, ...SEQ(ex) },
        key: digitSpanAnswer(seq, part).map(String),
      }),
    );
    src.trials.forEach((seq, i) =>
      out.push({
        id: `w1.${part}.t${i}`,
        kind: 'sequence',
        phase: 'test',
        part,
        index: i,
        group: `${part}:${seq.length}`,
        payload: { items: seq.map(String), direction: part, length: seq.length, ...SEQ(ex) },
        key: digitSpanAnswer(seq, part).map(String),
      }),
    );
  }
  return out;
}

function lettersNumbers(form: EfaForm, ex: Extras): Step[] {
  return [
    ...form.lns.practice.map<Step>((items, i) => ({
      id: `w2.p${i}`,
      kind: 'sequence',
      phase: 'practice',
      part: 'lns',
      index: i,
      payload: { items, ...SEQ(ex) },
      key: lnsAnswer(items),
    })),
    ...form.lns.trials.map<Step>((items, i) => ({
      id: `w2.t${i}`,
      kind: 'sequence',
      phase: 'test',
      part: 'lns',
      index: i,
      group: `lns:${items.length}`,
      payload: { items, length: items.length, ...SEQ(ex) },
      key: lnsAnswer(items),
    })),
  ];
}

function plusMinus(form: EfaForm): Step[] {
  const practice: Array<[string, number[], (i: number) => string]> = [
    ['plus', form.pm.practice.plus, () => '+'],
    ['minus', form.pm.practice.minus, () => '-'],
    ['alt', form.pm.practice.alt, (i) => (i % 2 === 0 ? '+' : '-')],
  ];
  const out: Step[] = [];
  for (const [part, nums, op] of practice) {
    nums.forEach((n, i) =>
      out.push({
        id: `w3.p.${part}${i}`,
        kind: 'item',
        phase: 'practice',
        part: `practice-${part}`,
        index: i,
        payload: { number: n, list: part, first: i === 0 },
        key: pmAnswer(n, op(i)),
      }),
    );
  }
  form.pm.lists.forEach((L, li) =>
    out.push({
      id: `w3.list${li + 1}`,
      kind: 'list',
      phase: 'test',
      part: `list${li + 1}`,
      index: 0,
      payload: { list: li + 1, numbers: L.items },
      key: L.items.map((n, i) => pmAnswer(n, L.ops[i]!)),
    }),
  );
  return out;
}

function wordLists(form: EfaForm, ex: Extras): Step[] {
  const seconds = ex.fluency.secondsPerPrompt;
  return [
    ...form.flu.letters.map<Step>((letter, i) => ({
      id: `w4.letter${i + 1}`,
      kind: 'prompt',
      phase: 'test',
      part: `letter${i + 1}`,
      index: 0,
      payload: { prompt: 'letter', letter, seconds },
    })),
    {
      id: 'w4.category',
      kind: 'prompt',
      phase: 'test',
      part: 'category',
      index: 0,
      payload: { prompt: 'category', category: form.flu.cat, seconds },
    },
    {
      id: 'w4.switch',
      kind: 'prompt',
      phase: 'test',
      part: 'switch',
      index: 0,
      payload: { prompt: 'switch', pair: form.flu.alt, seconds },
    },
  ];
}

function sentences(form: EfaForm, ex: Extras): Step[] {
  const out: Step[] = [];
  for (const part of ['A', 'B'] as const) {
    ex.hayling.practice[part].forEach((p, i) =>
      out.push({
        id: `w5.${part}.p${i}`,
        kind: 'sentence',
        phase: 'practice',
        part,
        index: i,
        payload: { sentence: p.sentence, part, promptAfterMs: ex.hayling.promptAfterMs },
        key: { expected: p.expected, anchorA: ex.hayling.codingExamples[p.expected]?.a ?? '' },
      }),
    );
    form.hay[part].forEach(([sentence, expected], i) =>
      out.push({
        id: `w5.${part}.t${i}`,
        kind: 'sentence',
        phase: 'test',
        part,
        index: i,
        payload: { sentence, part, promptAfterMs: ex.hayling.promptAfterMs },
        key: { expected },
      }),
    );
  }
  return out;
}

/** 12-item key-mapping block per page (fixed sequence; teaches F/J/K before the timed page). */
const KEYMAP: Colour[] = [
  'red',
  'green',
  'blue',
  'green',
  'red',
  'blue',
  'blue',
  'red',
  'green',
  'red',
  'blue',
  'green',
];
const NEXT: Record<Colour, Colour> = { red: 'green', green: 'blue', blue: 'red' };

type Cell = { text: string; ink: Colour | 'black' };

function stroopCells(page: 'W' | 'C' | 'CW', words: Colour[], inks: Colour[]): Cell[] {
  return words.map((w, i) =>
    page === 'W'
      ? { text: w.toUpperCase(), ink: 'black' }
      : page === 'C'
        ? { text: 'XXXX', ink: inks[i]! }
        : { text: w.toUpperCase(), ink: inks[i]! },
  );
}

function colours(form: EfaForm, ex: Extras): Step[] {
  const s = form.stroop;
  const pages: Array<['W' | 'C' | 'CW', Cell[], Cell[], Cell[]]> = [
    [
      'W',
      stroopCells('W', s.practice.words, s.practice.words),
      stroopCells('W', KEYMAP, KEYMAP),
      stroopCells('W', s.words, s.words),
    ],
    [
      'C',
      stroopCells('C', s.practice.colours, s.practice.colours),
      stroopCells('C', KEYMAP, KEYMAP),
      stroopCells('C', s.colours, s.colours),
    ],
    [
      'CW',
      stroopCells('CW', s.practice.cw_words, s.practice.cw_ink),
      stroopCells(
        'CW',
        KEYMAP.map((c) => NEXT[c]),
        KEYMAP,
      ),
      stroopCells('CW', s.cw_words, s.cw_ink),
    ],
  ];
  const keyOf = (page: 'W' | 'C' | 'CW', cells: Cell[]) =>
    cells.map((c) => (page === 'W' ? c.text.toLowerCase() : c.ink));
  const out: Step[] = [];
  for (const [page, row, keymap, grid] of pages) {
    out.push({
      id: `w6.${page}.keys`,
      kind: 'grid',
      phase: 'practice',
      part: `${page}-keys`,
      index: 0,
      payload: { page, mode: 'keys', cells: keymap },
      key: keyOf(page, keymap),
    });
    out.push({
      id: `w6.${page}.row`,
      kind: 'grid',
      phase: 'practice',
      part: page,
      index: 0,
      payload: { page, mode: 'row', cells: row },
      key: keyOf(page, row),
    });
    out.push({
      id: `w6.${page}.grid`,
      kind: 'grid',
      phase: 'test',
      part: page,
      index: 0,
      payload: {
        page,
        mode: 'grid',
        cells: grid,
        rows: ex.stroop.rows,
        cols: ex.stroop.cols,
        seconds: ex.stroop.secondsPerPage,
      },
      key: keyOf(page, grid),
    });
  }
  return out;
}

function trails(form: EfaForm, stimuli: EfaStimuli, ex: Extras): Step[] {
  const t = ex.tmt;
  const common = {
    circleMm: t.circleDiameterMm,
    beginEndOffsetMm: t.beginEndOffsetMm,
    yAxisUp: true,
  };
  const trail = (
    id: string,
    phase: 'practice' | 'test',
    part: string,
    points: unknown,
    labels: string[],
    fieldMm: [number, number],
  ): Step => ({
    id,
    kind: 'trail',
    phase,
    part,
    index: 0,
    payload: {
      ...common,
      points,
      labels,
      fieldMm,
      ...(phase === 'test' ? { discontinueSeconds: t.discontinueSeconds } : {}),
    },
    key: labels,
  });
  return [
    trail(
      'w7.P1.sample',
      'practice',
      'P1',
      stimuli.meta.tmt_samples.A,
      stimuli.meta.tmt_samples.A_labels,
      t.sampleFieldMm,
    ),
    trail('w7.P1', 'test', 'P1', form.tmtA, t.labelsA, t.fieldMm),
    trail(
      'w7.P2.sample',
      'practice',
      'P2',
      stimuli.meta.tmt_samples.B,
      stimuli.meta.tmt_samples.B_labels,
      t.sampleFieldMm,
    ),
    trail('w7.P2', 'test', 'P2', form.tmtB, t.labelsB, t.fieldMm),
  ];
}

export function taskSteps(
  task: TaskCode,
  stimuli: EfaStimuli,
  formLetter: string,
  extras: Extras,
): Step[] {
  const form = stimuli.forms[formLetter as 'A' | 'B' | 'C'];
  if (!form) throw new Error(`unknown form ${formLetter}`);
  switch (task) {
    case 'w1':
      return digitSpan(form, extras);
    case 'w2':
      return lettersNumbers(form, extras);
    case 'w3':
      return plusMinus(form);
    case 'w4':
      return wordLists(form, extras);
    case 'w5':
      return sentences(form, extras);
    case 'w6':
      return colours(form, extras);
    case 'w7':
      return trails(form, stimuli, extras);
  }
}

/** What the browser receives for a step: never the key. */
export function stepView(step: Step) {
  return {
    id: step.id,
    kind: step.kind,
    phase: step.phase,
    part: step.part,
    index: step.index,
    payload: step.payload,
  };
}
