# TEST STAGE 5 — Cross-Feature Integration, Performance & Cleanup

## Your Role

You are a test assistant for the **Adaptive Tutoring System (ATS)**. This is the final test stage. It verifies that all four biometric features work **together** correctly, checks performance under combined load, and provides cleanup commands to reset the test environment.

Run in order. Report each result as **PASS**, **FAIL**, or **BLOCKED**.

---

## Values From Previous Stages

```
COURSE_ID   = _______________
STUDENT_ID  = _______________
SESSION_ID  = _______________
JOB_ID      = _______________
TEACHER_JWT = _______________
API_BASE    = http://localhost:3000
WEB_BASE    = http://localhost:5173
```

---

## Pre-Condition: Enable All Four Features

Before running CI tests, ensure **all four features are enabled** for `{COURSE_ID}`:

```bash
# Enable Recording
curl -X PATCH {API_BASE}/recording/config/{COURSE_ID} \
  -H "Authorization: Bearer {TEACHER_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"isEnabled": true}'

# Enable Pupil Size
curl -X PATCH {API_BASE}/pupil-size/config/{COURSE_ID} \
  -H "Authorization: Bearer {TEACHER_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"isEnabled": true}'

# Enable WebGazer
curl -X PATCH {API_BASE}/webgazer/config/{COURSE_ID} \
  -H "Authorization: Bearer {TEACHER_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"isEnabled": true, "calibrationOnNewSession": true, "recalibrationEnabled": true, "inactivityTimeoutSecs": 1800}'

# Enable py-feat
curl -X PATCH {API_BASE}/pyfeat/config/{COURSE_ID} \
  -H "Authorization: Bearer {TEACHER_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"isEnabled": true, "extractionFps": 1.0, "detectorBackend": "retinaface", "auPredictor": "xgb", "enabledAus": ["AU06","AU12","AU25"]}'
```

Verify all four are enabled:
```sql
SELECT 'recording' AS feature, "isEnabled" FROM "RecordingConfig" WHERE "courseId" = '{COURSE_ID}'
UNION ALL
SELECT 'pupil_size', "isEnabled" FROM "PupilSizeConfig" WHERE "courseId" = '{COURSE_ID}'
UNION ALL
SELECT 'webgazer', "isEnabled" FROM "WebgazerConfig" WHERE "courseId" = '{COURSE_ID}'
UNION ALL
SELECT 'pyfeat', "isEnabled" FROM "PyfeatConfig" WHERE "courseId" = '{COURSE_ID}';
```
Expected: 4 rows, all `isEnabled = true`

---

## CI-1: All Four Data Streams Active Simultaneously

This is the key integration test — all four features running at the same time.

**Steps:**
1. Log in as student → navigate to `{WEB_BASE}/student/courses/{COURSE_ID}/dialogue` (DialogueLearning page)
2. Complete the WebGazer calibration when the modal appears
3. Confirm: red recording dot is visible, green gaze status badge is visible
4. **Stay on the page for 5 minutes**, actively looking at the screen and interacting with the dialogue
5. Note the new `sessionId` for this session — save as `{CI_SESSION_ID}`

**Expected during the session:**
- No JavaScript errors in DevTools Console
- Page remains responsive (not freezing or stuttering)
- Red dot remains throughout
- Gaze badge stays green
- Network tab: periodic flushes firing every 30 seconds for both `/pupil-size/logs` and `/webgazer/logs`

