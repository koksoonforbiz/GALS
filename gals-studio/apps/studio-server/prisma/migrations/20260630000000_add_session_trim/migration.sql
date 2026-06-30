-- CreateTable: researcher-set retained window (crop) per session. Offsets are
-- ms from baseWallClockMs; null = unbounded. Durable (no FK to Session).
CREATE TABLE "SessionTrim" (
    "sessionId" TEXT NOT NULL PRIMARY KEY,
    "startMs" REAL,
    "endMs" REAL,
    "updatedAt" DATETIME NOT NULL
);
