import { z } from 'zod';

/**
 * Student-facing "Attention and memory puzzles" / "About you and how you
 * feel today" (EF assessment, docs/EF_battery_v2). Neutral names only:
 * these types ship in the student bundle.
 */

export const PUZZLE_OCCASIONS = ['T0', 'T1', 'T2'] as const;
export type PuzzleOccasion = (typeof PUZZLE_OCCASIONS)[number];

export const PuzzleDeviceSchema = z.object({
  userAgent: z.string().max(512),
  screenW: z.number().int().min(0).max(20000),
  screenH: z.number().int().min(0).max(20000),
  viewportW: z.number().int().min(0).max(20000),
  viewportH: z.number().int().min(0).max(20000),
  devicePixelRatio: z.number().min(0).max(10),
  pointerFine: z.boolean(),
  hoverNone: z.boolean(),
  keyboardConfirmed: z.literal(true),
  fullscreenAccepted: z.boolean(),
});
export type PuzzleDevice = z.infer<typeof PuzzleDeviceSchema>;

export const PuzzleStartSchema = z.object({
  noticeVersion: z.string().min(1).max(64),
  accepted: z.literal(true, {
    errorMap: () => ({ message: 'Please read and accept the notice to continue' }),
  }),
  device: PuzzleDeviceSchema,
});
export type PuzzleStartRequest = z.infer<typeof PuzzleStartSchema>;

export const PuzzleAnswerSchema = z.object({ value: z.unknown() });
export type PuzzleAnswerRequest = z.infer<typeof PuzzleAnswerSchema>;

export const PuzzleSubmitSchema = z.object({ part: z.enum(['before', 'after']) });
export type PuzzleSubmitRequest = z.infer<typeof PuzzleSubmitSchema>;

const PatchColour = z.enum(['red', 'green', 'blue']);
export const PuzzleColourCheckSchema = z.object({
  answers: z
    .array(z.object({ shown: PatchColour, chosen: PatchColour }))
    .length(3)
    .refine((a) => new Set(a.map((x) => x.shown)).size === 3, 'Each patch once'),
});
export type PuzzleColourCheckRequest = z.infer<typeof PuzzleColourCheckSchema>;

/** Where the student is within one occasion (drives the puzzles page). */
export type PuzzleNextStep =
  | 'consent'
  | 'questionnaire'
  | 'colour'
  | 'tasks'
  | 'after'
  | 'done'
  | 'abandoned'
  | 'unavailable';

export interface PuzzleQuestionItem {
  code: string;
  text: string;
  type: 'number' | 'text' | 'text2' | 'choice' | 'scale';
  options?: string[];
  otherOption?: string;
  describeOption?: string;
  followup?: { text: string; when: string[] };
  secondText?: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  lowLabel?: string;
  highLabel?: string;
  /** shared 1–5 scale labels for the "How you usually are" section */
  scaleLabels?: string[];
}

export interface PuzzleQuestionSection {
  key: 'about' | 'usually' | 'today' | 'after';
  heading: string;
  instructions?: string;
  attribution?: string;
  items: PuzzleQuestionItem[];
}

// ── task runner ──────────────────────────────────────────────────────────

const ms = z.number().min(0).max(3_600_000);
const timing = {
  focusLostMs: ms.optional(),
};

/** One step's raw result from the browser. Correctness is recomputed on the server. */
export const PuzzleStepResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('sequence'),
    response: z.string().max(64),
    onsetMs: ms,
    firstInputMs: ms.nullable().optional(),
    submitMs: ms,
    shownMs: z.array(ms).max(32),
    corrections: z.number().int().min(0).max(500).optional(),
    ...timing,
  }),
  z.object({
    kind: z.literal('item'),
    response: z.string().max(16),
    onsetMs: ms,
    firstInputMs: ms.nullable().optional(),
    submitMs: ms,
    corrections: z.number().int().min(0).max(500).optional(),
    ...timing,
  }),
  z.object({
    kind: z.literal('list'),
    responses: z
      .array(
        z.object({
          response: z.string().max(16),
          onsetMs: ms,
          firstInputMs: ms.nullable().optional(),
          submitMs: ms,
          corrections: z.number().int().min(0).max(500).optional(),
        }),
      )
      .max(30),
    startMs: ms,
    endMs: ms,
    ...timing,
  }),
  z.object({
    kind: z.literal('sentence'),
    response: z.string().max(64),
    onsetMs: ms,
    firstInputMs: ms.nullable().optional(),
    submitMs: ms,
    prompted: z.boolean().optional(),
    corrections: z.number().int().min(0).max(500).optional(),
    ...timing,
  }),
  z.object({
    kind: z.literal('prompt'),
    entries: z.array(z.object({ text: z.string().max(64), atMs: ms })).max(200),
    startMs: ms,
    endMs: ms,
    nudged: z.boolean().optional(),
    ...timing,
  }),
  z.object({
    kind: z.literal('grid'),
    presses: z
      .array(
        z.object({
          i: z.number().int().min(0).max(10_000),
          key: z.enum(['red', 'green', 'blue']),
          atMs: ms,
        }),
      )
      .max(2_000),
    startMs: ms,
    endMs: ms,
    restarts: z.number().int().min(0).max(50).optional(),
    ...timing,
  }),
  z.object({
    kind: z.literal('trail'),
    clicks: z.array(z.object({ label: z.string().max(4), atMs: ms })).max(1_000),
    startMs: ms,
    endMs: ms,
    discontinued: z.boolean().optional(),
    pxPerMm: z.number().min(0).max(100),
    ...timing,
  }),
]);
export type PuzzleStepResult = z.infer<typeof PuzzleStepResultSchema>;

export const PuzzleStepSubmitSchema = z.object({
  stepId: z.string().min(1).max(64),
  attempt: z.number().int().min(1).max(2),
  result: PuzzleStepResultSchema,
});
export type PuzzleStepSubmitRequest = z.infer<typeof PuzzleStepSubmitSchema>;

export interface PuzzleStepView {
  id: string;
  kind: 'sequence' | 'item' | 'list' | 'prompt' | 'sentence' | 'grid' | 'trail';
  phase: 'practice' | 'test';
  part: string;
  index: number;
  attempt: number;
  payload: Record<string, unknown>;
}

export interface PuzzleStepResponse {
  feedback?: { correct: boolean; message: string; answer?: string; retry?: boolean };
  next: PuzzleStepView | null;
}