**DB verification after 5 minutes:**
```sql
-- All four streams have data
SELECT
  (SELECT COUNT(*) FROM "PupilSizeLog" WHERE "sessionId" = '{CI_SESSION_ID}') AS pupil_rows,
  (SELECT COUNT(*) FROM "WebgazerLog" WHERE "sessionId" = '{CI_SESSION_ID}') AS gaze_rows,
  (SELECT COUNT(*) FROM "RecordingSegment" WHERE "sessionId" = '{CI_SESSION_ID}') AS segments,
  (SELECT COUNT(*) FROM "ActivityLog"
    WHERE "sessionId" = '{CI_SESSION_ID}'
    AND action IN (
      'PUPIL_SIZE_TRACKING_STARTED',
      'WEBGAZER_TRACKING_STARTED',
      'RECORDING_STARTED'
    )
  ) AS startup_events;
```
Expected:
- `pupil_rows > 500` (5 min × 2 Hz × ~60s flush cycles)
- `gaze_rows > 1400` (5 min × 5 Hz)
- `segments >= 1`
- `startup_events = 3`

**Result:** PASS / FAIL
**Notes:**

---

## CI-2: Timestamp Alignment Across All Streams

This test validates the core synchronisation requirement — all four data streams must share the same clock origin.

**Run this query after CI-1:**
```sql
SELECT
  MIN(p.timestamp)       AS pupil_first,
  MIN(w.timestamp)       AS gaze_first,
  rs."startWallTime"     AS recording_first,
  EXTRACT(EPOCH FROM (MIN(p.timestamp) - rs."startWallTime")) AS pupil_offset_s,
  EXTRACT(EPOCH FROM (MIN(w.timestamp) - rs."startWallTime")) AS gaze_offset_s
FROM "PupilSizeLog" p
JOIN "WebgazerLog" w ON w."sessionId" = p."sessionId"
JOIN "RecordingSegment" rs ON rs."sessionId" = p."sessionId"
WHERE p."sessionId" = '{CI_SESSION_ID}'
GROUP BY rs."startWallTime";
```

**Expected:**
- `pupil_offset_s` is between **-5.0 and +5.0** seconds
- `gaze_offset_s` is between **-5.0 and +5.0** seconds
- Ideally both offsets are **< 0.5 seconds** if `wallClockOffset` is applied correctly

**ActivityLog wallClockOffset check:**
```sql
SELECT
  (metadata->>'wallClockOffset')::int AS wall_clock_offset_ms
FROM "ActivityLog"
WHERE "sessionId" = '{CI_SESSION_ID}'
  AND action = 'RECORDING_STARTED';
```
Expected: a positive integer, typically 500–5000 ms

**Result:** PASS / FAIL
**Notes:**

---

## CI-3: py-feat Job Auto-Triggered After Session Ends

**Steps:**
1. Have the student navigate away from the course (to trigger segment finalisation)
2. Wait for the recording segment upload to complete:
   ```sql
   SELECT "uploadStatus", "pyfeatJobId", "endWallTime"
   FROM "RecordingSegment"
   WHERE "sessionId" = '{CI_SESSION_ID}'
   ORDER BY "createdAt" DESC LIMIT 1;
   ```
   Wait until `uploadStatus = 'COMPLETED'`

3. Note `pyfeatJobId` — save as `{CI_JOB_ID}`

4. Monitor py-feat worker logs:
   ```bash
   docker-compose logs -f pyfeat-worker
   ```
   Wait for the job to complete (2–5 minutes depending on video length)

5. Verify job completion:
   ```sql
   SELECT id, status, "completedAt", "resultMinioKey"
   FROM "PyfeatJob"
   WHERE id = '{CI_JOB_ID}';
   ```
   Expected: `status = 'COMPLETED'`, `resultMinioKey` is set

6. **Cross-stream timestamp check between AU results and gaze data:**
   ```sql
   SELECT
     MIN(ar."wallTime") AS first_au_wall,
     MIN(w.timestamp) AS first_gaze_wall,
     EXTRACT(EPOCH FROM (MIN(ar."wallTime") - MIN(w.timestamp))) AS au_vs_gaze_offset_s
   FROM "PyfeatAuResult" ar
   JOIN "WebgazerLog" w ON w."sessionId" = '{CI_SESSION_ID}'
   WHERE ar."jobId" = '{CI_JOB_ID}'
   GROUP BY 1, 2;
   ```
   Expected: `au_vs_gaze_offset_s` between **-5.0 and +5.0**

