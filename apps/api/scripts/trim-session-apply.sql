-- Apply trim of runaway session 2e615380-3151-405f-987f-bb9736a71c66
-- Keep first 240 minutes (4 h) from session start, DELETE rows past that cutoff.
--
-- Per the dry-run, only session_replay_snapshots (61,847), visibility_logs (1),
-- and activity_logs (1) have rows past the cutoff. No MinIO blobs to delete.
--
-- DESTRUCTIVE — runs inside a single DO block (implicit transaction), so
-- either the whole trim succeeds or none of it does. Re-running is safe
-- but a no-op (counts will drop to 0 on the second run).
--
-- Run with:
--   sudo docker compose exec -T postgres psql -U ats_user -d ats_db \
--     < apps/api/scripts/trim-session-apply.sql

DO $$
DECLARE
  v_session_id   uuid := '2e615380-3151-405f-987f-bb9736a71c66';
  v_keep_minutes int  := 240;
  v_started_at   timestamptz;
  v_cutoff       timestamptz;
  v_cutoff_ms    bigint;
  v_n            int;
BEGIN
  SELECT started_at INTO v_started_at
    FROM student_sessions WHERE id = v_session_id;
  IF v_started_at IS NULL THEN
    RAISE EXCEPTION 'Session % not found', v_session_id;
  END IF;

  v_cutoff    := v_started_at + (v_keep_minutes || ' minutes')::interval;
  v_cutoff_ms := (extract(epoch FROM v_cutoff) * 1000)::bigint;

  RAISE NOTICE '── Trimming session % ──', v_session_id;
  RAISE NOTICE 'Started: %', v_started_at;
  RAISE NOTICE 'Cutoff:  % (ms: %)', v_cutoff, v_cutoff_ms;
  RAISE NOTICE '';

  -- The big one: 61,847 DOM snapshots
  DELETE FROM session_replay_snapshots
   WHERE "sessionId" = v_session_id AND "capturedAt" > v_cutoff_ms;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '  session_replay_snapshots: % deleted', v_n;

  -- Per-frame interaction logs (bigint ms timestamp, camelCase columns)
  DELETE FROM cursor_logs
   WHERE "sessionId" = v_session_id::text AND "timestamp" > v_cutoff_ms;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '  cursor_logs:              % deleted', v_n;

  DELETE FROM click_logs
   WHERE "sessionId" = v_session_id::text AND "timestamp" > v_cutoff_ms;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '  click_logs:               % deleted', v_n;

  DELETE FROM scroll_logs
   WHERE "sessionId" = v_session_id::text AND "timestamp" > v_cutoff_ms;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '  scroll_logs:              % deleted', v_n;

  DELETE FROM keystroke_logs
   WHERE "sessionId" = v_session_id::text AND "timestamp" > v_cutoff_ms;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '  keystroke_logs:           % deleted', v_n;

  DELETE FROM visibility_logs
   WHERE "sessionId" = v_session_id::text AND "timestamp" > v_cutoff_ms;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '  visibility_logs:          % deleted', v_n;

  DELETE FROM clipboard_logs
   WHERE "sessionId" = v_session_id::text AND "timestamp" > v_cutoff_ms;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '  clipboard_logs:           % deleted', v_n;

  DELETE FROM viewport_logs
   WHERE "sessionId" = v_session_id::text AND "timestamp" > v_cutoff_ms;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '  viewport_logs:            % deleted', v_n;

  -- snake_case tables (timestamptz columns)
  DELETE FROM activity_logs
   WHERE session_id = v_session_id AND occurred_at > v_cutoff;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '  activity_logs:            % deleted', v_n;

  DELETE FROM webgazer_logs
   WHERE session_id = v_session_id AND timestamp > v_cutoff;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '  webgazer_logs:            % deleted', v_n;

  DELETE FROM pupil_size_logs
   WHERE session_id = v_session_id AND timestamp > v_cutoff;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '  pupil_size_logs:          % deleted', v_n;

  DELETE FROM emotion_frames
   WHERE session_id = v_session_id::text AND frame_wall_ms > v_cutoff_ms;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '  emotion_frames:           % deleted', v_n;

  DELETE FROM chatbot_messages
   WHERE student_session_id = v_session_id AND created_at > v_cutoff;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '  chatbot_messages:         % deleted', v_n;

  DELETE FROM ef_detections
   WHERE "sessionId" = v_session_id::text AND created_at > v_cutoff;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '  ef_detections:            % deleted', v_n;

  -- pyfeat_au_results past cutoff (joined via pyfeat_jobs.session_id)
  DELETE FROM pyfeat_au_results r
   USING pyfeat_jobs j
   WHERE r.job_id = j.id
     AND j.session_id = v_session_id
     AND r.wall_time > v_cutoff;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '  pyfeat_au_results:        % deleted', v_n;

  DELETE FROM pyfeat_jobs
   WHERE session_id = v_session_id AND created_at > v_cutoff;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '  pyfeat_jobs:              % deleted', v_n;

  -- openface3_jobs whose recording_segment is past cutoff (none expected)
  DELETE FROM openface3_jobs o
   USING recording_segments rs
   WHERE o.recording_segment_id = rs.id
     AND rs.session_id = v_session_id
     AND rs.start_wall_time > v_cutoff;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '  openface3_jobs:           % deleted', v_n;

  -- recording_segments past cutoff (none expected, but covered)
  DELETE FROM recording_segments
   WHERE session_id = v_session_id AND start_wall_time > v_cutoff;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '  recording_segments:       % deleted', v_n;

  -- Truncate session metadata to match the trim
  UPDATE student_sessions
     SET ended_at      = v_cutoff,
         duration_secs = v_keep_minutes * 60
   WHERE id = v_session_id;

  RAISE NOTICE '';
  RAISE NOTICE 'Updated student_sessions: ended_at = %, duration_secs = %',
    v_cutoff, v_keep_minutes * 60;
  RAISE NOTICE '── Done ──';
END $$;

-- Sanity check after the trim
SELECT id, started_at, ended_at, duration_secs
  FROM student_sessions
 WHERE id = '2e615380-3151-405f-987f-bb9736a71c66';
