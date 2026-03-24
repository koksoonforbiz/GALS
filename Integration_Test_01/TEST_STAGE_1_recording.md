# TEST STAGE 1 — Webcam Session Recording (Feature 04)

## Your Role

You are a test assistant for the **Adaptive Tutoring System (ATS)**. This stage tests **Feature 04: Webcam Session Recording** end-to-end. Work through every test in order. After each test, report **PASS**, **FAIL**, or **BLOCKED** with a one-line reason and any relevant output (DB rows, network responses, errors).

Do not skip tests. If a test is BLOCKED by a prior failure, note which test blocked it and continue to the next independent test.

---

## Values From Stage 0

Fill these in before starting:
```
COURSE_ID   = _______________
STUDENT_ID  = _______________
TEACHER_JWT = _______________
STUDENT_JWT = _______________
API_BASE    = http://localhost:3000
WEB_BASE    = http://localhost:5173
```

---

## Context: What This Feature Does

- The student's webcam is recorded continuously during a learning session
- Recordings are split into segments on page refresh
- Each segment is uploaded to MinIO using a presigned PUT URL
- Filename format: `{studentId}_{sessionId}_{YYYY-MM-DD}_{HHmmss-SSS}_{segmentIndex}.webm`
- A `RecordingSegment` DB row tracks status: PENDING → UPLOADING → COMPLETED / FAILED
- A `wallClockOffset` is computed at session start and stored in ActivityLog for timestamp synchronisation
- Teacher can enable/disable per course and view a recording inventory in the Student Log page

---

## T04-1: Teacher Enables Recording for the Course

**Setup:** Log in as teacher in the browser.

**Steps:**
1. Navigate to `{WEB_BASE}/teacher/courses/{COURSE_ID}`
2. Click the **Biometrics** tab
3. Find the **Recording Settings** panel
4. Confirm a **privacy warning box** is visible (text about institutional consent obligations)
5. Toggle **Enable Recording** → ON
6. Click Save

**API verification:**
```bash
curl -X GET {API_BASE}/recording/config/{COURSE_ID} \
  -H "Authorization: Bearer {TEACHER_JWT}"
```
Expected response: `{ "isEnabled": true }`

**DB verification:**
```sql
SELECT id, "courseId", "isEnabled", "updatedAt"
FROM "RecordingConfig"
WHERE "courseId" = '{COURSE_ID}';
```
Expected: 1 row, `isEnabled = true`

**Result:** PASS / FAIL
**Notes:**

---

## T04-2: Student Consent Modal Appears on First Session

**Setup:** Log in as student in a separate browser tab (use Incognito to keep teacher session active).

**Steps:**
1. Navigate to `{WEB_BASE}/student/courses/{COURSE_ID}`
2. Observe the page immediately on load — do not click anything

**Expected:**
- A modal appears with text containing "recorded" and buttons: **Accept** and **Decline**
- No webcam permission prompt has appeared yet (consent comes first)

**Decline path (test first):**
1. Click **Decline**
2. Confirm: modal closes, NO red recording dot appears, NO webcam permission prompt fires
3. Refresh the page — modal appears again (consent not stored on decline)

**Accept path:**
1. Reload the page → consent modal appears → click **Accept**
2. Browser webcam permission prompt appears
3. Click **Allow**

**Expected after Allow:**
- Consent modal closes
- Red pulsing dot appears in top-right corner

**DB verification (if a consent record model exists):**
```sql
SELECT * FROM "RecordingConsent"
WHERE "studentId" = '{STUDENT_ID}' AND "courseId" = '{COURSE_ID}';
```
Expected: 1 row with accepted = true

**Result:** PASS / FAIL
**Notes:**

---

## T04-3: Recording Starts — Segment Initiated in DB and API

**Setup:** Student has accepted consent (T04-2) and webcam is active.

**Steps:**
1. Open DevTools → Network tab → filter by `segments/initiate`
2. Navigate to or refresh the course page

