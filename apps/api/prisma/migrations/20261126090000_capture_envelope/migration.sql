-- Prompt B, P1: event envelope, stream sequences, capture quality (additive only).

-- activity_logs envelope. server_received_at gets its default after the
-- column exists, so rows written before today stay NULL (not "now").
ALTER TABLE "activity_logs"
  ADD COLUMN IF NOT EXISTS "client_event_id" UUID,
  ADD COLUMN IF NOT EXISTS "client_seq" INTEGER,
  ADD COLUMN IF NOT EXISTS "tab_id" TEXT,
  ADD COLUMN IF NOT EXISTS "server_received_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "duration_ms" INTEGER,
  ADD COLUMN IF NOT EXISTS "source_channel" TEXT,
  ADD COLUMN IF NOT EXISTS "app_build" TEXT,
  ADD COLUMN IF NOT EXISTS "consent_scope" TEXT,
  ADD COLUMN IF NOT EXISTS "quality_code" TEXT,
  ADD COLUMN IF NOT EXISTS "slide_key" TEXT,
  ADD COLUMN IF NOT EXISTS "object_id" TEXT,
  ADD COLUMN IF NOT EXISTS "content_version" TEXT;
ALTER TABLE "activity_logs" ALTER COLUMN "server_received_at" SET DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS "activity_logs_session_id_client_event_id_key"
  ON "activity_logs"("session_id", "client_event_id");
CREATE INDEX IF NOT EXISTS "activity_logs_session_id_tab_id_client_seq_idx"
  ON "activity_logs"("session_id", "tab_id", "client_seq");

ALTER TABLE "student_sessions" ADD COLUMN IF NOT EXISTS "clock_offset_ms" INTEGER;

ALTER TABLE "cursor_logs" ADD COLUMN IF NOT EXISTS "tabId" TEXT, ADD COLUMN IF NOT EXISTS "clientSeq" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "cursor_logs_sessionId_tabId_clientSeq_key" ON "cursor_logs"("sessionId", "tabId", "clientSeq");
ALTER TABLE "click_logs" ADD COLUMN IF NOT EXISTS "tabId" TEXT, ADD COLUMN IF NOT EXISTS "clientSeq" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "click_logs_sessionId_tabId_clientSeq_key" ON "click_logs"("sessionId", "tabId", "clientSeq");
ALTER TABLE "scroll_logs" ADD COLUMN IF NOT EXISTS "tabId" TEXT, ADD COLUMN IF NOT EXISTS "clientSeq" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "scroll_logs_sessionId_tabId_clientSeq_key" ON "scroll_logs"("sessionId", "tabId", "clientSeq");
ALTER TABLE "keystroke_logs" ADD COLUMN IF NOT EXISTS "tabId" TEXT, ADD COLUMN IF NOT EXISTS "clientSeq" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "keystroke_logs_sessionId_tabId_clientSeq_key" ON "keystroke_logs"("sessionId", "tabId", "clientSeq");
ALTER TABLE "visibility_logs" ADD COLUMN IF NOT EXISTS "tabId" TEXT, ADD COLUMN IF NOT EXISTS "clientSeq" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "visibility_logs_sessionId_tabId_clientSeq_key" ON "visibility_logs"("sessionId", "tabId", "clientSeq");
ALTER TABLE "clipboard_logs" ADD COLUMN IF NOT EXISTS "tabId" TEXT, ADD COLUMN IF NOT EXISTS "clientSeq" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "clipboard_logs_sessionId_tabId_clientSeq_key" ON "clipboard_logs"("sessionId", "tabId", "clientSeq");

ALTER TABLE "keystroke_logs"
  ADD COLUMN IF NOT EXISTS "keys" JSONB,
  ADD COLUMN IF NOT EXISTS "text" TEXT,
  ADD COLUMN IF NOT EXISTS "burstStart" BIGINT,
  ADD COLUMN IF NOT EXISTS "fieldKind" TEXT;
ALTER TABLE "clipboard_logs" ADD COLUMN IF NOT EXISTS "text" TEXT;

CREATE TABLE IF NOT EXISTS "capture_quality" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "stream" TEXT NOT NULL,
    "tab_id" TEXT,
    "kind" TEXT NOT NULL,
    "from_seq" INTEGER,
    "to_seq" INTEGER,
    "count" INTEGER NOT NULL,
    "detected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "capture_quality_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "capture_quality_session_id_idx" ON "capture_quality"("session_id");
