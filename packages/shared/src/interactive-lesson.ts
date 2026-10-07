import { z } from 'zod';

/**
 * Interactive lessons (ModuleItem.type = INTERACTIVE_LESSON).
 *
 * The prompting course ships as one HTML file whose `const COURSE=[…]`
 * holds every session's slides. The import script
 * (apps/api/prisma/scripts/import-prompting-course.ts) turns each session
 * into one ModuleItem whose `lessonJson` is a {@link LessonDocument}.
 *
 * Slide keys (`s<session>-<index>`) are the course HTML's own ids. They
 * are positional in the HTML, so the importer FREEZES them: once a key
 * has been logged against, it must keep meaning the same slide. See
 * docs/process-mining/PHASE0_DISCOVERY.md §8.
 */

export const LESSON_SCHEMA_VERSION = 1 as const;

export type LessonSlideType =
  | 'title'
  | 'objectives'
  | 'theory'
  | 'figure'
  | 'example'
  | 'think'
  | 'predict'
  | 'mcq'
  | 'misconceptions'
  | 'concept'
  | 'check'
  | 'exercise'
  | 'task'
  | 'ai'
  | 'stretch'
  | 'selfscore'
  | 'reflect'
  /** Phase 5: unassisted transfer prompt-writing task (appended at import). */
  | 'transfer';

/**
 * Minimum trimmed lengths the course HTML enforces before a save/reveal
 * is allowed (course_slides.html, textGate and per-type handlers).
 * The renderer must reproduce these exactly.
 */
export const LESSON_GATES = {
  think: 20,
  predict: 20,
  reflect: 20,
  results: 20,
  checkAnswer: 10,
  mcqRationale: 15,
  misconceptionReason: 8,
} as const;

export interface LessonMcqOption {
  t: string;
  ok: boolean;
  fb: string;
  /**
   * Distractor → misconception tag (decision #3 in PHASE0_DISCOVERY.md).
   * A slide key + item (`s1-16-m4`) or a cross-session tag (`x-…`).
   * Absent on the correct option.
   */
  misconceptionId?: string;
  misconceptionTagStatus?: 'proposed' | 'approved';
}

export interface LessonSlide {
  /** Frozen slide key, e.g. `s1-7`. `s<n>-0` is the generated title slide. */
  key: string;
  t: LessonSlideType;
  /** sha256 of the slide's source JSON — detects edits at re-import. */
  contentHash: string;
  lab?: boolean;
  box?: string;
  heading?: string;
  html?: string;
  prompt?: string;
  reveal?: string;
  expect?: string;
  items?: unknown[];
  q?: string;
  options?: LessonMcqOption[];
  criteria?: string[];
  svg?: string;
  caption?: string;
  alt?: string;
  notice?: string[];
  gated?: boolean;
  /** transfer slides: the new scenario the learner writes a prompt for. */
  scenario?: string;
}

export interface LessonSessionMeta {
  id: number;
  title: string;
  covers: string;
  bigq: string;
  core: string[];
  appendix: boolean;
}

export interface LessonDocument {
  schemaVersion: typeof LESSON_SCHEMA_VERSION;
  source: { file: string; sha256: string; importedAt: string };
  session: LessonSessionMeta;
  slides: LessonSlide[];
}

/** Per-slide saved work. `fields` mirrors the HTML's localStorage keys. */
export const LessonSlideStateSchema = z
  .object({
    fields: z.record(z.unknown()),
  })
  .strict();

export type LessonSlideState = z.infer<typeof LessonSlideStateSchema>;

/** Hard cap on one slide's serialised state (bytes of JSON). */
export const LESSON_SLIDE_STATE_MAX_BYTES = 32_000;

export const SaveLessonSlideStateSchema = z.object({
  state: LessonSlideStateSchema,
  sessionId: z.string().uuid().optional(),
});

export type SaveLessonSlideState = z.infer<typeof SaveLessonSlideStateSchema>;
