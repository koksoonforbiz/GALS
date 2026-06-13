-- Bug 4 (2026-06-12): per-turn slide context in the chat review surface.
--
-- The student review surface previously only displayed the most recent
-- `selected_text` because chat() rewrote it on every turn. We now also
-- need the PDF page number at the moment of the question so each row in
-- the review can be tagged with "Re: «…» (page X)" — without it the
-- review just shows the LAST highlight, not the highlight that drove
-- each individual question.
--
-- `selected_text` already exists; this migration only adds the new
-- `current_page` column. Nullable so legacy rows (and rows produced by
-- PAGE-type lessons that don't track page state) keep working, and
-- additive so no rollback / data backfill is needed.

ALTER TABLE chatbot_messages
  ADD COLUMN IF NOT EXISTS current_page INTEGER;
