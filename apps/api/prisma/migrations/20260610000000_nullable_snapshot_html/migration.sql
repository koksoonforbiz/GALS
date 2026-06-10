-- Make session_replay_snapshots.html nullable so snapshots can be stored
-- without DOM serialisation (pixel-screenshot-only mode).
-- Existing rows keep their current html value; new pixel-only snapshots
-- will have html = NULL.
ALTER TABLE "session_replay_snapshots" ALTER COLUMN "html" DROP NOT NULL;
