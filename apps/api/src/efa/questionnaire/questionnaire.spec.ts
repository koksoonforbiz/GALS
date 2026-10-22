import * as path from 'path';
import { loadBatteryFiles } from '../battery/battery-files';
import {
  AnswerError,
  itemsOf,
  missingAnswers,
  sectionsFor,
  validateAnswer,
  type ExtrasQuestionnaire,
} from './questionnaire';

const files = loadBatteryFiles(path.resolve(__dirname, '../../../../../docs/EF_battery_v2'));
const q = (files.extras as unknown as { questionnaire: ExtrasQuestionnaire }).questionnaire;
const off = { showDiagnosisItem: false, adexiAtT2: false };
const codes = (s: ReturnType<typeof sectionsFor>) => itemsOf(s).map((i) => i.code);
const item = (code: string) =>
  itemsOf(sectionsFor(q, 'T0', 'before', { ...off, showDiagnosisItem: true })).find(
    (i) => i.code === code,
  )!;

describe('sectionsFor', () => {
  it('T0 before: background (A1–A12), the 14 habit items, then today (C1–C7)', () => {
    const s = sectionsFor(q, 'T0', 'before', off);
    expect(s.map((x) => x.key)).toEqual(['about', 'usually', 'today']);
    expect(codes(s)).toEqual([
      ...Array.from({ length: 12 }, (_, i) => `A${i + 1}`),
      ...Array.from({ length: 14 }, (_, i) => `B${i + 1}`),
      ...Array.from({ length: 7 }, (_, i) => `C${i + 1}`),
    ]);
  });

  it('A13 appears only when the diagnosis item is enabled', () => {
    expect(codes(sectionsFor(q, 'T0', 'before', { ...off, showDiagnosisItem: true }))).toContain(
      'A13',
    );
  });

  it('T1 before is the state check only; T2 adds the habit items only when enabled', () => {
    expect(codes(sectionsFor(q, 'T1', 'before', off))).toEqual(
      Array.from({ length: 7 }, (_, i) => `C${i + 1}`),
    );
    expect(codes(sectionsFor(q, 'T2', 'before', off))).toHaveLength(7);
    expect(codes(sectionsFor(q, 'T2', 'before', { ...off, adexiAtT2: true }))).toHaveLength(21);
  });

  it('after = C8–C9 at every occasion', () => {
    expect(codes(sectionsFor(q, 'T1', 'after', off))).toEqual(['C8', 'C9']);
  });

  it('the habit section carries the verbatim instructions, 1–5 labels and attribution', () => {
    const usually = sectionsFor(q, 'T0', 'before', off).find((s) => s.key === 'usually')!;
    expect(usually.heading).toBe('How you usually are');
    expect(usually.attribution).toBe('Items: Holst & Thorell (2018), reproduced unchanged.');
    expect(usually.items[0]!.scaleLabels).toEqual(q.partB.scale.map((x) => x.label));
    expect(usually.items.map((i) => i.text)).toEqual(files.stimuli.adexi.items);
  });

  it('no section heading names a construct', () => {
    const all = JSON.stringify(sectionsFor(q, 'T0', 'before', off).map(({ heading }) => heading));
    expect(all).not.toMatch(/ADEXI|executive|inhibition|working memory/i);
  });
});

describe('validateAnswer', () => {
  it('numbers: range and step (sleep hours in 0.5 steps)', () => {
    expect(validateAnswer(item('C1'), '7.5')).toBe(7.5);
    expect(() => validateAnswer(item('C1'), 25)).toThrow(AnswerError);
    expect(() => validateAnswer(item('C1'), 7.3)).toThrow(/nearest 0.5/);
    expect(validateAnswer(item('A1'), 34)).toBe(34);
  });

  it('0–10 and 1–5 scales take integers in range only', () => {
    expect(validateAnswer(item('C3'), 0)).toBe(0);
    expect(() => validateAnswer(item('C3'), 11)).toThrow(AnswerError);
    expect(validateAnswer(item('B1'), 5)).toBe(5);
    expect(() => validateAnswer(item('B1'), 0)).toThrow(AnswerError);
  });

  it('choices: option must be listed; free text kept only on the option that asks for it', () => {
    expect(validateAnswer(item('A2'), { option: 'Other:', other: 'Apprenticeship' })).toEqual({
      option: 'Other:',
      other: 'Apprenticeship',
    });
    expect(validateAnswer(item('A2'), { option: 'Doctorate', other: 'stray' })).toEqual({
      option: 'Doctorate',
    });
    expect(validateAnswer(item('A8'), { option: 'Yes, elsewhere', when: '2019' })).toEqual({
      option: 'Yes, elsewhere',
      when: '2019',
    });
    expect(validateAnswer(item('C7'), 'Prefer not to say')).toEqual({
      option: 'Prefer not to say',
    });
    expect(() => validateAnswer(item('C6'), 'Maybe')).toThrow(AnswerError);
  });

  it('two-part text requires both parts', () => {
    expect(validateAnswer(item('A5'), { first: 'English', second: 'English' })).toEqual({
      first: 'English',
      second: 'English',
    });
    expect(() => validateAnswer(item('A5'), { first: 'English' })).toThrow(/both parts/);
  });

  it('missingAnswers lists unanswered codes in order', () => {
    const s = sectionsFor(q, 'T1', 'before', off);
    expect(missingAnswers(s, new Set(['C1', 'C2', 'C3']))).toEqual(['C4', 'C5', 'C6', 'C7']);
  });
});
