/**
 * Runs one puzzle full screen: instruction screen per part, then each step
 * from the server one at a time, practice feedback, and a break screen at
 * the end. The browser never decides correctness for scoring — it only
 * sends raw responses and timings; the server re-scores everything.
 */
import { useEffect, useRef, useState } from 'react';
import type { PuzzleStepResponse, PuzzleStepResult, PuzzleStepView } from '@ats/shared';
import { api, ApiError } from '../../../../lib/api';
import type { OccasionView } from '../PuzzlesPage';
import { now, useFocusLoss } from './timing';
import { BREAK_TEXT, PART_INSTRUCTIONS, TRAIL_TEST_INSTRUCTIONS } from './wording';
import { SequenceStep } from './steps/SequenceStep';
import { ItemStep, ListStep, SentenceStep } from './steps/TypedSteps';
import { PromptStep } from './steps/PromptStep';
import { GridStep } from './steps/GridStep';
import { TrailStep } from './steps/TrailStep';
import type { StepProps } from './steps/types';

type Phase =
  | { at: 'intro' }
  | { at: 'part'; lines: string[] }
  | { at: 'step' }
  | { at: 'feedback'; fb: NonNullable<PuzzleStepResponse['feedback']> }
  | { at: 'break'; view: OccasionView };

const STEP: Record<PuzzleStepView['kind'], (p: StepProps) => JSX.Element> = {
  sequence: SequenceStep,
  item: ItemStep,
  list: ListStep,
  sentence: SentenceStep,
  prompt: PromptStep,
  grid: GridStep,
  trail: TrailStep,
};

/** Instruction lines shown when a new part starts (or before timed trails/lists). */
function partLines(step: PuzzleStepView, prev: PuzzleStepView | null): string[] | null {
  if (step.kind === 'trail' && step.phase === 'test') {
    return [TRAIL_TEST_INSTRUCTIONS[step.part as 'P1' | 'P2']];
  }
  if (step.kind === 'grid') {
    const page = (step.payload as { page: string; mode: string }).page;
    const mode = (step.payload as { mode: string }).mode;
    if (mode === 'keys') return PART_INSTRUCTIONS[`${page}-keys`] ?? null;
    if (mode === 'row')
      return ['Practice row: press the right key for each item, going along the row.'];
    return null; // the timed page shows its own instruction and waits for the space bar
  }
  if (prev && prev.part === step.part && !(step.kind === 'list')) return null;
  if (
    step.kind === 'list' ||
    (step.phase === 'test' && prev?.phase === 'practice' && prev.part === step.part)
  ) {
    return [
      ...(PART_INSTRUCTIONS[step.part] ?? []),
      step.kind === 'list' ? 'Ready?' : 'Now for real — no more feedback.',
    ];
  }
  return PART_INSTRUCTIONS[step.part] ?? null;
}