**Expected network request:**
- `POST {API_BASE}/recording/segments/initiate` → **201**
- Response body:
  ```json
  {
    "segmentId": "...",
    "uploadUrl": "http://localhost:9000/ats-data/recordings/...",
    "minioKey": "recordings/{COURSE_ID}/{STUDENT_ID}/{SESSION_ID}/..."
  }
  ```

**Expected UI:**
- Red pulsing dot visible in top-right corner
- Hover tooltip: *"Session is being recorded for learning analytics"*

**DB verification:**
```sql
SELECT id, "sessionId", "uploadStatus", "startWallTime", "segmentIndex", "minioKey"
FROM "RecordingSegment"
WHERE "studentId" = '{STUDENT_ID}'
ORDER BY "createdAt" DESC
LIMIT 1;
```
Expected:
- `uploadStatus = 'PENDING'`
- `startWallTime` is within the last 60 seconds
- `segmentIndex = 0`
- `minioKey` matches the path pattern

Note the `segmentId` and `sessionId` from this query — save as `{SEGMENT_ID}` and `{SESSION_ID}`.

**Result:** PASS / FAIL
**Notes:**

---

## T04-4: Segment Uploads to MinIO on Completion

**Setup:** Recording is active (T04-3). Use dev mode with a reduced max segment size to trigger upload without waiting for a full 50 MB.

In `apps/web/src/lib/recording/useWebcamRecording.ts`, temporarily set:
```typescript
const MAX_SEGMENT_BYTES = 500_000; // 500 KB for testing, revert after
```
Or wait 60 seconds and navigate away from the page to trigger the upload.

**Steps:**
1. Stay on the course page until the segment upload triggers
2. Watch DevTools → Network for two requests:
   - A `PUT` to the MinIO presigned URL (binary payload)
   - A `PATCH {API_BASE}/recording/segments/{SEGMENT_ID}/complete`

**Expected network:**
- PUT → **200** (MinIO returns 200 for successful presigned PUT)
- PATCH complete → **200**

**DB verification:**
```sql
SELECT "uploadStatus", "endWallTime", "durationMs", "fileSizeBytes"
FROM "RecordingSegment"
WHERE id = '{SEGMENT_ID}';
```
Expected:
- `uploadStatus = 'COMPLETED'`
- `endWallTime` is set and after `startWallTime`
- `durationMs > 0`
- `fileSizeBytes > 0`

**MinIO verification:**
```bash
mc ls local/ats-data/recordings/{COURSE_ID}/{STUDENT_ID}/
```
Expected: `.webm` file listed

**Filename format check:**
- Pattern must match: `{studentId}_{sessionId}_{YYYY-MM-DD}_{HHmmss-SSS}_0.webm`
- Example: `clx123_sess456_2024-11-15_143022-000_0.webm`

**Result:** PASS / FAIL
**Notes:**

---

## T04-5: Page Refresh Creates a New Segment (segmentIndex = 1)

**Setup:** Recording is active. DevTools open on Network tab.

**Steps:**
1. Confirm the current `segmentIndex = 0` segment's ID
2. Press **F5** (or Cmd+R) to refresh the page
3. Immediately open DevTools → Network → filter by "beacon"

**Expected on unload:**
- A `sendBeacon` POST fires to `{API_BASE}/recording/segments/{SEGMENT_ID}/complete` with payload `{ endWallTime, durationMs, fileSizeBytes }`

**Expected after refresh:**
- New `POST /recording/segments/initiate` request fires
- New `RecordingSegment` row in DB:

```sql
SELECT id, "segmentIndex", "uploadStatus", "startWallTime"
FROM "RecordingSegment"
WHERE "studentId" = '{STUDENT_ID}'
ORDER BY "segmentIndex" ASC;
```
Expected:
- Row with `segmentIndex = 0` has `uploadStatus = 'COMPLETED'` (or FAILED — not stuck at PENDING)
- Row with `segmentIndex = 1` has `uploadStatus = 'PENDING'`

