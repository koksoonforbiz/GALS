/**
 * Questionnaire composition and answer validation (pure, unit-tested).
 * Item text comes from battery-extras.json (generated from ef.py, verbatim).
 *
 * Per occasion (decision Q2: the questionnaire comes before the puzzles):
 *   before = [T0: Part A (A13 only if enabled) + Part B]  [T2: Part B if adexiAtT2]  + C1–C7
 *   after  = C8–C9
 * Every item is required; free text attached to an "Other:", "please
 * describe" or follow-up option is optional. "Prefer not to say" is an answer.
 */
import type { PuzzleQuestionItem, PuzzleQuestionSection } from '@ats/shared';

export type Occasion = 'T0' | 'T1' | 'T2';

export interface ExtrasQuestionnaire {
  title: string;
  footer: string;
  partA: { heading: string; items: Array<PuzzleQuestionItem & { flag?: string }> };
  partB: {
    heading: string;
    instructions: string;
    scale: Array<{ value: number; label: string }>;
    items: Array<{ code: string; text: string }>;
    key: { WM: number[]; INH: number[] };
    attribution: string;
  };
  partCBefore: PuzzleQuestionItem[];
  partCAfter: PuzzleQuestionItem[];
}

export interface QuestionnaireOptions {
  showDiagnosisItem: boolean;
  adexiAtT2: boolean;
}

export function sectionsFor(
  q: ExtrasQuestionnaire,
  occasion: Occasion,
  part: 'before' | 'after',
  opts: QuestionnaireOptions,
): PuzzleQuestionSection[] {
  if (part === 'after') {
    return [{ key: 'after', heading: 'After the puzzles', items: q.partCAfter }];
  }
  const out: PuzzleQuestionSection[] = [];
  if (occasion === 'T0') {
    out.push({
      key: 'about',
      heading: q.partA.heading,
      items: q.partA.items
        .filter((i) => i.flag !== 'efShowDiagnosisItem' || opts.showDiagnosisItem)
        .map(({ flag: _flag, ...i }) => i),
    });
  }
  if (occasion === 'T0' || (occasion === 'T2' && opts.adexiAtT2)) {
    const scaleLabels = q.partB.scale.map((s) => s.label);
    out.push({
      key: 'usually',
      heading: q.partB.heading,
      instructions: q.partB.instructions,
      attribution: q.partB.attribution,
      items: q.partB.items.map((i) => ({
        code: i.code,
        text: i.text,
        type: 'scale',
        min: 1,
        max: 5,
        scaleLabels,
      })),
    });
  }
  out.push({ key: 'today', heading: 'How you are feeling today', items: q.partCBefore });
  return out;
}

export const itemsOf = (sections: PuzzleQuestionSection[]) => sections.flatMap((s) => s.items);

export class AnswerError extends Error {}

const isStr = (v: unknown, max = 500): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const optStr = (v: unknown, max = 500) =>
  v === undefined || v === null || v === '' || (typeof v === 'string' && v.length <= max);

/** Validate and normalise one answer. Throws AnswerError with a learner-friendly message. */
export function validateAnswer(item: PuzzleQuestionItem, value: unknown): unknown {
  switch (item.type) {
    case 'number': {
      const n = typeof value === 'string' ? Number(value.trim()) : value;
      if (typeof n !== 'number' || !Number.isFinite(n))
        throw new AnswerError('Please enter a number');
      if ((item.min != null && n < item.min) || (item.max != null && n > item.max)) {
        throw new AnswerError(`Please enter a number between ${item.min} and ${item.max}`);
      }
      if (item.step && Math.abs(n / item.step - Math.round(n / item.step)) > 1e-9) {
        throw new AnswerError(`Please round to the nearest ${item.step}`);
      }
      return n;
    }
    case 'scale': {
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < item.min! ||
        value > item.max!
      ) {
        throw new AnswerError('Please choose one of the options');
      }
      return value;
    }
    case 'text': {
      if (!isStr(value)) throw new AnswerError('Please answer this question');
      return value.trim();
    }
    case 'text2': {
      const v = value as { first?: unknown; second?: unknown } | null;
      if (!v || !isStr(v.first) || !isStr(v.second))
        throw new AnswerError('Please answer both parts');
      return { first: (v.first as string).trim(), second: (v.second as string).trim() };
    }
    case 'choice': {
      const v = (typeof value === 'string' ? { option: value } : value) as {
        option?: unknown;
        other?: unknown;
        describe?: unknown;
        when?: unknown;
      } | null;
      if (!v || typeof v.option !== 'string' || !item.options!.includes(v.option)) {
        throw new AnswerError('Please choose one of the options');
      }
      const out: Record<string, string> = { option: v.option };
      for (const k of ['other', 'describe', 'when'] as const) {
        if (!optStr(v[k])) throw new AnswerError('That answer is too long');
        if (typeof v[k] === 'string' && (v[k] as string).trim()) out[k] = (v[k] as string).trim();
      }
      // Free text only belongs to the option that asks for it.
      if (out.other && v.option !== item.otherOption) delete out.other;
      if (out.describe && v.option !== item.describeOption) delete out.describe;
      if (out.when && !item.followup?.when.includes(v.option)) delete out.when;
      return out;
    }
    default:
      throw new AnswerError('Unknown question');
  }
}

/** Item codes in `sections` with no saved answer. */
export function missingAnswers(
  sections: PuzzleQuestionSection[],
  answered: ReadonlySet<string>,
): string[] {
  return itemsOf(sections)
    .map((i) => i.code)
    .filter((c) => !answered.has(c));
}
