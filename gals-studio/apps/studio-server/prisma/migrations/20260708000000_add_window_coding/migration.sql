-- CreateTable
CREATE TABLE "WindowCoding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "coderId" TEXT NOT NULL,
    "windowStartMs" INTEGER NOT NULL,
    "windowDurationSec" INTEGER NOT NULL,
    "codebookVersion" TEXT NOT NULL,
    "behaviourOntask" TEXT,
    "engagement" TEXT,
    "confusion" TEXT,
    "frustration" TEXT,
    "boredom" TEXT,
    "justBehaviourOntask" TEXT,
    "justEngagement" TEXT,
    "justConfusion" TEXT,
    "justFrustration" TEXT,
    "justBoredom" TEXT,
    "justNeutral" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "WindowCoding_sessionId_coderId_windowStartMs_windowDurationSec_key" ON "WindowCoding"("sessionId", "coderId", "windowStartMs", "windowDurationSec");

-- CreateIndex
CREATE INDEX "WindowCoding_sessionId_coderId_windowDurationSec_idx" ON "WindowCoding"("sessionId", "coderId", "windowDurationSec");
