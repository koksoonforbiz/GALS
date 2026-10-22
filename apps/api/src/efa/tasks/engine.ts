/**
 * Walks a task's step list (pure). Rules from the facilitator scripts:
 *  - a practice step marked repeatOnFail is given once more after a wrong answer (W1);
 *  - W1/W2 discontinue a part once BOTH trials of one length are wrong
 *    (steps sharing a `group`); the rest of that part is skipped.
 */
import type { Step } from './steps';

export interface Progress {
  pos: number;
  attempt: number;
  /** group → results of its trials so far */
  groups: Record<string, boolean[]>;
  /** parts ended early by the discontinue rule */
  discontinued: string[];
}

export const startProgress = (): Progress => ({ pos: 0, attempt: 1, groups: {}, discontinued: [] });

export function currentStep(steps: Step[], p: Progress): Step | null {
  return steps[p.pos] ?? null;
}

/** Progress after the current step's result. `correct` is null where nothing is scored yet. */
export function advance(steps: Step[], p: Progress, correct: boolean | null): Progress {
  const step = steps[p.pos];
  if (!step) return p;
  const next: Progress = {
    pos: p.pos,
    attempt: 1,
    groups: { ...p.groups },
    discontinued: [...p.discontinued],
  };

  if (step.phase === 'practice' && step.repeatOnFail && correct === false && p.attempt === 1) {
    return { ...next, attempt: 2 };
  }

  next.pos = p.pos + 1;
  if (step.group && correct != null) {
    const results = [...(next.groups[step.group] ?? []), correct];
    next.groups[step.group] = results;
    if (results.length >= 2 && results.every((r) => !r)) {
      next.discontinued.push(step.part);
      while (next.pos < steps.length && steps[next.pos]!.part === step.part) next.pos++;
    }
  }
  return next;
}

export const isFinished = (steps: Step[], p: Progress) => p.pos >= steps.length;
