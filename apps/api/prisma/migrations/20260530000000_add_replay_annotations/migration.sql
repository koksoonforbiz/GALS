-- Researcher annotation layer (prompt 06). Two tables:
--   replay_codes        — researcher-defined tag taxonomy
--   replay_annotations  — point or range markers per session+researcher
--
-- Both additive; cascade delete from session/researcher; SetNull on
-- code delete so removing a code doesn't lose annotation note bodies.

CREATE TABLE "replay_codes" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "researcher_id" UUID NOT NULL,
  "label"         TEXT NOT NULL,
  "color"         TEXT,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "replay_codes_researcher_id_fkey"
    FOREIGN KEY ("researcher_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX "replay_codes_researcher_id_idx" ON "replay_codes"("researcher_id");

CREATE TABLE "replay_annotations" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id"    UUID NOT NULL,
  "researcher_id" UUID NOT NULL,
  "code_id"       UUID,
  "start_ms"      BIGINT NOT NULL,
  "end_ms"        BIGINT,
  "note"          TEXT,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "replay_annotations_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "student_sessions"("id") ON DELETE CASCADE,
  CONSTRAINT "replay_annotations_researcher_id_fkey"
    FOREIGN KEY ("researcher_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "replay_annotations_code_id_fkey"
    FOREIGN KEY ("code_id") REFERENCES "replay_codes"("id") ON DELETE SET NULL
);

CREATE INDEX "replay_annotations_session_id_start_ms_idx"
  ON "replay_annotations"("session_id", "start_ms");
CREATE INDEX "replay_annotations_researcher_id_idx"
  ON "replay_annotations"("researcher_id");
