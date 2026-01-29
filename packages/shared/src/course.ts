import { z } from 'zod';

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

export const QuestionType = z.enum(['text', 'drawing', 'mixed']);
export type QuestionType = z.infer<typeof QuestionType>;

export const QuestionSchema = z.object({
  id: z.string().uuid(),
  topicId: z.string().uuid(),
  version: z.number().int().positive(),
  prompt: z.string().min(1),
  type: QuestionType,
  maxScore: z.number().positive(),
  rubricJson: z.unknown().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Question = z.infer<typeof QuestionSchema>;

// Create DTOs
export const CreateCourseSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
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
  topicId: z.string().uuid(),
  prompt: z.string().min(1),
  type: QuestionType,
  maxScore: z.number().positive(),
  rubricJson: z.unknown().nullable().default(null),
  kcIds: z.array(z.string().uuid()).optional(),
});
export type CreateQuestion = z.infer<typeof CreateQuestionSchema>;

export const UpdateQuestionSchema = CreateQuestionSchema.omit({ topicId: true }).partial();
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
