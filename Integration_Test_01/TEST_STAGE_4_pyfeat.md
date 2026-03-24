# TEST STAGE 4 — py-feat Action Unit Extraction (Feature 03)

## Your Role

You are a test assistant for the **Adaptive Tutoring System (ATS)**. This stage tests **Feature 03: py-feat Action Unit (AU) Extraction** end-to-end. Work through every test in order. Report each result as **PASS**, **FAIL**, or **BLOCKED** with a one-line reason.

---

## Values From Previous Stages

```
COURSE_ID   = _______________
STUDENT_ID  = _______________
SESSION_ID  = _______________   (session with a COMPLETED recording segment)
SEGMENT_ID  = _______________   (a COMPLETED RecordingSegment from Stage 1)
TEACHER_JWT = _______________
API_BASE    = http://localhost:3000
WEB_BASE    = http://localhost:5173
```

---

## Context: What This Feature Does

- py-feat is an offline, async Python microservice — it does NOT run in real time
- When a `RecordingSegment` upload completes, the NestJS API auto-enqueues a `PyfeatJob` in Redis
- The Python worker (`apps/pyfeat-worker/main.py`) polls the Redis queue, downloads the video from MinIO, extracts frames at the configured FPS, runs py-feat's `Detector` for facial Action Units, and inserts `PyfeatAuResult` rows into PostgreSQL
- Results are also written as a CSV to MinIO
- Teacher configures: enable/disable, FPS, detector backend, AU predictor, enabled AUs
- Teacher views: job list with live status, AU timeline chart, FACS reference table

---

## T03-0: py-feat Worker Health Check

This is the most critical pre-check for this stage. The worker must be running before any job tests.

**Check A — Worker process is running:**
```bash
# If using Docker:
docker-compose ps pyfeat-worker
# Expected: status = 'Up'

# If running directly:
ps aux | grep "python main.py"
```

**Check B — Worker logs show successful startup:**
```bash
docker-compose logs pyfeat-worker | tail -20
```
Expected log lines:
```
py-feat worker started. Polling Redis queue: pyfeat:jobs
Detector loaded: retinaface + xgb
```

**Check C — Worker can reach Redis:**
```bash
docker-compose exec pyfeat-worker python -c "
import redis, os
r = redis.from_url(os.environ['REDIS_URL'])
print('Redis PING:', r.ping())
"
```
Expected: `Redis PING: True`

**Check D — Worker can reach MinIO:**
```bash
docker-compose exec pyfeat-worker python -c "
from minio_client import get_client
client = get_client()
buckets = [b.name for b in client.list_buckets()]
print('Buckets:', buckets)
"
```
Expected: `Buckets: ['ats-data']` (or similar, bucket name present)

**Check E — Worker can reach PostgreSQL:**
```bash
docker-compose exec pyfeat-worker python -c "
from db import get_connection
conn = get_connection()
cur = conn.cursor()
cur.execute('SELECT 1')
print('DB ping:', cur.fetchone())
conn.close()
"
```
Expected: `DB ping: (1,)`

**Check F — py-feat models are loaded:**
```bash
docker-compose exec pyfeat-worker python -c "
from feat import Detector
d = Detector(face_model='retinaface', au_model='xgb')
print('Detector OK:', d)
"
```
Expected: Detector object printed, no import errors

If any check fails, resolve before proceeding — all subsequent T03 tests depend on the worker.

**Result:** PASS / FAIL
**Notes:**

---

## T03-1: Teacher Enables py-feat and Configures Settings

**Steps:**
1. Log in as teacher → `{WEB_BASE}/teacher/courses/{COURSE_ID}` → **Biometrics** tab
2. Find **py-feat Settings** panel
3. Configure:
   - Enable py-feat: **ON**
   - Extraction FPS: **1.0**
   - Detector backend: **retinaface**
   - AU Predictor: **xgb**
   - Enabled AUs: check **AU06, AU07, AU12, AU25, AU26** at minimum
4. Click Save

