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

  // Envelope (Prompt B, B2). Optional so older clients keep working.
  clientEventId: z.string().uuid().nullish(),
  clientSeq: z.number().int().nonnegative().nullish(),
  tabId: z.string().max(64).nullish(),
  durationMs: z.number().int().nonnegative().nullish(),
  sourceChannel: z.string().max(64).nullish(),
  slideKey: z.string().max(200).nullish(),
  objectId: z.string().max(200).nullish(),
  contentVersion: z.string().max(100).nullish(),
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
  /** Events the browser had to drop because its buffer was full (B3). */
  overflow: z
    .object({ dropped: z.number().int().positive(), sinceMs: z.number().nullish() })
    .nullish(),
  /** The web build that sent the batch. */
  appBuild: z.string().max(64).nullish(),
});

export type BatchEnvelopeDto = z.infer<typeof BatchEnvelopeSchema>;

/** Why an event was rejected: its action, the validation path + code, its size. */
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

/** POST /activity-log/session/open (body optional). */
export const OpenSessionSchema = z
  .object({ previousSessionId: z.string().uuid().nullish() })
  .nullish()
  .transform((v) => v ?? {});

export type OpenSessionDto = z.infer<typeof OpenSessionSchema>;
