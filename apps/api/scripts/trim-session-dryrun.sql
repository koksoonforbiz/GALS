-- Dry-run trim of runaway session 2e615380-3151-405f-987f-bb9736a71c66
-- Keep first 240 minutes (4 h) from session start, count what would be deleted past that point.
-- READ-ONLY: no DELETE / UPDATE statements anywhere.
--
-- Run with:
--   sudo docker compose exec -T postgres psql -U postgres -d ats_db \
--     -f /app/scripts/trim-session-dryrun.sql
-- (the api container mounts apps/api/ at /app, so /app/scripts works from the postgres
--  container too only if shared; otherwise copy/paste this file's contents into psql)
--
-- Simpler invocation, host-side, no path concerns:
--   sudo docker compose exec -T postgres psql -U postgres -d ats_db \
--     < apps/api/scripts/trim-session-dryrun.sql

\echo '── Session metadata + computed cutoff ──'
SELECT id,
       started_at,
       ended_at,
       duration_secs,
       started_at + interval '240 minutes' AS cutoff,
       (extract(epoch FROM (started_at + interval '240 minutes')) * 1000)::bigint AS cutoff_ms
  FROM student_sessions
 WHERE id = '2e615380-3151-405f-987f-bb9736a71c66';

\echo ''
\echo '── Row counts that would be DELETED (sorted by impact) ──'
WITH s AS (
  SELECT started_at + interval '240 minutes' AS cutoff,
         (extract(epoch FROM (started_at + interval '240 minutes')) * 1000)::bigint AS cutoff_ms
    FROM student_sessions
   WHERE id = '2e615380-3151-405f-987f-bb9736a71c66'
),
counts AS (
  SELECT 'cursor_logs'              AS tbl, COUNT(*) AS to_delete
    FROM cursor_logs, s
   WHERE "sessionId" = '2e615380-3151-405f-987f-bb9736a71c66'
     AND "timestamp" > s.cutoff_ms
  UNION ALL SELECT 'click_logs',     COUNT(*)
    FROM click_logs, s
   WHERE "sessionId" = '2e615380-3151-405f-987f-bb9736a71c66'
     AND "timestamp" > s.cutoff_ms
  UNION ALL SELECT 'scroll_logs',    COUNT(*)
    FROM scroll_logs, s
   WHERE "sessionId" = '2e615380-3151-405f-987f-bb9736a71c66'
     AND "timestamp" > s.cutoff_ms
  UNION ALL SELECT 'keystroke_logs', COUNT(*)
    FROM keystroke_logs, s
   WHERE "sessionId" = '2e615380-3151-405f-987f-bb9736a71c66'
     AND "timestamp" > s.cutoff_ms
  UNION ALL SELECT 'visibility_logs', COUNT(*)
    FROM visibility_logs, s
   WHERE "sessionId" = '2e615380-3151-405f-987f-bb9736a71c66'
     AND "timestamp" > s.cutoff_ms
  UNION ALL SELECT 'clipboard_logs', COUNT(*)
    FROM clipboard_logs, s
   WHERE "sessionId" = '2e615380-3151-405f-987f-bb9736a71c66'
     AND "timestamp" > s.cutoff_ms
  UNION ALL SELECT 'viewport_logs',  COUNT(*)
    FROM viewport_logs, s
   WHERE "sessionId" = '2e615380-3151-405f-987f-bb9736a71c66'
     AND "timestamp" > s.cutoff_ms
  UNION ALL SELECT 'activity_logs',  COUNT(*)
    FROM activity_logs, s
   WHERE session_id = '2e615380-3151-405f-987f-bb9736a71c66'::uuid
     AND occurred_at > s.cutoff
  UNION ALL SELECT 'session_replay_snapshots', COUNT(*)
    FROM session_replay_snapshots, s
   WHERE "sessionId" = '2e615380-3151-405f-987f-bb9736a71c66'::uuid
     AND "capturedAt" > s.cutoff_ms
  UNION ALL SELECT 'webgazer_logs',  COUNT(*)
    FROM webgazer_logs, s
   WHERE session_id = '2e615380-3151-405f-987f-bb9736a71c66'::uuid
     AND timestamp > s.cutoff
  UNION ALL SELECT 'pupil_size_logs', COUNT(*)
    FROM pupil_size_logs, s
   WHERE session_id = '2e615380-3151-405f-987f-bb9736a71c66'::uuid
     AND timestamp > s.cutoff
  UNION ALL SELECT 'recording_segments', COUNT(*)
    FROM recording_segments, s
   WHERE session_id = '2e615380-3151-405f-987f-bb9736a71c66'::uuid
     AND start_wall_time > s.cutoff
  UNION ALL SELECT 'emotion_frames', COUNT(*)
    FROM emotion_frames, s
   WHERE session_id = '2e615380-3151-405f-987f-bb9736a71c66'
     AND frame_wall_ms > s.cutoff_ms
  UNION ALL SELECT 'pyfeat_au_results (via pyfeat_jobs.session_id, wall_time)', COUNT(*)
    FROM pyfeat_au_results r
    JOIN pyfeat_jobs j ON j.id = r.job_id, s
   WHERE j.session_id = '2e615380-3151-405f-987f-bb9736a71c66'::uuid
     AND r.wall_time > s.cutoff
  UNION ALL SELECT 'pyfeat_jobs',    COUNT(*)
    FROM pyfeat_jobs, s
   WHERE session_id = '2e615380-3151-405f-987f-bb9736a71c66'::uuid
     AND created_at > s.cutoff
  UNION ALL SELECT 'openface3_jobs (via recording_segments.start_wall_time)', COUNT(*)
    FROM openface3_jobs o
    JOIN recording_segments rs ON rs.id = o.recording_segment_id, s
   WHERE rs.session_id = '2e615380-3151-405f-987f-bb9736a71c66'::uuid
     AND rs.start_wall_time > s.cutoff
  UNION ALL SELECT 'chatbot_messages', COUNT(*)
    FROM chatbot_messages, s
   WHERE student_session_id = '2e615380-3151-405f-987f-bb9736a71c66'::uuid
     AND created_at > s.cutoff
  UNION ALL SELECT 'ef_detections',  COUNT(*)
    FROM ef_detections, s
   WHERE "sessionId" = '2e615380-3151-405f-987f-bb9736a71c66'
     AND created_at > s.cutoff
)
SELECT * FROM counts ORDER BY to_delete DESC;

\echo ''
\echo '── MinIO blobs that would be DELETED (recording_segments past cutoff) ──'
WITH s AS (
  SELECT started_at + interval '240 minutes' AS cutoff
    FROM student_sessions WHERE id = '2e615380-3151-405f-987f-bb9736a71c66'
)
SELECT id,
       minio_key,
       start_wall_time,
       end_wall_time,
       duration_ms,
       file_size_bytes,
       upload_status
  FROM recording_segments, s
 WHERE session_id = '2e615380-3151-405f-987f-bb9736a71c66'::uuid
   AND start_wall_time > s.cutoff
 ORDER BY start_wall_time;

\echo ''
\echo '── Approximate disk freed (sum of file_size_bytes past cutoff) ──'
WITH s AS (
  SELECT started_at + interval '240 minutes' AS cutoff
    FROM student_sessions WHERE id = '2e615380-3151-405f-987f-bb9736a71c66'
)
SELECT pg_size_pretty(COALESCE(SUM(file_size_bytes), 0)::bigint) AS minio_bytes_to_free,
       COUNT(*)                                                   AS segments_past_cutoff
  FROM recording_segments, s
 WHERE session_id = '2e615380-3151-405f-987f-bb9736a71c66'::uuid
   AND start_wall_time > s.cutoff;