**API verification:**
```bash
curl -X GET {API_BASE}/pyfeat/config/{COURSE_ID} \
  -H "Authorization: Bearer {TEACHER_JWT}"
```
Expected:
```json
{
  "isEnabled": true,
  "extractionFps": 1.0,
  "detectorBackend": "retinaface",
  "auPredictor": "xgb",
  "enabledAus": ["AU06", "AU07", "AU12", "AU25", "AU26"]
}
```

**DB verification:**
```sql
SELECT "isEnabled", "extractionFps", "detectorBackend", "auPredictor", "enabledAus"
FROM "PyfeatConfig"
WHERE "courseId" = '{COURSE_ID}';
```

**Result:** PASS / FAIL
**Notes:**

---

## T03-2: py-feat Job Auto-Enqueued When a Recording Segment Completes

This test verifies the integration between Feature 04 (recording) and Feature 03 (py-feat).

**Pre-condition:** Both Recording AND py-feat must be enabled for the course. A `COMPLETED` segment must exist — use `{SEGMENT_ID}` from Stage 1. If that segment already triggered a job, do this:

1. Have the student navigate to the course page with recording enabled
2. Wait for a new segment to upload and complete (or manually trigger by setting `MAX_SEGMENT_BYTES` low)

**DB verification — check job was created:**
```sql
SELECT r.id AS segment_id, r."uploadStatus", r."pyfeatJobId", p.status AS job_status
FROM "RecordingSegment" r
LEFT JOIN "PyfeatJob" p ON r."pyfeatJobId" = p.id
WHERE r."studentId" = '{STUDENT_ID}'
ORDER BY r."createdAt" DESC
LIMIT 3;
```
Expected:
- For the most recent COMPLETED segment: `pyfeatJobId` is NOT NULL
- `job_status = 'PENDING'` (immediately after upload) or already `PROCESSING` / `COMPLETED`

**Redis verification (check job was pushed to queue):**
```bash
# Check queue length (may be 0 if worker already consumed it)
redis-cli llen pyfeat:jobs
```

**ActivityLog verification:**
```sql
SELECT action, metadata FROM "ActivityLog"
WHERE "action" = 'PYFEAT_JOB_ENQUEUED'
ORDER BY "createdAt" DESC LIMIT 1;
```
Expected: 1 row with `metadata.jobId` matching the `PyfeatJob.id`

Note the `jobId` — save as `{JOB_ID}`.

**Result:** PASS / FAIL
**Notes:**

---

## T03-3: Worker Processes the Job Successfully

**Setup:** Job `{JOB_ID}` exists with `status = 'PENDING'` or is currently `PROCESSING`.

**Step 1 — Watch worker logs:**
```bash
docker-compose logs -f pyfeat-worker
```

**Expected log sequence:**
```
[INFO] Job received: {JOB_ID}
[INFO] Downloading video from MinIO: recordings/...
[INFO] Extracting frames at 1.0 FPS — N frames total
[INFO] Running py-feat detection on N frames...
[INFO] Inserting N AU result rows into database...
[INFO] Uploading results CSV to MinIO: pyfeat/...
[INFO] Job {JOB_ID} completed in Xs
```

Wait for completion (typically 30 seconds to 5 minutes depending on video length and hardware).

**Step 2 — DB verification:**
```sql
SELECT id, status, "startedAt", "completedAt", "resultMinioKey", error
FROM "PyfeatJob"
WHERE id = '{JOB_ID}';
```
Expected:
- `status = 'COMPLETED'`
- `startedAt` is not NULL
- `completedAt` is not NULL (after `startedAt`)
- `resultMinioKey` is set (e.g., `pyfeat/{STUDENT_ID}/{SESSION_ID}/{JOB_ID}_au_results.csv`)
- `error` is NULL

