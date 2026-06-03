-- P4 — make Practice Testing default question counts teacher-tunable
-- per course. Two new nullable columns on intervention_prompt_configs;
-- when both are NULL (default for existing rows), the service falls
-- back to the hard-coded 3+2. When either is set, that value
-- overrides the hard-coded fallback. Only consulted on the
-- PRACTICE_TESTING row; ignored for other intervention types.
--
-- Additive + nullable so the migration is safe to apply against any
-- existing dataset. IF NOT EXISTS keeps it idempotent.
ALTER TABLE "intervention_prompt_configs"
  ADD COLUMN IF NOT EXISTS "default_mcq_count" INTEGER;

ALTER TABLE "intervention_prompt_configs"
  ADD COLUMN IF NOT EXISTS "default_short_answer_count" INTEGER;
