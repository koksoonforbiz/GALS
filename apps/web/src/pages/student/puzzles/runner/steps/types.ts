import type { PuzzleStepResult, PuzzleStepView } from '@ats/shared';

export interface StepProps {
  step: PuzzleStepView;
  /** performance.now() → ms since the run started (what the server stores) */
  rel: (t: number) => number;
  focus: { take(): number };
  onResult: (result: PuzzleStepResult) => void;
}
