-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "moduleId" TEXT,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "durationMs" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "baseWallClockMs" REAL NOT NULL,
    "device" TEXT,
    "bundleVersion" INTEGER NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "manifest" TEXT NOT NULL,
    "mediaDir" TEXT NOT NULL,
    "userDisplayName" TEXT,
    "courseTitle" TEXT,
    "moduleTitle" TEXT
);

-- CreateTable
CREATE TABLE "GazeSample" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "x" REAL NOT NULL,
    "y" REAL NOT NULL,
    "confidence" REAL,
    CONSTRAINT "GazeSample_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PupilSample" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "diameter" REAL NOT NULL,
    CONSTRAINT "PupilSample_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmotionFrame" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "faceDetected" BOOLEAN NOT NULL DEFAULT false,
    "dominant" TEXT,
    "dominantProbability" REAL,
    "pHappiness" REAL,
    "pSadness" REAL,
    "pSurprise" REAL,
    "pFear" REAL,
    "pAnger" REAL,
    "pDisgust" REAL,
    "pContempt" REAL,
    "pNeutral" REAL,
    CONSTRAINT "EmotionFrame_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "faceConf" REAL,
    "aus" TEXT NOT NULL,
    CONSTRAINT "AuResult_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Click" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "x" REAL NOT NULL,
    "y" REAL NOT NULL,
    "target" TEXT,
    "pageUrl" TEXT,
    CONSTRAINT "Click_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Scroll" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "scrollY" REAL,
    "scrollPercent" REAL,
    "pageUrl" TEXT,
    "scrollHosts" TEXT,
    CONSTRAINT "Scroll_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Cursor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "x" REAL NOT NULL,
    "y" REAL NOT NULL,
    "target" TEXT,
    CONSTRAINT "Cursor_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Keystroke" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "fieldId" TEXT,
    "keystrokeCount" INTEGER,
    "pauseDurationMs" INTEGER,
    "typingSpeedWPM" REAL,
    CONSTRAINT "Keystroke_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Clipboard" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "action" TEXT,
    "textLength" INTEGER,
    "sourceElement" TEXT,
    CONSTRAINT "Clipboard_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Visibility" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "visibleState" TEXT,
    "hiddenDurationMs" INTEGER,
    CONSTRAINT "Visibility_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Viewport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "orientation" TEXT,
    CONSTRAINT "Viewport_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" TEXT,
    "interventionId" TEXT,
    "dialogueSessionId" TEXT,
    "moduleItemId" TEXT,
    CONSTRAINT "ActivityEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "trigger" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "scrollX" INTEGER NOT NULL,
    "scrollY" INTEGER NOT NULL,
    "aois" TEXT,
    "scrollHosts" TEXT,
    "pdfCurrentPage" INTEGER,
    "pdfTotalPages" INTEGER,
    "htmlPath" TEXT NOT NULL,
    "screenshotPath" TEXT,
    CONSTRAINT "Snapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebcamSegment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "startWallMs" REAL NOT NULL,
    "endWallMs" REAL,
    "mp4Path" TEXT,
    "byteSize" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "mimeType" TEXT,
    CONSTRAINT "WebcamSegment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatbotMessage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "selectedText" TEXT,
    "model" TEXT,
    CONSTRAINT "ChatbotMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DialogueMessage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "dialogueSessionId" TEXT,
    CONSTRAINT "DialogueMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Intervention" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "externalId" TEXT,
    "type" TEXT,
    "status" TEXT,
    "sessionData" TEXT,
    "selectedText" TEXT,
    CONSTRAINT "Intervention_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EfDetection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "construct" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "confidence" REAL,
    "severity" TEXT,
    "rationale" TEXT,
    "model" TEXT,
    "sourceRef" TEXT,
    CONSTRAINT "EfDetection_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Mastery" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "data" TEXT NOT NULL,
    CONSTRAINT "Mastery_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpacedRepCard" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "data" TEXT NOT NULL,
    CONSTRAINT "SpacedRepCard_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "data" TEXT NOT NULL,
    CONSTRAINT "Attempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProbeResponse" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "wallMs" REAL NOT NULL,
    "probeType" TEXT NOT NULL,
    "items" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "scheduledWallMs" REAL,
    "shownWallMs" REAL,
    "completed" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ProbeResponse_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Questionnaire" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "instrument" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "items" TEXT NOT NULL,
    "scoredSubscales" TEXT,
    "completedAt" DATETIME,
    CONSTRAINT "Questionnaire_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Coder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CodebookVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CodingWindow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "startWallMs" REAL NOT NULL,
    "endWallMs" REAL NOT NULL,
    "durationMs" INTEGER NOT NULL DEFAULT 20000,
    CONSTRAINT "CodingWindow_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Annotation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "windowId" TEXT,
    "coderId" TEXT NOT NULL,
    "codingPass" TEXT NOT NULL,
    "codebookVersionId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "intensity" INTEGER,
    "confidence" TEXT,
    "atWallMs" REAL,
    "startWallMs" REAL,
    "endWallMs" REAL,
    "notes" TEXT,
    "codingMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Annotation_coderId_fkey" FOREIGN KEY ("coderId") REFERENCES "Coder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Annotation_codebookVersionId_fkey" FOREIGN KEY ("codebookVersionId") REFERENCES "CodebookVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CarriedAnnotation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "externalId" TEXT,
    "startMs" REAL NOT NULL,
    "endMs" REAL,
    "note" TEXT,
    "codeId" TEXT,
    "codeLabel" TEXT,
    "codeColor" TEXT,
    "researcherId" TEXT,
    CONSTRAINT "CarriedAnnotation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReliabilityRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "metrics" TEXT NOT NULL,
    "params" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "GazeSample_sessionId_wallMs_idx" ON "GazeSample"("sessionId", "wallMs");

