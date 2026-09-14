-- Adds USAGE_QUOTA_EXCEEDED to SecurityEventType so LlmUsageQuotaService
-- can record a cap-hit into the queryable security_events table
-- instead of only Logger.warn output.
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'USAGE_QUOTA_EXCEEDED';
