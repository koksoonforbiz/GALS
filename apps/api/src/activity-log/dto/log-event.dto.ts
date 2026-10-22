import { z } from 'zod';
import {
  ActivityAction,
  SERVER_ONLY_ACTIONS,
  SERVER_WRITTEN_ACTIONS,
} from '../activity-action.enum';

// Server-only and server-written actions (EF assessment, gates, knowledge-test
// submission) are not accepted from clients.
const ActivityActionValues = Object.values(ActivityAction).filter(
  (a) => !SERVER_ONLY_ACTIONS.has(a) && !SERVER_WRITTEN_ACTIONS.has(a),
) as [string, ...string[]];

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

  metadata: z.record(z.unknown()).optional(),
});

export type LogEventDto = z.infer<typeof LogEventSchema>;

export const BatchLogEventsSchema = z.object({
  sessionId: z.string().uuid(),
  events: z.array(LogEventSchema).min(1).max(500),
});

export type BatchLogEventsDto = z.infer<typeof BatchLogEventsSchema>;
