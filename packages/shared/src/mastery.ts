import { z } from 'zod';

// ─── Knowledge Component ────────────────────────────────

export const KnowledgeComponentSchema = z.object({
  id: z.string().uuid(),
  topicId: z.string().uuid(),
  code: z.string().min(1),
  label: z.string().min(1),
  description: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type KnowledgeComponent = z.infer<typeof KnowledgeComponentSchema>;

export const CreateKcSchema = z.object({
  topicId: z.string().uuid(),
  code: z.string().min(1).max(50),
  label: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});
export type CreateKc = z.infer<typeof CreateKcSchema>;

// ─── Question ↔ KC link ────────────────────────────────

export const QuestionKcSchema = z.object({
  id: z.string().uuid(),
  questionId: z.string().uuid(),
  kcId: z.string().uuid(),
  weight: z.number().default(1.0),
});
export type QuestionKc = z.infer<typeof QuestionKcSchema>;

// ─── User Mastery ───────────────────────────────────────

export const UserMasterySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  kcId: z.string().uuid(),
  probabilityKnown: z.number(),
  totalAttempts: z.number().int(),
  correctAttempts: z.number().int(),
  lastAttemptAt: z.string().datetime().nullable(),

  // BKT-ready (nullable)
  pLearn: z.number().nullable().optional(),
  pGuess: z.number().nullable().optional(),
  pSlip: z.number().nullable().optional(),
  pTransit: z.number().nullable().optional(),
});
export type UserMastery = z.infer<typeof UserMasterySchema>;

// ─── KC Evidence ────────────────────────────────────────

export const KcEvidenceSchema = z.object({
  id: z.string().uuid(),
  gradingResultId: z.string().uuid(),
  kcId: z.string().uuid(),
  isCorrect: z.boolean(),
  score: z.number(),
  createdAt: z.string().datetime(),
});
export type KcEvidence = z.infer<typeof KcEvidenceSchema>;

// ─── API Response Shapes ────────────────────────────────

export const KcMasteryItemSchema = z.object({
  kcId: z.string().uuid(),
  code: z.string(),
  label: z.string(),
  probabilityKnown: z.number(),
  totalAttempts: z.number().int(),
  correctAttempts: z.number().int(),
  lastAttemptAt: z.string().datetime().nullable(),
});
export type KcMasteryItem = z.infer<typeof KcMasteryItemSchema>;

export const MasteryByTopicSchema = z.object({
  topicId: z.string().uuid(),
  topicTitle: z.string(),
  courseId: z.string().uuid(),
  courseTitle: z.string(),
  kcs: z.array(KcMasteryItemSchema),
});
export type MasteryByTopic = z.infer<typeof MasteryByTopicSchema>;
