/**
 * Recompute every answer key from stimuli.json and check it against the
 * printed scoring_key.tex (W3, W6) and facilitator_record_<F>.tex (W1, W2),
 * for all three forms. Guards the TypeScript port of ef.py.
 */
import * as fs from 'fs';
import * as path from 'path';
import { digitSpanAnswer, lnsAnswer, pmAnswer, stroopCell, stroopKey, STROOP_ROWS } from './keys';
import type { EfaStimuli } from './stimuli.types';

const SRC = path.resolve(__dirname, '../../../../../docs/EF_battery_v2/source');
const stimuli = JSON.parse(fs.readFileSync(path.join(SRC, 'stimuli.json'), 'utf8')) as EfaStimuli;
const scoringKey = fs.readFileSync(path.join(SRC, 'scoring_key.tex'), 'utf8');
const FORMS = ['A', 'B', 'C'] as const;
const SECTION_NO = { A: '2.1', B: '2.2', C: '2.3' } as const;

function between(text: string, start: string, end: string | null): string {
  const i = text.indexOf(start);
  if (i < 0) throw new Error(`marker not found: ${start}`);
  const j = end ? text.indexOf(end, i + start.length) : -1;
  return text.slice(i, j < 0 ? undefined : j);
}

/** Facilitator table rows: [length|Practice, trial, say, correct]. */
function recordRows(section: string) {
  const rows: Array<{ practice: boolean; say: string[]; correct: string[] }> = [];
  const re = /^(Practice|\d+) & (--|\d+) & ([^&]+?) & ([^&]+?) &/gm;
  for (const m of section.matchAll(re)) {
    rows.push({
      practice: m[1] === 'Practice',
      say: m[3]!.trim().split('--'),
      correct: m[4]!.trim().split('--'),
    });
  }
  return rows;
}

describe.each(FORMS)('Form %s answer keys match the printed materials', (F) => {
  const form = stimuli.forms[F];
  const record = fs.readFileSync(path.join(SRC, `facilitator_record_${F}.tex`), 'utf8');
  const keySection = between(
    scoringKey,
    `\\section*{${SECTION_NO[F]} Form ${F} answer key}`,
    F === 'C' ? null : '\\section*{',
  );

  it('W1 forward: sequence as given', () => {
    const rows = recordRows(between(record, '\\textbf{Forward}', '\\textbf{Backward}'));
    const seqs = [...form.dsf.practice, ...form.dsf.trials];
    expect(rows).toHaveLength(seqs.length);
    rows.forEach((r, i) => {
      expect(r.say.map(Number)).toEqual(seqs[i]);
      expect(r.correct.map(Number)).toEqual(digitSpanAnswer(seqs[i]!, 'fwd'));
    });
  });

  it('W1 backward: reversed', () => {
    const rows = recordRows(between(record, '\\textbf{Backward}', '\\section*{W2'));
    const seqs = [...form.dsb.practice, ...form.dsb.trials];
    expect(rows).toHaveLength(seqs.length);
    rows.forEach((r, i) => {
      expect(r.say.map(Number)).toEqual(seqs[i]);
      expect(r.correct.map(Number)).toEqual(digitSpanAnswer(seqs[i]!, 'bwd'));
    });
  });

  it('W2: numbers ascending, then letters alphabetical', () => {
    const rows = recordRows(between(record, '\\section*{W2', '\\section*{W3'));
    const seqs = [...form.lns.practice, ...form.lns.trials];
    expect(rows).toHaveLength(seqs.length);
    rows.forEach((r, i) => {
      expect(r.say).toEqual(seqs[i]);
      expect(r.correct).toEqual(lnsAnswer(seqs[i]!));
    });
  });

  it('W3: every list item n -> n±3 per its op', () => {
    const pairs = [...keySection.matchAll(/(\d+)\$\\to\$\\textbf\{(-?\d+)\}/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    // Table rows: item n and n+15, each with L1, L2, L3.
    expect(pairs).toHaveLength(90);
    for (let row = 0; row < 15; row++) {
      for (const [half, offset] of [
        [0, 0],
        [1, 15],
      ] as const) {
        for (let list = 0; list < 3; list++) {
          const [n, ans] = pairs[row * 6 + half * 3 + list]!;
          const L = form.pm.lists[list]!;
          const idx = row + offset;
          expect(n).toBe(L.items[idx]);
          expect(ans).toBe(pmAnswer(L.items[idx]!, L.ops[idx]!));
        }
      }
    }
  });

  it('W6: W, C, CW key grids (read down each column)', () => {
    const rows = [
      ...keySection.matchAll(/([RGB]) & ([RGB]) & ([RGB]) & ([RGB]) & ([RGB])\\\\/g),
    ].map((m) => m.slice(1, 6));
    expect(rows).toHaveLength(3 * STROOP_ROWS);
    (['W', 'C', 'CW'] as const).forEach((page, p) => {
      const key = stroopKey(form.stroop, page);
      for (let r = 0; r < STROOP_ROWS; r++) {
        const printed = rows[p * STROOP_ROWS + r]!;
        const computed = [0, 1, 2, 3, 4].map((c) => stroopCell(key, r, c)[0]!.toUpperCase());
        expect(computed).toEqual(printed);
      }
    });
  });
});

describe('battery invariants the app relies on', () => {
  it('CW page is 0% congruent and shares its words with the W page', () => {
    for (const F of FORMS) {
      const s = stimuli.forms[F].stroop;
      expect(s.cw_words).toEqual(s.words);
      s.cw_ink.forEach((ink, i) => expect(ink).not.toBe(s.cw_words[i]));
    }
  });

  it('ADEXI key covers items 1-14 exactly once', () => {
    const all = [...stimuli.adexi.key.WM, ...stimuli.adexi.key.INH].sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
  });
});
