-- Prompting course: server-derived learning events imported from the
-- optional bundle stream derived/learning_events.jsonl.

-- CreateTable
CREATE TABLE "LearningEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "endWallMs" REAL NOT NULL,
    "ruleId" TEXT NOT NULL,
    "eventFamily" TEXT NOT NULL,
    "outcome" TEXT,
    "moduleItemId" TEXT,
    "slideKey" TEXT,
    "confidence" TEXT NOT NULL,
    "libraryVersion" TEXT NOT NULL,
    "parameterSetVersion" INTEGER NOT NULL,
    CONSTRAINT "LearningEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LearningEvent_sessionId_wallMs_idx" ON "LearningEvent"("sessionId", "wallMs");
