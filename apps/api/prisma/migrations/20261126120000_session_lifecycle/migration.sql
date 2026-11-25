-- Prompt B, P2: session lifecycle (additive only).
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'PAGE_LEFT';

ALTER TABLE "student_sessions"
  ADD COLUMN IF NOT EXISTS "close_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "params_version" TEXT,
  ADD COLUMN IF NOT EXISTS "previous_session_id" UUID,
  ADD COLUMN IF NOT EXISTS "episode_key" TEXT;

CREATE TABLE IF NOT EXISTS "session_parse_runs" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "library_version" TEXT,
    "parameter_set_version" INTEGER,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    "status" TEXT NOT NULL,
    "raw_actions" INTEGER,
    "detections" INTEGER,
    "error" TEXT,
    CONSTRAINT "session_parse_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "session_parse_runs_session_id_started_at_idx" ON "session_parse_runs"("session_id", "started_at");