-- CreateIndex
CREATE INDEX "PupilSample_sessionId_wallMs_idx" ON "PupilSample"("sessionId", "wallMs");

-- CreateIndex
CREATE INDEX "EmotionFrame_sessionId_wallMs_idx" ON "EmotionFrame"("sessionId", "wallMs");

-- CreateIndex
CREATE INDEX "AuResult_sessionId_wallMs_idx" ON "AuResult"("sessionId", "wallMs");

-- CreateIndex
CREATE INDEX "Click_sessionId_wallMs_idx" ON "Click"("sessionId", "wallMs");

-- CreateIndex
CREATE INDEX "Scroll_sessionId_wallMs_idx" ON "Scroll"("sessionId", "wallMs");

-- CreateIndex
CREATE INDEX "Cursor_sessionId_wallMs_idx" ON "Cursor"("sessionId", "wallMs");

-- CreateIndex
CREATE INDEX "Keystroke_sessionId_wallMs_idx" ON "Keystroke"("sessionId", "wallMs");

-- CreateIndex
CREATE INDEX "Clipboard_sessionId_wallMs_idx" ON "Clipboard"("sessionId", "wallMs");

-- CreateIndex
CREATE INDEX "Visibility_sessionId_wallMs_idx" ON "Visibility"("sessionId", "wallMs");

-- CreateIndex
CREATE INDEX "Viewport_sessionId_wallMs_idx" ON "Viewport"("sessionId", "wallMs");

-- CreateIndex
CREATE INDEX "ActivityEvent_sessionId_wallMs_idx" ON "ActivityEvent"("sessionId", "wallMs");

-- CreateIndex
CREATE INDEX "Snapshot_sessionId_wallMs_idx" ON "Snapshot"("sessionId", "wallMs");

-- CreateIndex
CREATE INDEX "WebcamSegment_sessionId_startWallMs_idx" ON "WebcamSegment"("sessionId", "startWallMs");

-- CreateIndex
CREATE INDEX "ChatbotMessage_sessionId_wallMs_idx" ON "ChatbotMessage"("sessionId", "wallMs");

-- CreateIndex
CREATE INDEX "DialogueMessage_sessionId_wallMs_idx" ON "DialogueMessage"("sessionId", "wallMs");

-- CreateIndex
CREATE INDEX "Intervention_sessionId_wallMs_idx" ON "Intervention"("sessionId", "wallMs");

-- CreateIndex
CREATE INDEX "EfDetection_sessionId_wallMs_idx" ON "EfDetection"("sessionId", "wallMs");

-- CreateIndex
CREATE INDEX "ProbeResponse_sessionId_wallMs_idx" ON "ProbeResponse"("sessionId", "wallMs");

-- CreateIndex
CREATE UNIQUE INDEX "CodebookVersion_name_version_key" ON "CodebookVersion"("name", "version");

-- CreateIndex
CREATE INDEX "CodingWindow_sessionId_index_idx" ON "CodingWindow"("sessionId", "index");

-- CreateIndex
CREATE INDEX "Annotation_sessionId_windowId_coderId_codingPass_dimension_idx" ON "Annotation"("sessionId", "windowId", "coderId", "codingPass", "dimension");
