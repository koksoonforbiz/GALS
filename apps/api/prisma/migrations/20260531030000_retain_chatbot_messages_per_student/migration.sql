-- Retention fix for floating / docked chatbot history (Prompt 01).
--
-- Today `chatbot_messages` cascade-deletes with `student_sessions`. That
-- means once a student's session row is purged their entire chat
-- history goes with it, so the "review later" workflow is impossible
-- for standard-mode chat. Fix it minimally:
--
--   1. Add a NOT NULL `student_id` column that owns the message. Cascade
--      on user deletion (account purge), which is the only retention
--      bound we actually want.
--   2. Make `student_session_id` NULLABLE and drop the cascade FK,
--      replacing it with ON DELETE SET NULL. The column stays around so
--      live-session queries (teacher replay timeline, biometrics
--      windowing) still work, but a session purge no longer takes the
--      conversation with it.
--   3. Backfill `student_id` from the existing
--      `student_sessions.user_id` join so historical rows stay valid.
--
-- All changes are additive at the row level (no data loss). Existing
-- rows are filled in from the join before the NOT NULL constraint is
-- enforced.

-- 1. Add the new column nullable so the backfill can run.
ALTER TABLE "chatbot_messages"
  ADD COLUMN "student_id" UUID;

-- 2. Backfill from student_sessions. Every existing row has a
--    non-null student_session_id (NOT NULL on the original column),
--    so the join is guaranteed to populate every row.
UPDATE "chatbot_messages" m
SET    "student_id" = s."user_id"
FROM   "student_sessions" s
WHERE  m."student_session_id" = s."id"
  AND  m."student_id" IS NULL;

-- 3. Now it's safe to enforce NOT NULL on the owner column.
ALTER TABLE "chatbot_messages"
  ALTER COLUMN "student_id" SET NOT NULL;

-- 4. Add the FK + cascade to users.
ALTER TABLE "chatbot_messages"
  ADD CONSTRAINT "chatbot_messages_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Index for the student-scoped "Chat History" review query.
CREATE INDEX "chatbot_messages_student_id_created_at_idx"
  ON "chatbot_messages"("student_id", "created_at");

-- 6. Loosen the session FK: drop the cascade, allow null, and recreate
--    with ON DELETE SET NULL so a session purge orphans the row
--    instead of deleting it.
ALTER TABLE "chatbot_messages"
  DROP CONSTRAINT "chatbot_messages_student_session_id_fkey";

ALTER TABLE "chatbot_messages"
  ALTER COLUMN "student_session_id" DROP NOT NULL;

ALTER TABLE "chatbot_messages"
  ADD CONSTRAINT "chatbot_messages_student_session_id_fkey"
  FOREIGN KEY ("student_session_id") REFERENCES "student_sessions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