export function TaskRunner({
  occasionId,
  task,
  onDone,
}: {
  occasionId: string;
  task: NonNullable<OccasionView['task']>;
  onDone: (v: OccasionView) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ at: 'intro' });
  const [step, setStep] = useState<PuzzleStepView | null>(null);
  const [error, setError] = useState('');
  const runId = useRef('');
  const t0 = useRef(0);
  const prev = useRef<PuzzleStepView | null>(null);
  const pending = useRef<PuzzleStepView | null>(null);
  const focus = useFocusLoss();
  // The Enter that submits an answer must not also skip the next screen.
  const phaseAt = useRef(0);
  useEffect(() => {
    phaseAt.current = now();
  }, [phase]);

  const rel = (t: number) => Math.max(0, Math.round((t - t0.current) * 10) / 10);

  const show = (s: PuzzleStepView) => {
    const lines = partLines(s, prev.current);
    setStep(s);
    setPhase(lines ? { at: 'part', lines } : { at: 'step' });
  };

  const begin = async () => {
    try {
      setError('');
      const r = await api.post<{ runId: string; step: PuzzleStepView }>(
        `/puzzles/occasions/${occasionId}/tasks/${task.code}/begin`,
      );
      runId.current = r.runId;
      t0.current = now();
      focus.take();
      show(r.step);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start. Please try again.');
    }
  };

  const onResult = async (result: PuzzleStepResult) => {
    if (!step) return;
    try {
      const r = await api.post<PuzzleStepResponse & { done?: boolean; view?: OccasionView }>(
        `/puzzles/runs/${runId.current}/steps`,
        { stepId: step.id, attempt: step.attempt, result },
      );
      prev.current = step;
      if (r.done && r.view) {
        setPhase({ at: 'break', view: r.view });
        return;
      }
      pending.current = r.next;
      if (r.feedback) setPhase({ at: 'feedback', fb: r.feedback });
      else if (r.next) show(r.next);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not save your answer. Please check your connection.',
      );
    }
  };

  // Keyboard: Enter/space continues from instruction and feedback screens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.code !== 'Space') return;
      if (now() - phaseAt.current < 400) return;
      if (phase.at === 'part') {
        e.preventDefault();
        setPhase({ at: 'step' });
      } else if (phase.at === 'feedback' && pending.current) {
        e.preventDefault();
        show(pending.current);
      }
    };
    window.addEventListener('keyup', onKey);
    return () => window.removeEventListener('keyup', onKey);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const Step = step ? STEP[step.kind] : null;

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-white" data-testid="puzzle-runner">
      <div className="mx-auto flex min-h-full max-w-5xl flex-col px-6 py-6">
        <p className="text-xs uppercase tracking-wide text-gray-400">
          Puzzle {task.number} of {task.of}
          {step?.phase === 'practice' && phase.at !== 'intro' ? ' · practice' : ''}
        </p>
        <div className="flex flex-1 flex-col justify-center py-6">
          {phase.at === 'intro' && (
            <div className="text-center">
              <p className="text-lg text-gray-800">Ready for the next puzzle?</p>
              <p className="mt-1 text-sm text-gray-500">It starts with a short practice.</p>
              {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
              <button
                onClick={() => void begin()}
                className="mt-6 rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Start puzzle {task.number}
              </button>
            </div>
          )}
          {phase.at === 'part' && (
            <div className="mx-auto max-w-2xl text-center">
              {phase.lines.map((l) => (
                <p key={l} className="mt-2 text-lg leading-relaxed text-gray-800">
                  {l}
                </p>
              ))}
              <button
                onClick={() => setPhase({ at: 'step' })}
                className="mt-8 rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Continue
              </button>
            </div>
          )}
          {phase.at === 'step' && Step && step && (
            <Step
              key={`${step.id}#${step.attempt}`}
              step={step}
              rel={rel}
              focus={focus}
              onResult={(r) => void onResult(r)}
            />
          )}
          {phase.at === 'feedback' && (
            <div className="mx-auto max-w-xl text-center">
              <p
                className={`text-xl font-medium ${phase.fb.correct ? 'text-green-700' : 'text-amber-700'}`}
              >
                {phase.fb.message}
              </p>
              {phase.fb.answer && (
                <p className="mt-2 text-lg text-gray-700">
                  The answer was: <span className="font-mono">{phase.fb.answer}</span>
                </p>
              )}
              {phase.fb.retry && (
                <p className="mt-2 text-sm text-gray-500">Let’s try that one again.</p>
              )}
              <button
                onClick={() => pending.current && show(pending.current)}
                className="mt-6 rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Continue
              </button>
            </div>
          )}
          {phase.at === 'break' && (
            <div className="text-center">
              <p className="text-lg text-gray-800">Thank you — that puzzle is done.</p>
              <p className="mt-1 text-sm text-gray-500">{BREAK_TEXT}</p>
              <button
                onClick={() => onDone(phase.view)}
                className="mt-6 rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Continue
              </button>
            </div>
          )}
          {error && phase.at !== 'intro' && (
            <p className="mt-4 text-center text-sm text-red-600">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
