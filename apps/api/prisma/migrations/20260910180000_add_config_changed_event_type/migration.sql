-- Checklist item 25 — "system or security configuration changes" wasn't
-- captured anywhere queryable. Adds CONFIG_CHANGED to SecurityEventType so
-- course/enrollment-policy/dialogue/recording-config edits can be recorded
-- into the queryable security_events table.
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'CONFIG_CHANGED';
