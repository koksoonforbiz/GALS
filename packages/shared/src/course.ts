import { z } from 'zod';
import { DialogueCourseSettingsSchema } from './dialogue.schemas';

export const CourseSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string(),
  teacherId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Course = z.infer<typeof CourseSchema>;

export const TopicSchema = z.object({
  id: z.string().uuid(),
  courseId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string(),
  orderIndex: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Topic = z.infer<typeof TopicSchema>;

export const QuestionType = z.enum(['text', 'MCQ_SINGLE', 'MCQ_MULTI', 'STRUCTURED']);
export type QuestionType = z.infer<typeof QuestionType>;

export const BloomsLevel = z.enum([
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
]);
export type BloomsLevel = z.infer<typeof BloomsLevel>;

export const MCQOptionSchema = z.object({
  id: z.string(),
  text: z.string(),
  isCorrect: z.boolean().default(false),
});
export type MCQOption = z.infer<typeof MCQOptionSchema>;

export const QuestionSchema = z.object({
  id: z.string().uuid(),
  courseId: z.string().uuid().nullable().optional(),
  topicId: z.string().uuid().nullable().optional(),
  version: z.number().int().positive(),
  prompt: z.string(),
  stem: z.unknown().nullable().optional(),
  type: QuestionType,
  maxScore: z.number().positive(),
  rubricJson: z.unknown().nullable(),
  options: z.array(MCQOptionSchema).nullable().optional(),
  correctOptionId: z.string().nullable().optional(),
  correctAnswer: z.unknown().nullable().optional(),
  explanation: z.unknown().nullable().optional(),
  difficulty: z.number().int().min(1).max(5).nullable().optional(),
  bloomsLevel: BloomsLevel.nullable().optional(),
  kcIds: z.array(z.string().uuid()).optional(),
  pageIds: z.array(z.string().uuid()).optional(),
  tags: z.unknown().nullable().optional(),
  status: z.string().optional(),
  createdBy: z.string().nullable().optional(),
  sourceType: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Question = z.infer<typeof QuestionSchema>;

// Create DTOs
export const CreateCourseSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  learningMode: z.enum(['STANDARD', 'DIALOGUE']).optional().default('STANDARD'),
  dblSettings: DialogueCourseSettingsSchema.optional(),
});
export type CreateCourse = z.infer<typeof CreateCourseSchema>;

export const UpdateCourseSchema = CreateCourseSchema.partial();
export type UpdateCourse = z.infer<typeof UpdateCourseSchema>;

export const CreateTopicSchema = z.object({
  courseId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  orderIndex: z.number().int().nonnegative().default(0),
});
export type CreateTopic = z.infer<typeof CreateTopicSchema>;

export const UpdateTopicSchema = CreateTopicSchema.omit({ courseId: true }).partial();
export type UpdateTopic = z.infer<typeof UpdateTopicSchema>;

export const CreateQuestionSchema = z.object({
  courseId: z.string().uuid().optional(),
  topicId: z.string().uuid().optional(),
  prompt: z.string().min(1),
  stem: z.unknown().nullable().optional(),
  type: QuestionType,
  maxScore: z.number().positive(),
  rubricJson: z.unknown().nullable().default(null),
  options: z.array(MCQOptionSchema).nullable().optional(),
  correctOptionId: z.string().nullable().optional(),
  correctAnswer: z.unknown().nullable().optional(),
  explanation: z.unknown().nullable().optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  bloomsLevel: BloomsLevel.optional(),
  kcIds: z.array(z.string().uuid()).optional(),
  pageIds: z.array(z.string().uuid()).optional(),
  tags: z.unknown().nullable().optional(),
  status: z.string().optional(),
  createdBy: z.string().optional(),
  sourceType: z.string().optional(),
});
export type CreateQuestion = z.infer<typeof CreateQuestionSchema>;

export const UpdateQuestionSchema = CreateQuestionSchema.partial();
export type UpdateQuestion = z.infer<typeof UpdateQuestionSchema>;

export const EnrollmentSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  courseId: z.string().uuid(),
  enrolledAt: z.string().datetime(),
});
export type Enrollment = z.infer<typeof EnrollmentSchema>;

export const CreateEnrollmentSchema = z.object({
  studentId: z.string().uuid(),
  courseId: z.string().uuid(),
});
export type CreateEnrollment = z.infer<typeof CreateEnrollmentSchema>;
