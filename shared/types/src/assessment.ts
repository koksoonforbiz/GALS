import { z } from 'zod';

export const AttemptStatus = z.enum(['in_progress', 'submitted', 'grading', 'graded']);
export type AttemptStatus = z.infer<typeof AttemptStatus>;

export const AttemptSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  questionId: z.string().uuid(),
  status: AttemptStatus,
  textResponse: z.string().nullable(),
  drawingBlobUrl: z.string().nullable(),
  submittedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Attempt = z.infer<typeof AttemptSchema>;

export const GradingResultSchema = z.object({
  id: z.string().uuid(),
  attemptId: z.string().uuid(),
  score: z.number().nonnegative(),
  feedback: z.string(),
  gradedBy: z.enum(['auto', 'manual']),
  graderId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type GradingResult = z.infer<typeof GradingResultSchema>;

export const GradingEventSchema = z.object({
  attemptId: z.string().uuid(),
  questionId: z.string().uuid(),
  studentId: z.string().uuid(),
  textResponse: z.string().nullable(),
  drawingBlobUrl: z.string().nullable(),
  maxScore: z.number().positive(),
});
export type GradingEvent = z.infer<typeof GradingEventSchema>;
