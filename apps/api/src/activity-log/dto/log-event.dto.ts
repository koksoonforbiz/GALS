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

  // `null` is accepted as "not set": one stray null must not lose an event.
  courseId: z.string().uuid().nullish(),
  moduleId: z.string().uuid().nullish(),
  moduleItemId: z.string().uuid().nullish(),
  assessmentId: z.string().uuid().nullish(),
  attemptId: z.string().uuid().nullish(),
  questionId: z.string().uuid().nullish(),
  dialogueSessionId: z.string().nullish(),
  interventionId: z.string().uuid().nullish(),

  metadata: z.record(z.unknown()).nullish(),
});

export type LogEventDto = z.infer<typeof LogEventSchema>;

export const BatchLogEventsSchema = z.object({
  sessionId: z.string().uuid(),
  events: z.array(LogEventSchema).min(1).max(500),
});

export type BatchLogEventsDto = z.infer<typeof BatchLogEventsSchema>;

/**
 * The batch as received: the envelope is checked here, each event on its own
 * in the controller (CAP-41), so one bad event no longer loses the batch.
 */
export const BatchEnvelopeSchema = z.object({
  sessionId: z.string().uuid(),
  events: z.array(z.unknown()).min(1).max(500),
});

export type BatchEnvelopeDto = z.infer<typeof BatchEnvelopeSchema>;

/** A rejected event, described without its content (validation path + code only). */
export function describeRejection(raw: unknown, error: z.ZodError) {
  const a = raw && typeof raw === 'object' ? (raw as { action?: unknown }).action : undefined;
  const action = typeof a === 'string' ? a.slice(0, 64) : null;
  const reason = error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || '(event)'}:${i.code}`)
    .join(';');
  let rawBytes: number | null = null;
  try {
    rawBytes = JSON.stringify(raw)?.length ?? null;
  } catch {
    rawBytes = null;
  }
  return { action, reason, rawBytes };
}