**Result:** PASS / FAIL
**Notes:**

---

## CI-4: BiometricsActiveBanner Shows Correct Active Features

Test that the banner accurately reflects the current state.

**Test A — All four enabled:**
- Student navigates to the course
- Expected banner: mentions recording, pupil tracking, and eye tracking
- Must NOT show py-feat (it runs server-side, not visible to student)

**Test B — Only Pupil + WebGazer enabled:**
```bash
curl -X PATCH {API_BASE}/recording/config/{COURSE_ID} \
  -H "Authorization: Bearer {TEACHER_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"isEnabled": false}'

curl -X PATCH {API_BASE}/pyfeat/config/{COURSE_ID} \
  -H "Authorization: Bearer {TEACHER_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"isEnabled": false}'
```
- Student refreshes page
- Expected banner: *"Pupil size monitoring and eye tracking are active for this course."*
- Red recording dot is NOT visible

**Test C — Only Recording enabled:**
```bash
curl -X PATCH {API_BASE}/pupil-size/config/{COURSE_ID} \
  -H "Authorization: Bearer {TEACHER_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"isEnabled": false}'

curl -X PATCH {API_BASE}/webgazer/config/{COURSE_ID} \
  -H "Authorization: Bearer {TEACHER_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"isEnabled": false}'

curl -X PATCH {API_BASE}/recording/config/{COURSE_ID} \
  -H "Authorization: Bearer {TEACHER_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"isEnabled": true}'
```
- Student refreshes
- Expected banner: mentions recording only
- No gaze/pupil indicators visible

| Banner State | Result |
|-------------|--------|
| All four active | |
| Pupil + WebGazer only | |
| Recording only | |

**Overall CI-4 result:** PASS / FAIL
**Notes:**

---

## CI-5: Disabling All Features Produces a Clean State

**Steps:**
1. Disable all four features:
```bash
for feature in recording pupil-size webgazer pyfeat; do
  curl -X PATCH {API_BASE}/$feature/config/{COURSE_ID} \
    -H "Authorization: Bearer {TEACHER_JWT}" \
    -H "Content-Type: application/json" \
    -d '{"isEnabled": false}'
done
```

2. Student refreshes the page

**Expected — all indicators gone:**
- `BiometricsActiveBanner` is NOT rendered (no mention of any tracking)
- Red recording dot is NOT visible
- WebgazerStatusBadge is NOT visible
- In dev mode: `PupilSizeOverlay` shows status `disabled`

**Expected — no tracking requests fire:**
- Open DevTools → Network tab
- Stay on the page for 60 seconds
- Confirm: zero requests to `/pupil-size/logs`, `/webgazer/logs`, `/recording/segments/`
- Config endpoint `GET` calls may still fire (that is expected)

**Expected — no webcam prompt:**
- If no other feature requires the camera, no browser permission prompt appears

**Result:** PASS / FAIL
**Notes:**

---

## P-1: Main Thread Performance — No Long Tasks

**Setup:** Re-enable Pupil Size + WebGazer only (these are the CPU-intensive client-side features). Navigate to the DialogueLearning page as student.

**Steps:**
1. Open DevTools → **Performance** tab
2. Click **Record**
3. Stay on the page for **30 seconds**, moving your eyes and mouse naturally
4. Click **Stop**
5. Examine the **Main thread** flame chart

**Expected:**
- No **red "long task" markers** caused by pupil or gaze processing (> 50 ms)
- Each canvas processing invocation completes in < 16 ms (one frame budget at 60 FPS)
- If `OffscreenCanvas` is used, pupil processing appears in a **Worker** thread row, not the Main thread row
- Overall **frame rate stays ≥ 30 FPS** (check the FPS counter in the top of the Performance recording)

**Record your measurements:**
- Longest task duration found: _______ ms
- Average frame rate: _______ FPS
- Canvas processing in Worker thread: Yes / No

