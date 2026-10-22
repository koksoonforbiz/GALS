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
