-- Checklist item 25 — "system alerts and failures" wasn't captured
-- anywhere queryable, only Logger.error output. Recorded from
-- GlobalExceptionFilter for any unhandled/internal (5xx) error.
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'SYSTEM_ERROR';
