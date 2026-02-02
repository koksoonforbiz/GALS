import { z } from 'zod';

export const AttemptStatus = z.enum(['in_progress', 'submitted', 'grading', 'graded']);
export type AttemptStatus = z.infer<typeof AttemptStatus>;

export const AttemptSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  questionId: z.string().uuid(),
  assessmentId: z.string().uuid().nullable().optional(),
  status: AttemptStatus,
  textResponse: z.string().nullable(),
  selectedOptionIds: z.array(z.string()).nullable().optional(),
  drawingBlobUrl: z.string().nullable(),
  workingBlobUrl: z.string().nullable().optional(),
  currentScore: z.number().nullable().optional(),
  autoFeedback: z.string().nullable().optional(),
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
export const AssessmentSettingsSchema = z.object({
  timeLimit: z.number().int().positive().nullable().optional(), // minutes
  maxAttempts: z.number().int().positive().nullable().optional(),
  showSolutions: z.boolean().optional(),
  shuffle: z.boolean().optional(),
});
export type AssessmentSettings = z.infer<typeof AssessmentSettingsSchema>;

export const AssessmentSchema = z.object({
  id: z.string().uuid(),
  courseId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string(),
  mode: z.string().optional(),
  isPublished: z.boolean().optional(),
  settings: AssessmentSettingsSchema.nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Assessment = z.infer<typeof AssessmentSchema>;

export const AssessmentQuestionSchema = z.object({
  id: z.string().uuid(),
  assessmentId: z.string().uuid(),
  questionId: z.string().uuid(),
  orderIndex: z.number().int().nonnegative(),
  points: z.number().nullable().optional(),
  section: z.string().nullable().optional(),
});
export type AssessmentQuestion = z.infer<typeof AssessmentQuestionSchema>;

export const CreateAssessmentSchema = z.object({
  courseId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  mode: z.string().optional(),
  settings: AssessmentSettingsSchema.nullable().optional(),
  questionIds: z.array(z.string().uuid()).default([]),
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
  selectedOptionIds: z.array(z.string()).nullable().optional(),
  strokesJson: z.array(StrokeSchema).nullable().optional(),
  drawingBlobUrl: z.string().nullable().optional(),
  workingStrokes: z.array(StrokeSchema).nullable().optional(),
  workingBlobUrl: z.string().nullable().optional(),
});
export type UpdateAttempt = z.infer<typeof UpdateAttemptSchema>;

export const SubmitAttemptSchema = z.object({
  textResponse: z.string().nullable().optional(),
  selectedOptionIds: z.array(z.string()).nullable().optional(),
  strokesJson: z.array(StrokeSchema).nullable().optional(),
  drawingBlobUrl: z.string().nullable().optional(),
  workingStrokes: z.array(StrokeSchema).nullable().optional(),
  workingBlobUrl: z.string().nullable().optional(),
});
export type SubmitAttempt = z.infer<typeof SubmitAttemptSchema>;

export const ManualGradeSchema = z.object({
  score: z.number().nonnegative(),
  feedback: z.string().min(1),
});
export type ManualGrade = z.infer<typeof ManualGradeSchema>;
