import { z } from 'zod';

// ─── EventBus Interface ─────────────────────────────────────

export interface EventBus {
  publish(topic: string, payload: unknown): Promise<void>;
  subscribe(topic: string, handler: (payload: unknown) => Promise<void>): void;
}

// ─── Event Status & Topics ──────────────────────────────────

export const EventStatus = z.enum(['pending', 'processing', 'processed', 'failed']);
export type EventStatus = z.infer<typeof EventStatus>;

export const EventTopics = {
  GRADE_SUBMISSION: 'grade_submission',
  GRADE_COMPLETED: 'grade_completed',
  GENERATE_SOURCE_GUIDE: 'generate_source_guide',
} as const;
export type EventTopic = (typeof EventTopics)[keyof typeof EventTopics];

// ─── Event Payloads ─────────────────────────────────────────

export const GradeSubmissionPayloadSchema = z.object({
  attemptId: z.string().uuid(),
  questionId: z.string().uuid(),
  studentId: z.string().uuid(),
  textResponse: z.string().nullable(),
  maxScore: z.number().positive(),
  rubricJson: z.unknown().nullable(),
});
export type GradeSubmissionPayload = z.infer<typeof GradeSubmissionPayloadSchema>;

export const GradeCompletedPayloadSchema = z.object({
  attemptId: z.string().uuid(),
  studentId: z.string().uuid(),
  questionId: z.string().uuid(),
  score: z.number().nonnegative(),
  feedback: z.string(),
  gradedBy: z.enum(['auto', 'manual']),
});
export type GradeCompletedPayload = z.infer<typeof GradeCompletedPayloadSchema>;

export const GenerateSourceGuidePayloadSchema = z.object({
  documentId: z.string(),
  studentId: z.string(),
  courseId: z.string(),
});
export type GenerateSourceGuidePayload = z.infer<typeof GenerateSourceGuidePayloadSchema>;
