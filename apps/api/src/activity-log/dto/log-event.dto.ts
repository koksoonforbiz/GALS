import { z } from 'zod';
import { ActivityAction } from '../activity-action.enum';

const ActivityActionValues = Object.values(ActivityAction) as [string, ...string[]];

export const LogEventSchema = z.object({
  action: z.enum(ActivityActionValues),
  occurredAt: z.string().datetime(),

  courseId: z.string().uuid().optional(),
  moduleId: z.string().uuid().optional(),
  moduleItemId: z.string().uuid().optional(),
  assessmentId: z.string().uuid().optional(),
  attemptId: z.string().uuid().optional(),
  questionId: z.string().uuid().optional(),
  dialogueSessionId: z.string().optional(),
  interventionId: z.string().uuid().optional(),
  kcId: z.string().uuid().optional(),

  metadata: z.record(z.unknown()).optional(),
});

export type LogEventDto = z.infer<typeof LogEventSchema>;

export const BatchLogEventsSchema = z.object({
  sessionId: z.string().uuid(),
  events: z.array(LogEventSchema).min(1).max(500),
});

export type BatchLogEventsDto = z.infer<typeof BatchLogEventsSchema>;
