-- CAP-40/41: record data that reached the API but was not stored (additive).
CREATE TABLE IF NOT EXISTS "ingest_issues" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stream" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "session_id" UUID,
    "user_id" UUID,
    "action" TEXT,
    "reason" TEXT NOT NULL,
    "event_count" INTEGER NOT NULL,
    "raw_bytes" INTEGER,
    CONSTRAINT "ingest_issues_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ingest_issues_session_id_idx" ON "ingest_issues"("session_id");
CREATE INDEX IF NOT EXISTS "ingest_issues_created_at_idx" ON "ingest_issues"("created_at");
