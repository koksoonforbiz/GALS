/**
 * Turn one step's raw browser result into stored trial rows, a correctness
 * value for the engine, and (practice only) feedback. Pure. Correctness is
 * always recomputed here from the server-side key, never trusted from the
 * browser. Students never get correctness on test steps.
 */
import type { PuzzleStepResult } from '@ats/shared';
import { normaliseDigitResponse, normaliseLnsResponse } from '../battery/keys';
import type { Step } from './steps';

export interface TrialRow {
  phase: string;
  part: string;
  trialIndex: number;
  stimulus: unknown;
  response: unknown;
  onsetMs?: number | null;
  firstInputMs?: number | null;
  submitMs?: number | null;
  shownMs?: unknown;
  corrections?: number;
  focusLostMs?: number;
  correct?: boolean | null;
}

export interface Feedback {
  correct: boolean;
  message: string;
  /** shown after a wrong practice answer */
  answer?: string;
  retry?: boolean;
}

export interface Evaluation {
  rows: TrialRow[];
  correct: boolean | null;
  feedback?: Feedback;
}

const eqArr = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z'-]/g, '');

export function evaluateStep(step: Step, attempt: number, r: PuzzleStepResult): Evaluation {
  const trialIndex = step.phase === 'practice' ? step.index * 2 + (attempt - 1) : step.index;
  const timing = {
    onsetMs: 'onsetMs' in r ? r.onsetMs : null,
    firstInputMs: 'firstInputMs' in r ? (r.firstInputMs ?? null) : null,
    submitMs: 'submitMs' in r ? r.submitMs : null,
    focusLostMs: r.focusLostMs ?? 0,
  };

  switch (r.kind) {
    case 'sequence': {
      const key = step.key as string[];
      const got = step.id.startsWith('w1')
        ? normaliseDigitResponse(r.response).map(String)
        : normaliseLnsResponse(r.response);
      const correct = eqArr(got, key);
      const row: TrialRow = {
        phase: step.phase,
        part: step.part,
        trialIndex,
        stimulus: (step.payload as { items: string[] }).items,
        response: { raw: r.response, normalised: got },
        shownMs: r.shownMs,
        corrections: r.corrections ?? 0,
        ...timing,
        correct,
      };
      const feedback =
        step.phase === 'practice'
          ? {
              correct,
              message: correct ? 'Correct.' : 'Not quite.',
              ...(correct ? {} : { answer: key.join(' ') }),
              retry: !correct && !!step.repeatOnFail && attempt === 1,
            }
          : undefined;
      return { rows: [row], correct, feedback };
    }

    case 'item': {
      const key = step.key as number;
      const n = Number(r.response.trim());
      const correct = Number.isFinite(n) && n === key;
      return {
        rows: [
          {
            phase: step.phase,
            part: step.part,
            trialIndex,
            stimulus: (step.payload as { number: number }).number,
            response: { raw: r.response },
            corrections: r.corrections ?? 0,
            ...timing,
            correct,
          },
        ],
        correct,
        feedback: {
          correct,
          message: correct ? 'Correct.' : 'Not quite.',
          ...(correct ? {} : { answer: String(key) }),
        },
      };
    }

    case 'list': {
      const key = step.key as number[];
      const numbers = (step.payload as { numbers: number[] }).numbers;
      const rows = numbers.map<TrialRow>((num, i) => {
        const resp = r.responses[i];
        const n = resp ? Number(resp.response.trim()) : NaN;
        return {
          phase: step.phase,
          part: step.part,
          trialIndex: i,
          stimulus: num,
          response: resp ? { raw: resp.response } : null,
          onsetMs: resp?.onsetMs ?? null,
          firstInputMs: resp?.firstInputMs ?? null,
          submitMs: resp?.submitMs ?? null,
          corrections: resp?.corrections ?? 0,
          focusLostMs: i === 0 ? (r.focusLostMs ?? 0) : 0,
          correct: Number.isFinite(n) && n === key[i],
        };
      });
      return { rows, correct: null };
    }

    case 'sentence': {
      const { expected, anchorA } = step.key as { expected: string; anchorA?: string };
      const word = norm(r.response);
      const row: TrialRow = {
        phase: step.phase,
        part: step.part,
        trialIndex,
        stimulus: (step.payload as { sentence: string }).sentence,
        response: { raw: r.response, normalised: word, prompted: !!r.prompted },
        corrections: r.corrections ?? 0,
        ...timing,
        correct: null, // coded by human raters (Phase 6)
      };
      let feedback: Feedback | undefined;
      if (step.phase === 'practice') {
        const fits = word === norm(expected) || (!!anchorA && word === norm(anchorA));
        feedback =
          step.part === 'A'
            ? fits
              ? { correct: true, message: 'Good, that word completes the sentence.' }
              : { correct: false, message: `A word that completes it well would be "${expected}".` }
            : fits
              ? {
                  correct: false,
                  message:
                    'That word fits the sentence. Try a word that has nothing to do with it.',
                }
              : { correct: true, message: 'Good, that word has nothing to do with the sentence.' };
      }
      return { rows: [row], correct: null, feedback };
    }

    case 'prompt':
      return {
        rows: [
          {
            phase: step.phase,
            part: step.part,
            trialIndex: 0,
            stimulus: step.payload,
            response: { entries: r.entries, nudged: !!r.nudged },
            onsetMs: r.startMs,
            submitMs: r.endMs,
            focusLostMs: r.focusLostMs ?? 0,
            correct: null, // pre-scored and coded later (Phase 6)
          },
        ],
        correct: null,
      };

    case 'grid': {
      const key = step.key as string[];
      const presses = r.presses.map((p) => ({ ...p, correct: key[p.i % key.length] === p.key }));
      return {
        rows: [
          {
            phase: step.phase,
            part: step.part,
            trialIndex: 0,
            stimulus: {
              page: (step.payload as { page: string }).page,
              mode: (step.payload as { mode: string }).mode,
            },
            response: { presses, restarts: r.restarts ?? 0 },
            onsetMs: r.startMs,
            submitMs: r.endMs,
            focusLostMs: r.focusLostMs ?? 0,
            correct: null,
          },
        ],
        correct: null,
      };
    }

    case 'trail': {
      const labels = step.key as string[];
      // Each click is checked against the next label still to reach.
      let next = 0;
      const clicks = r.clicks.map((c) => {
        const correct = next < labels.length && c.label === labels[next];
        if (correct) next++;
        return { ...c, correct };
      });
      return {
        rows: [
          {
            phase: step.phase,
            part: step.part,
            trialIndex: 0,
            stimulus: { labels: labels.length },
            response: { clicks, reached: next, discontinued: !!r.discontinued, pxPerMm: r.pxPerMm },
            onsetMs: r.startMs,
            submitMs: r.endMs,
            focusLostMs: r.focusLostMs ?? 0,
            correct: null,
          },
        ],
        correct: null,
      };
    }
  }
}
