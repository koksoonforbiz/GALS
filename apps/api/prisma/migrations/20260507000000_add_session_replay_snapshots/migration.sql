CREATE TABLE "session_replay_snapshots" (
    "id" TEXT NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "scrollX" INTEGER NOT NULL DEFAULT 0,
    "scrollY" INTEGER NOT NULL DEFAULT 0,
    "capturedAt" BIGINT NOT NULL,
    "trigger" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_replay_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "session_replay_snapshots_sessionId_capturedAt_idx"
ON "session_replay_snapshots"("sessionId", "capturedAt");

ALTER TABLE "session_replay_snapshots"
ADD CONSTRAINT "session_replay_snapshots_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "student_sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