**Filename check for new segment:**
- Must end with `_1.webm`

**Result:** PASS / FAIL
**Notes:**

---

## T04-6: Recording Stops When Teacher Disables Mid-Session

**Setup:** Student session is active with recording running (red dot visible). Teacher is logged in on another tab.

**Steps:**
1. In the teacher tab: navigate to Biometrics tab → Recording Settings → toggle OFF → Save
2. Switch to student tab — do NOT refresh. Wait up to 15 seconds.

**Expected:**
- Red dot disappears from the student page without a page refresh
- No new `POST /recording/segments/initiate` requests fire after the dot disappears

**ActivityLog verification:**
```sql
SELECT action, metadata, "createdAt"
FROM "ActivityLog"
WHERE "action" = 'RECORDING_STOPPED'
ORDER BY "createdAt" DESC
LIMIT 1;
```
Expected: 1 row within the last 30 seconds

**Result:** PASS / FAIL
**Notes:**

---

## T04-7: wallClockOffset Is Stored in ActivityLog

**Setup:** Start a fresh student session with recording enabled (re-enable if disabled in T04-6).

**Steps:**
1. Navigate to the course as student — recording starts
2. Wait for `RECORDING_STARTED` event to be emitted (within 5 seconds)

**DB verification:**
```sql
SELECT action, metadata, "createdAt"
FROM "ActivityLog"
WHERE "action" = 'RECORDING_STARTED'
  AND "sessionId" = '{SESSION_ID}'
ORDER BY "createdAt" DESC
LIMIT 1;
```

**Expected `metadata` JSON:**
```json
{
  "segmentId": "clx...",
  "startWallTime": "2024-11-15T14:30:22.000Z",
  "wallClockOffset": 1234
}
```
- `wallClockOffset` must be a **positive integer less than 15000** (milliseconds)
- `startWallTime` must be a valid ISO8601 UTC timestamp

**Result:** PASS / FAIL
**Notes:**

---

## T04-8: Teacher Views Recording Inventory in StudentLogPage

**Setup:** At least one `COMPLETED` recording segment exists for `{STUDENT_ID}` (from T04-4).

**Steps:**
1. Log in as teacher → navigate to `{WEB_BASE}/teacher/students/{STUDENT_ID}/logs`
2. Click the **Biometrics** tab

**Expected UI:**
- **Recording Log Viewer** section is present
- Table shows at least 1 row with columns:
  - Segment File (filename)
  - Session ID
  - Date
  - Start Time
  - Duration (human-readable, e.g., "1m 12s")
  - Size (e.g., "2.4 MB")
  - Status badge: **COMPLETED** (green)
  - py-feat Status badge
  - **Download** button

**Download test:**
1. Click the **Download** button on a COMPLETED row
2. Browser downloads a `.webm` file

**Playback test:**
- Open the downloaded `.webm` in Chrome or VLC
- Confirm: video plays, webcam footage is visible, there is no audio track

**Result:** PASS / FAIL
**Notes:**

---

## Stage 1 Summary

| Test | Description | Result | Notes |
|------|-------------|--------|-------|
| T04-1 | Teacher enables recording | | |
| T04-2 | Student consent modal | | |
| T04-3 | Segment initiated in DB | | |
| T04-4 | Segment uploads to MinIO | | |
| T04-5 | Page refresh → segmentIndex = 1 | | |
| T04-6 | Stops gracefully on disable | | |
| T04-7 | wallClockOffset in ActivityLog | | |
| T04-8 | Teacher views recording inventory | | |

**Values to carry to Stage 2:**
```
SESSION_ID  = _______________   (from T04-3)
SEGMENT_ID  = _______________   (from T04-3)
```

**Overall Stage 1 status:** PASS / FAIL / PARTIAL

Proceed to **TEST_STAGE_2_pupil_size.md** once all tests are marked.
