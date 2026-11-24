import { z } from 'zod';

/**
 * Study notes: a student's own highlights and notes on the course page
 * (the Notes tab beside the Learning Assistant). A highlight is a quote
 * found again on the page by its text plus a little context; a note is
 * free text, optionally attached to a highlight.
 */

export const STUDY_NOTE_COLORS = ['yellow', 'green', 'blue', 'pink'] as const;
export type StudyNoteColor = (typeof STUDY_NOTE_COLORS)[number];

export const STUDY_NOTE_SOURCES = ['highlight', 'note', 'assistant'] as const;
export type StudyNoteSource = (typeof STUDY_NOTE_SOURCES)[number];

export const STUDY_NOTE_QUOTE_MAX = 4000;
export const STUDY_NOTE_BODY_MAX = 5000;
export const STUDY_NOTE_CONTEXT_MAX = 64;
/** Per student per course; far above any real use, it only stops runaway clients. */
export const STUDY_NOTES_PER_COURSE_MAX = 2000;

export interface StudyNote {
  id: string;
  courseId: string;
  moduleItemId: string | null;
  slideKey: string | null;
  location: string;
  source: StudyNoteSource;
  quote: string | null;
  prefix: string | null;
  suffix: string | null;
  color: StudyNoteColor | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export const CreateStudyNoteSchema = z
  .object({
    courseId: z.string().uuid(),
    moduleItemId: z.string().uuid().nullish(),
    slideKey: z.string().max(200).nullish(),
    location: z.string().max(300).default(''),
    source: z.enum(STUDY_NOTE_SOURCES),
    quote: z.string().max(STUDY_NOTE_QUOTE_MAX).nullish(),
    prefix: z.string().max(STUDY_NOTE_CONTEXT_MAX).nullish(),
    suffix: z.string().max(STUDY_NOTE_CONTEXT_MAX).nullish(),
    color: z.enum(STUDY_NOTE_COLORS).nullish(),
    body: z.string().max(STUDY_NOTE_BODY_MAX).default(''),
  })
  .refine((n) => (n.quote ?? '').trim() !== '' || n.body.trim() !== '', {
    message: 'A note needs some text',
  });
export type CreateStudyNote = z.input<typeof CreateStudyNoteSchema>;

export const UpdateStudyNoteSchema = z
  .object({
    body: z.string().max(STUDY_NOTE_BODY_MAX).optional(),
    color: z.enum(STUDY_NOTE_COLORS).nullable().optional(),
  })
  .refine((u) => u.body !== undefined || u.color !== undefined, {
    message: 'Nothing to update',
  });
export type UpdateStudyNote = z.infer<typeof UpdateStudyNoteSchema>;

// ── Course progress (student home page) ──────────────────────────────────

/** One step of the course in order: a checklist step or a session lesson. */
export interface CourseProgressStep {
  kind: 'step' | 'lesson';
  label: string;
  done: boolean;
  /** session number for lessons (and session knowledge checks) */
  sessionNo: number | null;
  /** lessons: the module item to open */
  moduleItemId: string | null;
  /** steps: gate step code + occasion, to link to the right page */
  step: 'questionnaire' | 'puzzles' | 'knowledge' | null;
  occasion: string | null;
}

export interface CourseSessionProgress {
  sessionNo: number;
  title: string;
  state: 'done' | 'in_progress' | 'open' | 'locked';
}

export interface CourseProgress {
  courseId: string;
  title: string;
  teacherName: string;
  /** done / total over `steps`; 0 when the course has no tracked steps */
  done: number;
  total: number;
  /** first step not done (null when everything is done or nothing is tracked) */
  next: CourseProgressStep | null;
  steps: CourseProgressStep[];
  sessions: CourseSessionProgress[];
  /** last time the student saved anything in a lesson of this course */
  lastActiveAt: string | null;
}
