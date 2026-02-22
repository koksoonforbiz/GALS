import { z } from 'zod';

export const InterventionTypeSchema = z.enum([
  'PRACTICE_TESTING',
  'DISTRIBUTED_PRACTICE',
  'STEPWISE_LEARNING',
  'INTERROGATIVE_ELABORATION',
]);

export type InterventionType = z.infer<typeof InterventionTypeSchema>;

export const CreateInterventionSchema = z.object({
  courseId: z.string().uuid(),
  contentId: z.string().uuid(),
  selectedText: z.string().min(20, 'Selected text must be at least 20 characters'),
  interventionType: InterventionTypeSchema,
});

export type CreateInterventionDto = z.infer<typeof CreateInterventionSchema>;
