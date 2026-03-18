-- AlterTable: change dialogue_session_id from uuid to text
-- DialogueSession uses cuid() IDs, not UUIDs
ALTER TABLE "activity_logs" ALTER COLUMN "dialogue_session_id" TYPE TEXT;