**Step 3 — AU results verification:**
```sql
SELECT COUNT(*) AS frame_count,
       MIN("frameIndex") AS first_frame,
       MAX("frameIndex") AS last_frame,
       MIN("wallTime") AS first_wall,
       MAX("wallTime") AS last_wall,
       AVG("au12") AS avg_au12,
       AVG("au06") AS avg_au06
FROM "PyfeatAuResult"
WHERE "jobId" = '{JOB_ID}';
```
Expected:
- `frame_count > 0` (at least one frame processed)
- AU values are floats in range 0–5 (xgb predictor) or 0–1 (logistic)
- `first_wall` and `last_wall` are valid timestamps within the session window

**Step 4 — MinIO verification:**
```bash
mc ls local/ats-data/pyfeat/{STUDENT_ID}/{SESSION_ID}/
```
Expected: `{JOB_ID}_au_results.csv` is listed

**Result:** PASS / FAIL
**Notes:**

---

## T03-4: Wall Time Synchronisation in AU Results

This test verifies that AU `wallTime` values are correctly aligned with the recording segment's `startWallTime` and other biometric streams.

```sql
-- Check alignment between AU results and recording segment
SELECT
  rs."startWallTime" AS recording_start,
  MIN(ar."wallTime") AS first_au_wall_time,
  EXTRACT(EPOCH FROM (MIN(ar."wallTime") - rs."startWallTime")) AS offset_seconds
FROM "RecordingSegment" rs
JOIN "PyfeatJob" pj ON pj.id = '{JOB_ID}'
JOIN "PyfeatAuResult" ar ON ar."jobId" = '{JOB_ID}'
WHERE rs.id = '{SEGMENT_ID}'
GROUP BY rs."startWallTime";
```

**Expected:**
- `offset_seconds` is between **-2.0 and +2.0** (AU wall times should start within 2 seconds of the recording start)

**Cross-stream alignment check (if pupil and gaze data exist for the same session):**
```sql
SELECT
  MIN(p.timestamp) AS pupil_stream_start,
  MIN(w.timestamp) AS gaze_stream_start,
  MIN(ar."wallTime") AS au_stream_start,
  rs."startWallTime" AS recording_start
FROM "PupilSizeLog" p
FULL OUTER JOIN "WebgazerLog" w ON w."sessionId" = p."sessionId"
FULL OUTER JOIN "PyfeatAuResult" ar ON ar."jobId" = '{JOB_ID}'
FULL OUTER JOIN "RecordingSegment" rs ON rs."sessionId" = p."sessionId"
WHERE p."sessionId" = '{SESSION_ID}'
GROUP BY rs."startWallTime"
LIMIT 1;
```
**Expected:**
- All four timestamps (`pupil_stream_start`, `gaze_stream_start`, `au_stream_start`, `recording_start`) are within **5 seconds** of each other

**Result:** PASS / FAIL
**Notes:**

---

## T03-5: Failed Job Handling

This test verifies the worker handles errors gracefully without crashing.

**Steps:**
1. Push a malformed job directly to Redis:
```bash
redis-cli rpush pyfeat:jobs '{
  "jobId": "bad-job-test-001",
  "studentId": "nonexistent",
  "sessionId": "nonexistent",
  "courseId": "nonexistent",
  "sourceMinioKey": "recordings/does/not/exist.webm",
  "extractionFps": 1.0,
  "enabledAus": [],
  "detectorBackend": "retinaface",
  "auPredictor": "xgb",
  "clipStartWallTime": "2024-01-01T00:00:00Z"
}'
```

2. Watch worker logs:
```bash
docker-compose logs -f pyfeat-worker
```

**Expected log output:**
```
[INFO] Job received: bad-job-test-001
[ERROR] Job bad-job-test-001 failed: ...error message...
[INFO] Polling for next job...   ← worker continues, does NOT crash
```

**DB verification:**
```sql
SELECT id, status, error
FROM "PyfeatJob"
WHERE id = 'bad-job-test-001';
```
Expected:
- `status = 'FAILED'`
- `error` contains a non-empty error message

**Worker still running after failure:**
```bash
docker-compose ps pyfeat-worker
# Expected: still 'Up'
```

