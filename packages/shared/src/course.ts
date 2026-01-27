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

export const QuestionSchema = z.object({
  id: z.string().uuid(),
  topicId: z.string().uuid(),
  version: z.number().int().positive(),
  prompt: z.string().min(1),
  type: z.enum(['text', 'drawing', 'mixed']),
  maxScore: z.number().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Question = z.infer<typeof QuestionSchema>;
