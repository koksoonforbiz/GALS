-- Enrollment policy flags (prompt 03).
--
-- Two per-course toggles that the teacher controls in the per-course
-- Settings page (PromptSettingsPage at /teacher/courses/:courseId/prompts).
-- Backend is the source of truth: when a flag is off, the matching
-- student endpoint returns 403. Teacher/admin enroll/drop are never
-- gated by these flags.
--
-- Defaults are chosen to preserve the de-facto behaviour for existing
-- rows so no backfill is needed:
--   - allow_student_self_enroll = true   (CatalogPage already let any
--     student enroll in PUBLISHED + PUBLIC + non-archived courses).
--   - allow_student_self_drop   = false  (this prompt removes student
--     self-drop by default).

ALTER TABLE "courses"
  ADD COLUMN "allow_student_self_enroll" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allow_student_self_drop"   BOOLEAN NOT NULL DEFAULT false;
