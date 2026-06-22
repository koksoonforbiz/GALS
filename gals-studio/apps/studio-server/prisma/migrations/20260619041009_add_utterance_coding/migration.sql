-- CreateTable
CREATE TABLE "UtteranceCoding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "coderId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "refWallMs" REAL NOT NULL,
    "role" TEXT,
    "preview" TEXT,
    "efConstruct" TEXT,
    "affect" TEXT,
    "strategy" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "UtteranceCoding_sessionId_coderId_idx" ON "UtteranceCoding"("sessionId", "coderId");

-- CreateIndex
CREATE UNIQUE INDEX "UtteranceCoding_sessionId_coderId_source_refWallMs_key" ON "UtteranceCoding"("sessionId", "coderId", "source", "refWallMs");
