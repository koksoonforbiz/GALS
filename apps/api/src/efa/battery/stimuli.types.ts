/** Shape of docs/EF_battery_v2/source/stimuli.json (battery v2.0). */
import type { Colour } from './keys';

export interface EfaForm {
  form: 'A' | 'B' | 'C';
  seed: number;
  dsf: { practice: number[][]; trials: number[][] };
  dsb: { practice: number[][]; trials: number[][] };
  lns: { practice: string[][]; trials: string[][] };
  pm: {
    lists: Array<{ op: '+' | '-' | '+/-'; items: number[]; ops: string[] }>;
    practice: { plus: number[]; minus: number[]; alt: number[] };
  };
  flu: { letters: string[]; cat: string; alt: [string, string] };
  /** [sentence with final ___, expected word] */
  hay: { A: Array<[string, string]>; B: Array<[string, string]> };
  stroop: {
    words: Colour[];
    colours: Colour[];
    cw_words: Colour[];
    cw_ink: Colour[];
    practice: { words: Colour[]; colours: Colour[]; cw_words: Colour[]; cw_ink: Colour[] };
  };
  /** circle centres in mm, label order, origin bottom-left, y up */
  tmtA: Array<[number, number]>;
  tmtB: Array<[number, number]>;
}

export interface EfaStimuli {
  meta: {
    version: string;
    date: string;
    code_sha256: string;
    tmt_samples: {
      A: Array<[number, number]>;
      B: Array<[number, number]>;
      A_labels: string[];
      B_labels: string[];
    };
    [k: string]: unknown;
  };
  forms: Record<'A' | 'B' | 'C', EfaForm>;
  adexi: { items: string[]; key: { WM: number[]; INH: number[] } };
  cloze_order: unknown[];
}