**Result:** PASS / FAIL
**Notes:**

---

## P-2: Memory Stability Over 10 Minutes

**Setup:** All four client-side features enabled. Student on DialogueLearning page.

**Steps:**
1. Open DevTools → **Memory** tab
2. Click **Take heap snapshot** → label it `start`
3. Record the heap size: _______ MB
4. Stay on the page for **10 minutes** with normal interaction
5. Click **Take heap snapshot** again → label it `end`
6. Record the heap size: _______ MB

**Expected:**
- Heap growth between snapshots: **< 20 MB**
- No detached DOM nodes visible in the `end` snapshot
- Run a snapshot comparison: click "Comparison" in the dropdown
  - No large arrays (e.g., the `chunks` buffer in `useWebcamRecording`) appearing as "Added" without corresponding "Deleted" entries
  - No growing `WebgazerLog` or `PupilSizeLog` in-memory arrays (buffers should flush and clear)

**Record your measurements:**
- Start heap: _______ MB
- End heap: _______ MB
- Heap growth: _______ MB

**Result:** PASS / FAIL
**Notes:**

---

## P-3: py-feat Worker Handles Concurrent Jobs

**Setup:** py-feat worker running with `WORKER_CONCURRENCY=2` (or default 2).

**Steps:**
1. Get the MinIO key of a real `.webm` file from Stage 1 or CI-1:
   ```bash
   mc ls local/ats-data/recordings/{COURSE_ID}/{STUDENT_ID}/
   ```
   Copy a `.webm` key — e.g., `recordings/{COURSE_ID}/{STUDENT_ID}/{SESSION_ID}/usr_abc_sess_xyz_2024-11-15_143022-000_0.webm`

2. Push 3 test jobs to the Redis queue simultaneously:
```bash
for i in 1 2 3; do
  redis-cli rpush pyfeat:jobs "{
    \"jobId\": \"load-test-$i\",
    \"studentId\": \"{STUDENT_ID}\",
    \"sessionId\": \"{SESSION_ID}\",
    \"courseId\": \"{COURSE_ID}\",
    \"sourceMinioKey\": \"recordings/{COURSE_ID}/{STUDENT_ID}/{SESSION_ID}/ACTUAL_FILENAME.webm\",
    \"extractionFps\": 0.5,
    \"enabledAus\": [\"AU06\",\"AU12\"],
    \"detectorBackend\": \"retinaface\",
    \"auPredictor\": \"xgb\",
    \"clipStartWallTime\": \"2024-11-15T14:30:00.000Z\"
  }"
done
```
(Replace `ACTUAL_FILENAME` with the real filename from step 1)

3. Watch worker logs:
```bash
docker-compose logs -f pyfeat-worker
```

**Expected:**
- 2 jobs start processing simultaneously (two `[INFO] Job received` lines in quick succession)
- 3rd job starts only after one of the first two completes
- All 3 jobs complete with `status = 'COMPLETED'`
- Worker does NOT crash or produce OOM errors

**DB verification:**
```sql
SELECT id, status, "startedAt", "completedAt"
FROM "PyfeatJob"
WHERE id IN ('load-test-1', 'load-test-2', 'load-test-3')
ORDER BY "startedAt";
```
Expected: 3 rows, all `status = 'COMPLETED'`

Check concurrent start times — jobs 1 and 2 should have overlapping time windows, job 3 should start after one of the first two finishes.

**Worker memory check:**
```bash
docker stats pyfeat-worker --no-stream
```
Expected: Memory usage is **below 4 GB** (the Docker limit)

**Clean up test jobs:**
```sql
DELETE FROM "PyfeatAuResult" WHERE "jobId" IN ('load-test-1', 'load-test-2', 'load-test-3');
DELETE FROM "PyfeatJob" WHERE id IN ('load-test-1', 'load-test-2', 'load-test-3');
```

