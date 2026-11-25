-- Prompt B, P5: copy provenance on clipboard rows (additive only).
ALTER TABLE "clipboard_logs"
  ADD COLUMN IF NOT EXISTS "aiSimilarity" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "matchedTurnId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceChannel" TEXT,
  ADD COLUMN IF NOT EXISTS "targetField" TEXT;
