import { z } from 'zod';

/**
 * Staff side of the EF assessment (rater coding). Admin bundle only; the
 * student bundle never imports these.
 */
export const EFA_CODED_TASKS = ['w4', 'w5'] as const;
export type EfaCodedTask = (typeof EFA_CODED_TASKS)[number];

/** W4 entry codes and W5 Part B codes. */
export const EFA_W4_CODES = ['valid', 'repeat', 'rule_break', 'intrusion'] as const;
export const EFA_W5_CODES = ['A', 'B', '0'] as const;

export const EfaEntryCodeSchema = z.object({
  entryIndex: z.number().int().min(0).max(500),
  code: z.enum([...EFA_W4_CODES, ...EFA_W5_CODES]),
  category: z.string().trim().min(1).max(100).nullish(),
});
export type EfaEntryCode = z.infer<typeof EfaEntryCodeSchema>;

export const EfaCodeSubmitSchema = z.object({
  codes: z.array(EfaEntryCodeSchema).min(1).max(500),
});
export type EfaCodeSubmitRequest = z.infer<typeof EfaCodeSubmitSchema>;

/** One entry as a rater sees it (no student, no occasion). */
export interface EfaCodingEntry {
  entryIndex: number;
  text: string;
  /** W4 automatic pre-scoring hints */
  hints?: string[];
  /** W5: suggested code (exact expected word) that the rater must confirm */
  suggested?: string | null;
  mine?: { code: string; category: string | null } | null;
  /** disagreement view: the two rater codes, anonymised */
  raters?: Array<{ code: string; category: string | null }>;
  final?: { code: string; category: string | null; source: string } | null;
}

export interface EfaCodingItem {
  itemId: string;
  task: EfaCodedTask;
  /** W4: letter | category | switch prompt; W5: the sentence */
  prompt: { kind: string; letter?: string; category?: string; pair?: string[]; sentence?: string };
  /** W5 only: expected completion and the anchor examples */
  expected?: string;
  anchors?: { a: string; b: string } | null;
  categories?: string[];
  entries: EfaCodingEntry[];
}

export interface EfaCodingSummary {
  task: EfaCodedTask;
  items: number;
  entries: number;
  codedByMe: number;
  doubleCoded: number;
  disagreements: number;
  finalised: number;
  kappa: number | null;
  canCode: boolean;
}

// ── Phase 7: settings, progress, reset, raters ─────────────────────────────

export const EFA_TASKS = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'] as const;
export const EFA_OCCASIONS = ['T0', 'T1', 'T2'] as const;
export type EfaOccasionCode = (typeof EFA_OCCASIONS)[number];

/**
 * EF settings for one course. `positions[occasion]` is the module the
 * occasion's two gates sit on: before it (T0, T1) or after it (T2).
 */
export const EfaSettingsSchema = z.object({
  enabledOccasions: z.object({ T0: z.boolean(), T1: z.boolean(), T2: z.boolean() }),
  enabledTasks: z.array(z.enum(EFA_TASKS)).min(1),
  showDiagnosisItem: z.boolean(),
  adexiAtT2: z.boolean(),
  t2MinMinutesAfterPrevious: z
    .number()
    .int()
    .min(0)
    .max(60 * 24 * 30),
  positions: z.object({
    T0: z.string().uuid().nullable(),
    T1: z.string().uuid().nullable(),
    T2: z.string().uuid().nullable(),
  }),
});
export type EfaSettings = z.infer<typeof EfaSettingsSchema>;

export interface EfaSettingsView extends EfaSettings {
  modules: Array<{ id: string; title: string; orderIndex: number }>;
  gates: Array<{
    id: string;
    kind: string;
    occasion: string | null;
    position: string;
    moduleId: string;
    sequence: number;
    required: boolean;
    completions: number;
  }>;
  /** true until settings were saved once for this course */
  usingDefaults: boolean;
}

export const EfaReasonSchema = z.object({
  reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500),
});
export type EfaReasonRequest = z.infer<typeof EfaReasonSchema>;

export const EfaRatersSchema = z.object({
  w4: z.array(z.string().uuid()).max(20),
  w5: z.array(z.string().uuid()).max(20),
});
export type EfaRatersRequest = z.infer<typeof EfaRatersSchema>;

export interface EfaProgressRun {
  runId: string;
  task: string;
  attempt: number;
  attempts: number;
  status: string;
  skipReason: string | null;
  flags: Record<string, unknown> | null;
  resetReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface EfaProgressOccasion {
  occasionId: string;
  occasion: string;
  status: string;
  form: string | null;
  orderCode: string | null;
  slot: number | null;
  flags: Record<string, unknown> | null;
  /** administration log */
  log: {
    device: Record<string, unknown> | null;
    fullscreenAccepted: boolean | null;
    sensingPaused: boolean;
    startedAt: string | null;
    questionnaireDoneAt: string | null;
    completedAt: string | null;
    abandonedAt: string | null;
    gapSincePreviousActivityMin: number | null;
    focusLostSec: number;
    scoringVersion: string | null;
  };
  runs: EfaProgressRun[];
}

export interface EfaProgressStudent {
  studentId: string;
  name: string;
  email: string;
  gates: Array<{ gateId: string; done: boolean; source: string | null; reason: string | null }>;
  occasions: EfaProgressOccasion[];
}

export interface EfaProgressView {
  gates: Array<{ id: string; kind: string; occasion: string | null; label: string }>;
  students: EfaProgressStudent[];
}
