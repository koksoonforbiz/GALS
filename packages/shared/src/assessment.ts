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
  currentScore: z.number().nullable().optional(),
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

// Assessment schemas
export const AssessmentSchema = z.object({
  id: z.string().uuid(),
  courseId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Assessment = z.infer<typeof AssessmentSchema>;

export const AssessmentQuestionSchema = z.object({
  id: z.string().uuid(),
  assessmentId: z.string().uuid(),
  questionId: z.string().uuid(),
  orderIndex: z.number().int().nonnegative(),
});
export type AssessmentQuestion = z.infer<typeof AssessmentQuestionSchema>;

export const CreateAssessmentSchema = z.object({
  courseId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  questionIds: z.array(z.string().uuid()).min(1),
});
export type CreateAssessment = z.infer<typeof CreateAssessmentSchema>;

// Stroke schema for drawing canvas
export const StrokePointSchema = z.object({
  x: z.number(),
  y: z.number(),
  pressure: z.number().optional(),
});
export type StrokePoint = z.infer<typeof StrokePointSchema>;

export const StrokeSchema = z.object({
  points: z.array(StrokePointSchema),
  color: z.string(),
  width: z.number(),
});
export type Stroke = z.infer<typeof StrokeSchema>;

// Attempt DTOs
export const CreateAttemptSchema = z
  .object({
    questionId: z.string().uuid().optional(),
    assessmentId: z.string().uuid().optional(),
  })
  .refine((data) => data.questionId || data.assessmentId, {
    message: 'Either questionId or assessmentId must be provided',
  });
export type CreateAttempt = z.infer<typeof CreateAttemptSchema>;

export const UpdateAttemptSchema = z.object({
  textResponse: z.string().nullable().optional(),
  strokesJson: z.array(StrokeSchema).nullable().optional(),
  drawingBlobUrl: z.string().nullable().optional(),
});
export type UpdateAttempt = z.infer<typeof UpdateAttemptSchema>;

export const SubmitAttemptSchema = z.object({
  textResponse: z.string().nullable().optional(),
  strokesJson: z.array(StrokeSchema).nullable().optional(),
  drawingBlobUrl: z.string().nullable().optional(),
});
export type SubmitAttempt = z.infer<typeof SubmitAttemptSchema>;

export const ManualGradeSchema = z.object({
  score: z.number().nonnegative(),
  feedback: z.string().min(1),
});
export type ManualGrade = z.infer<typeof ManualGradeSchema>;
