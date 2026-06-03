-- Add nullable AOI rectangles column to session_replay_snapshots.
-- Pre-existing rows stay valid (NULL means "no AOI capture at this snapshot").
-- The column stores an array of viewport-relative region rects, e.g.:
--   [{ "region": "lesson", "x": 256, "y": 80, "width": 1024, "height": 720 }, ...]

ALTER TABLE "session_replay_snapshots"
  ADD COLUMN "aois" JSONB;