**Clean up:**
```sql
DELETE FROM "PyfeatJob" WHERE id = 'bad-job-test-001';
```

**Result:** PASS / FAIL
**Notes:**

---

## T03-6: Teacher Views AU Timeline in Log Viewer

**Setup:** At least one `COMPLETED` `PyfeatJob` with `PyfeatAuResult` rows exists.

**Steps:**
1. Log in as teacher → `{WEB_BASE}/teacher/students/{STUDENT_ID}/logs` → **Biometrics** tab → py-feat Log Viewer

**Job List Table:**
- Verify columns: Session ID, Created At, Status badge, py-feat Status badge, Actions
- COMPLETED jobs show a green badge
- Table **auto-refreshes** every 10 seconds while any job is PENDING/PROCESSING — verify by temporarily inserting a PENDING job:
  ```sql
  INSERT INTO "PyfeatJob" (id, "studentId", "sessionId", "courseId", "sourceMinioKey", status, "createdAt", "updatedAt")
  VALUES ('refresh-test', '{STUDENT_ID}', '{SESSION_ID}', '{COURSE_ID}', 'test/path.webm', 'PENDING', NOW(), NOW());
  ```
  - Confirm badge shows PENDING and refreshes every 10 seconds
  - Clean up: `DELETE FROM "PyfeatJob" WHERE id = 'refresh-test';`

**AU Timeline Chart (click a COMPLETED job):**
- Select `{JOB_ID}` → AU Timeline renders
- X-axis: wallTime formatted as HH:mm:ss
- Y-axis: AU intensity (0–5 for xgb)
- One coloured line per enabled AU (AU06, AU07, AU12, AU25, AU26)
- Legend shows AU codes with FACS names, e.g.:
  - AU06 — Cheek Raiser
  - AU07 — Lid Tightener
  - AU12 — Lip Corner Puller
  - AU25 — Lips Part
  - AU26 — Jaw Drop

**Export CSV:**
1. Click **Export CSV** on the selected job
2. Browser downloads `{JOB_ID}_au_results.csv`
3. Verify columns:
   ```
   jobId,studentId,sessionId,frameIndex,timestamp,wallTime,AU01,AU02,AU04,...,AU28,faceConf
   ```

**MinIO check:**
```bash
mc ls local/ats-data/pyfeat/{STUDENT_ID}/{SESSION_ID}/
```
Expected: CSV file listed

**Result:** PASS / FAIL
**Notes:**

---

## T03-7: FACS Reference Table Is Visible in UI

**Steps:**
1. In the py-feat AU Timeline viewer, find the FACS reference section
2. Expand/open it if it is collapsed

**Expected — the following entries must be present:**

| AU Code | Expected FACS Description |
|---------|--------------------------|
| AU01 | Inner Brow Raise |
| AU02 | Outer Brow Raise |
| AU04 | Brow Lowerer |
| AU06 | Cheek Raiser |
| AU07 | Lid Tightener |
| AU12 | Lip Corner Puller |
| AU17 | Chin Raiser |
| AU25 | Lips Part |
| AU26 | Jaw Drop |

Verify at least 9 of the above are present in the reference table.

**Result:** PASS / FAIL
**Notes:**

---

## Stage 4 Summary

| Test | Description | Result | Notes |
|------|-------------|--------|-------|
| T03-0 | Worker health check | | |
| T03-1 | Teacher enables + FPS config | | |
| T03-2 | Job auto-enqueued on segment upload | | |
| T03-3 | Worker processes job successfully | | |
| T03-4 | wallTime alignment in AU rows | | |
| T03-5 | Failed job handled without crash | | |
| T03-6 | AU timeline in teacher log viewer | | |
| T03-7 | FACS reference table visible | | |

**Values to carry to Stage 5:**
```
JOB_ID = _______________   (completed PyfeatJob)
```

**Overall Stage 4 status:** PASS / FAIL / PARTIAL

Proceed to **TEST_STAGE_5_integration_and_performance.md**.
