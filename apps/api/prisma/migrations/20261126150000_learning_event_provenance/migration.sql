-- Prompt B, P4: learning-event provenance, parameter snapshots, coverage (additive only).
ALTER TABLE "learning_events"
  ADD COLUMN IF NOT EXISTS "detection_key" TEXT,
  ADD COLUMN IF NOT EXISTS "library_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "engine_version" TEXT,
  ADD COLUMN IF NOT EXISTS "parameter_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "computed_values" JSONB,
  ADD COLUMN IF NOT EXISTS "alternatives" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "evidence_class" TEXT,
  ADD COLUMN IF NOT EXISTS "source_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "is_current" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "parse_run_id" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "learning_events_detection_key_key" ON "learning_events"("detection_key");
CREATE INDEX IF NOT EXISTS "learning_events_session_id_is_current_idx" ON "learning_events"("session_id", "is_current");

ALTER TABLE "session_parse_runs"
  ADD COLUMN IF NOT EXISTS "library_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "parameter_hash" TEXT;

CREATE TABLE IF NOT EXISTS "parameter_set_snapshots" (
    "hash" TEXT NOT NULL,
    "library_version" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "parameter_set_snapshots_pkey" PRIMARY KEY ("hash")
);

CREATE TABLE IF NOT EXISTS "learning_event_coverage" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "library_version" TEXT NOT NULL,
    "library_hash" TEXT NOT NULL,
    "parameter_hash" TEXT NOT NULL,
    "active_ms" INTEGER NOT NULL,
    "explained_ms" INTEGER NOT NULL,
    "actions" INTEGER NOT NULL,
    "explained_actions" INTEGER NOT NULL,
    "no_pattern_spans" INTEGER NOT NULL,
    "unresolved" INTEGER NOT NULL,
    "not_applicable" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "learning_event_coverage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "learning_event_coverage_session_id_is_current_idx" ON "learning_event_coverage"("session_id", "is_current");
