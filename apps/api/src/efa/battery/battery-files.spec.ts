/**
 * Integrity of the frozen battery files the seed reads: hashes cross-check,
 * allocation is six orders in permuted blocks of 6, and every questionnaire
 * text in battery-extras.json is verbatim from the source (questionnaires.tex
 * for Part A/C wording, stimuli.json for the ADEXI items).
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadBatteryFiles, parseAllocationCsv, sha256 } from './battery-files';

const DIR = path.resolve(__dirname, '../../../../../docs/EF_battery_v2');
const files = loadBatteryFiles(DIR);
const extras = files.extras as unknown as {
  questionnaire: {
    partA: { items: Array<{ code: string; text: string; options?: string[] }> };
    partB: {
      instructions: string;
      items: Array<{ code: string; text: string }>;
      scale: Array<{ label: string }>;
    };
    partCBefore: Array<{ code: string; text: string }>;
    partCAfter: Array<{ code: string; text: string }>;
  };
};

/** questionnaires.tex as displayed text (LaTeX markup removed, -- as en dash). */
const qtex = fs
  .readFileSync(path.join(DIR, 'source', 'questionnaires.tex'), 'utf8')
  .replace(/---/g, '—')
  .replace(/--/g, '–')
  .replace(/\\(bx|quad|par)\b\\?\s*/g, ' ')
  .replace(/\\blank\[[^\]]*\]/g, ' ')
  .replace(/\\emph\{([^}]*)\}/g, '$1')
  .replace(/\\&/g, '&')
  .replace(/\\ldots\{?\}?/g, '...')
  .replace(/\s+/g, ' ');

describe('EF battery files', () => {
  it('stimuli.json is the reviewed v2.0 file', () => {
    expect(files.stimuli.meta.version).toBe('2.0');
    expect(files.stimuliSha256).toBe(
      'a705e66707fb0f67f7d73241957dc12b73a0c61eca0b204584d251a97e2dd832',
    );
  });

  it('battery-extras.json was built from this stimuli.json and ef.py', () => {
    expect(files.extras.stimuli_sha256).toBe(files.stimuliSha256);
    expect(files.extras.ef_sha256).toBe(files.stimuli.meta.code_sha256);
    expect(sha256(fs.readFileSync(path.join(DIR, 'source', 'ef.py')))).toBe(
      files.stimuli.meta.code_sha256,
    );
  });

  it('allocation: 60 slots, 10 blocks, each block holds all six orders once', () => {
    expect(files.allocation).toHaveLength(60);
    const blocks = new Map<number, string[]>();
    for (const r of files.allocation)
      blocks.set(r.block, [...(blocks.get(r.block) ?? []), r.orderCode]);
    expect(blocks.size).toBe(10);
    for (const orders of blocks.values()) {
      expect([...orders].sort()).toEqual(['ABC', 'ACB', 'BAC', 'BCA', 'CAB', 'CBA']);
    }
    expect(files.allocation.map((r) => r.slot)).toEqual(
      Array.from({ length: 60 }, (_, i) => i + 1),
    );
  });

  it('allocation parser rejects inconsistent rows', () => {
    expect(() => parseAllocationCsv('slot,block,order,T0,T1,T2\n1,1,BCA,B,A,C\n')).toThrow(
      /invalid/,
    );
    expect(() => parseAllocationCsv('slot,order\n1,BCA\n')).toThrow(/header/);
  });

  it('ADEXI items are verbatim from stimuli.json, in order', () => {
    expect(extras.questionnaire.partB.items.map((i) => i.text)).toEqual(files.stimuli.adexi.items);
    expect(extras.questionnaire.partB.items.map((i) => i.code)).toEqual(
      Array.from({ length: 14 }, (_, i) => `B${i + 1}`),
    );
    expect(extras.questionnaire.partB.scale.map((s) => s.label)).toEqual([
      'Definitely not true',
      'Not true',
      'Partially true',
      'True',
      'Definitely true',
    ]);
  });

  it('Part A, B instructions and Part C wording is verbatim from questionnaires.tex', () => {
    const q = extras.questionnaire;
    const texts = [
      ...q.partA.items.flatMap((i) => [i.text, ...(i.options ?? [])]),
      q.partB.instructions,
      ...q.partCBefore.map((i) => i.text),
      ...q.partCAfter.map((i) => i.text),
    ];
    for (const t of texts) expect(qtex).toContain(t);
    expect(q.partA.items.map((i) => i.code)).toEqual(
      Array.from({ length: 13 }, (_, i) => `A${i + 1}`),
    );
    expect([...q.partCBefore, ...q.partCAfter].map((i) => i.code)).toEqual(
      Array.from({ length: 9 }, (_, i) => `C${i + 1}`),
    );
  });
});