**Result:** PASS / FAIL
**Notes:**

---

## Cleanup — Reset Test Environment

Run these commands after all tests are complete to restore a clean state for future test runs.

### SQL Cleanup (run in dev environment ONLY)

```sql
-- Delete in dependency order
DELETE FROM "PyfeatAuResult";
DELETE FROM "PyfeatJob";
DELETE FROM "WebgazerCalibrationEvent";
DELETE FROM "WebgazerLog";
DELETE FROM "PupilSizeLog";
DELETE FROM "RecordingSegment";

-- Delete configs (recreated fresh next time)
DELETE FROM "PupilSizeConfig"  WHERE "courseId" = '{COURSE_ID}';
DELETE FROM "WebgazerConfig"   WHERE "courseId" = '{COURSE_ID}';
DELETE FROM "PyfeatConfig"     WHERE "courseId" = '{COURSE_ID}';
DELETE FROM "RecordingConfig"  WHERE "courseId" = '{COURSE_ID}';

-- Optional: remove test activity log entries
DELETE FROM "ActivityLog"
WHERE action IN (
  'RECORDING_STARTED','RECORDING_STOPPED','RECORDING_SEGMENT_UPLOADED','RECORDING_UPLOAD_FAILED','RECORDING_RESUMED',
  'PUPIL_SIZE_TRACKING_STARTED','PUPIL_SIZE_TRACKING_STOPPED','PUPIL_SIZE_BATCH_SUBMITTED',
  'WEBGAZER_TRACKING_STARTED','WEBGAZER_TRACKING_STOPPED','WEBGAZER_CALIBRATION_STARTED',
  'WEBGAZER_CALIBRATION_COMPLETED','WEBGAZER_CALIBRATION_SKIPPED','WEBGAZER_BATCH_SUBMITTED',
  'WEBGAZER_RECALIBRATION_PROMPTED',
  'PYFEAT_JOB_ENQUEUED','PYFEAT_JOB_COMPLETED','PYFEAT_JOB_FAILED'
);
```

### MinIO Cleanup

```bash
mc rm --recursive --force local/ats-data/pupil-size/
mc rm --recursive --force local/ats-data/webgazer/
mc rm --recursive --force local/ats-data/pyfeat/
mc rm --recursive --force local/ats-data/recordings/
```

### Redis Cleanup

```bash
redis-cli del pyfeat:jobs
```

### Browser Cleanup

- Clear camera permissions: Chrome Settings → Privacy → Camera → Remove `localhost:5173`
- Clear `localStorage` for `localhost:5173`: DevTools → Application → Local Storage → Clear All
- Reset WebGL flags if changed during T02-10: `chrome://flags/#disable-webgl` → Default

---

## Stage 5 Summary

| Test | Description | Result | Notes |
|------|-------------|--------|-------|
| CI-1 | All four streams active 5 min | | |
| CI-2 | Timestamp alignment < 5s | | |
| CI-3 | py-feat auto-triggered post-session | | |
| CI-4 | Banner reflects active features | | |
| CI-5 | All disabled → clean state | | |
| P-1 | No long tasks > 50ms | | |
| P-2 | Memory stable over 10 min | | |
| P-3 | Worker handles 3 concurrent jobs | | |

---

## Full Test Run Summary

| Stage | Feature | Pass | Fail | Blocked |
|-------|---------|------|------|---------|
| Stage 0 | Environment Setup (10 checks) | | | |
| Stage 1 | Webcam Recording (8 tests) | | | |
| Stage 2 | Pupil Size Estimation (10 tests) | | | |
| Stage 3 | WebGazer Eye Tracking (10 tests) | | | |
| Stage 4 | py-feat AU Extraction (8 tests) | | | |
| Stage 5 | Integration + Performance (8 tests) | | | |
| **TOTAL** | **54 checks** | | | |

**Recommended pass threshold before production deployment: 48/54 (no CI or P tests failing)**
