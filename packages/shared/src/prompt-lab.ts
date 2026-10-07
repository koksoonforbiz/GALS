import { z } from 'zod';

/**
 * Prompt Lab (prompting course, Phase 3): request schemas shared by the API
 * and (as types) the web client. See apps/api/src/prompt-lab/.
 */

export const PROMPT_LAB_REVISION_TAGS = [
  'context',
  'constraint',
  'example',
  'format',
  'role',
  'compression',
  'reasoning',
  'other',
] as const;

export const PROMPT_LAB_FAILURE_REASONS = [
  'missing_fact',
  'ambiguity',
  'instruction_dropped',
  'format',
  'other',
] as const;

export const PROMPT_LAB_VERDICTS = ['supported', 'unsupported', 'unsure'] as const;

/** Caps keep a single request bounded; the course's longest material is ~1,400 tokens. */
export const PROMPT_LAB_MAX_PROMPT_CHARS = 24_000;
export const PROMPT_LAB_MAX_SAMPLES = 5;

const slideRef = {
  moduleItemId: z.string().uuid(),
  slideKey: z.string().min(1).max(32),
};

export const PromptLabRunSchema = z.object({
  ...slideRef,
  promptText: z.string().min(1).max(PROMPT_LAB_MAX_PROMPT_CHARS),
  systemText: z.string().max(8_000).optional(),
  model: z.string().max(128).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(16).max(4_000).optional(),
  versionId: z.string().uuid().optional(),
  parentRunId: z.string().uuid().optional(),
  testCaseKey: z.string().min(1).max(64).optional(),
  /** "Run N samples": the learner declared a sampling experiment (excluded from M28). */
  samples: z.number().int().min(1).max(PROMPT_LAB_MAX_SAMPLES).default(1),
  sessionId: z.string().uuid().optional(),
});
export type PromptLabRunRequest = z.infer<typeof PromptLabRunSchema>;

export const PromptLabVersionSchema = z.object({
  ...slideRef,
  promptText: z.string().min(1).max(PROMPT_LAB_MAX_PROMPT_CHARS),
  revisionTags: z.array(z.enum(PROMPT_LAB_REVISION_TAGS)).max(8).default([]),
});
export type PromptLabVersionRequest = z.infer<typeof PromptLabVersionSchema>;

export const PromptLabTagsSchema = z.object({
  revisionTags: z.array(z.enum(PROMPT_LAB_REVISION_TAGS)).max(8),
});

export const PromptLabTestCaseSchema = z.object({
  ...slideRef,
  label: z.string().min(1).max(200),
  inputText: z.string().min(1).max(8_000),
});
export type PromptLabTestCaseRequest = z.infer<typeof PromptLabTestCaseSchema>;

export const PromptLabTestResultSchema = z.object({
  versionId: z.string().uuid(),
  runId: z.string().uuid().optional(),
  testCaseKey: z.string().min(1).max(64),
  pass: z.boolean(),
  failureReason: z.enum(PROMPT_LAB_FAILURE_REASONS).optional(),
  note: z.string().max(2_000).optional(),
});
export type PromptLabTestResultRequest = z.infer<typeof PromptLabTestResultSchema>;

const score = z.number().int().min(1).max(5);
export const PromptLabRatingSchema = z.object({
  runId: z.string().uuid(),
  criteria: z.object({ correct: score, complete: score, format: score }).partial(),
  verifiedClaim: z.string().max(2_000).optional(),
  verifyVerdict: z.enum(PROMPT_LAB_VERDICTS).optional(),
});
export type PromptLabRatingRequest = z.infer<typeof PromptLabRatingSchema>;
