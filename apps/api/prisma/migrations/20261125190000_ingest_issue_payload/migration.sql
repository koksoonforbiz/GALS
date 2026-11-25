-- Keep the events that were not stored, as received (additive).
ALTER TABLE "ingest_issues" ADD COLUMN IF NOT EXISTS "payload" TEXT;
