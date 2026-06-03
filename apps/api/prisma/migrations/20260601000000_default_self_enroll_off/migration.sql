-- Prompt 05: flip the default for `courses.allow_student_self_enroll`
-- from TRUE → FALSE so newly-created courses are teacher-enroll-only
-- unless the teacher explicitly opts in from Settings → Enrollment.
--
-- INTENTIONALLY DOES NOT UPDATE EXISTING ROWS. Prompt 05 calls for
-- this to be a deliberate switch per course, not a silent mass
-- regression. To find rows still on the old default after this
-- migration is applied, run:
--
--   SELECT id, title, teacher_id, created_at
--     FROM courses
--    WHERE allow_student_self_enroll = true
--    ORDER BY created_at;
--
-- The teacher can then flip them deliberately in the Settings UI
-- (PromptSettingsPage → Enrollment tab) or via the existing
-- PATCH /courses/:id/enrollment-policy endpoint.

ALTER TABLE "courses"
  ALTER COLUMN "allow_student_self_enroll" SET DEFAULT false;
