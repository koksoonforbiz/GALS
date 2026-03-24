# TEST STAGE 2 — SET Pupil Size Estimation (Feature 01)

## Your Role

You are a test assistant for the **Adaptive Tutoring System (ATS)**. This stage tests **Feature 01: SET Pupil Size Estimation** end-to-end. Work through every test in order. Report each result as **PASS**, **FAIL**, or **BLOCKED** with a one-line reason.

---

## Values From Previous Stages

```
COURSE_ID   = _______________
STUDENT_ID  = _______________
SESSION_ID  = _______________   (from Stage 1 — or start a new session)
TEACHER_JWT = _______________
STUDENT_JWT = _______________
API_BASE    = http://localhost:3000
WEB_BASE    = http://localhost:5173
```

---

## Context: What This Feature Does

- Client-side canvas processes each webcam frame to detect and measure pupil diameter
- Readings are captured at **~2 Hz** (every 500 ms)
- Readings are buffered locally and flushed to `POST /pupil-size/logs` every **30 seconds**
- On page unload, `navigator.sendBeacon` flushes any remaining buffer
- CSV export per session is stored in MinIO at `pupil-size/{studentId}/{sessionId}/pupil_size.csv`
- Teacher controls enable/disable per course and views a log chart in the Student Log page

---

## T01-1: Teacher Enables Pupil Size Tracking

**Steps:**
1. Log in as teacher → navigate to `{WEB_BASE}/teacher/courses/{COURSE_ID}` → **Biometrics** tab
2. Find **Pupil Size Settings** panel
3. Toggle **Enable Pupil Size Tracking** → ON
4. Click Save

**API verification:**
```bash
curl -X GET {API_BASE}/pupil-size/config/{COURSE_ID} \
  -H "Authorization: Bearer {TEACHER_JWT}"
```
Expected: `{ "isEnabled": true }`

**DB verification:**
```sql
SELECT "isEnabled", "updatedAt"
FROM "PupilSizeConfig"
WHERE "courseId" = '{COURSE_ID}';
```
Expected: `isEnabled = true`

**Result:** PASS / FAIL
**Notes:**

---

## T01-2: Webcam Permission Is Requested and Banner Is Shown

**Setup:** Log in as student. Recording (Feature 04) may also be active — that is fine.

**Steps:**
1. Navigate to `{WEB_BASE}/student/courses/{COURSE_ID}` (or DialogueLearning page)
2. If webcam permission has not been granted yet, a browser prompt appears
3. Grant permission

**Expected:**
- Browser webcam permission dialog fires (if not already granted from Stage 1)
- `BiometricsActiveBanner` is visible on the page, mentioning pupil size monitoring
  - Example text: *"Pupil size monitoring is active for this course."*

**API verification (config fetched by hook on mount):**
- Network tab: `GET /pupil-size/config/{COURSE_ID}` → 200 with `{ isEnabled: true }`

**Result:** PASS / FAIL
**Notes:**

---

## T01-3: Pupil Diameter Is Captured at ~2 Hz

**Setup:** Student is on a tracked page with webcam active and pupil size enabled. `NODE_ENV=development`.

**Steps:**
1. Open DevTools → Console
2. Temporarily add this line to `usePupilSize.ts` (or confirm it already logs in dev mode):
   ```typescript
   console.log('[PupilSize]', new Date().toISOString(), 'diameter:', reading.pupilDiameter);
   ```
3. Sit facing the webcam under normal indoor lighting
4. Watch the console for **30 seconds**

**Expected:**
- Approximately 60 log entries over 30 seconds (~2 per second)
- Each entry has a `pupilDiameter` value that is a **positive float**
- Expected range at 640×480 resolution: **20 – 80 px**
- Consecutive readings vary by less than 30% under stable lighting (no wild oscillation)

**If the `PupilSizeOverlay` debug badge is implemented:**
- Badge is visible in the bottom-right corner in dev mode
- Diameter value updates approximately every 500 ms
- Status field reads `active`

**Result:** PASS / FAIL
**Notes:**

---

## T01-4: 30-Second Buffer Flush to Backend

**Setup:** Student is on a tracked page. Open DevTools → Network tab, filter by `pupil-size/logs`.

**Steps:**
1. Stay on the page for **35 seconds** with webcam active
2. Watch the Network tab

**Expected at ~30-second mark:**
- `POST {API_BASE}/pupil-size/logs` request fires → **201**
- Request body:
  ```json
  {
    "sessionId": "...",
    "courseId": "{COURSE_ID}",
    "readings": [
      { "timestamp": "2024-11-15T14:30:00.000Z", "pupilDiameter": 45.3 },
      ...
    ]
  }
  ```
- `readings` array contains approximately **55–65 entries** (30 seconds × 2 Hz)

**DB verification after flush:**
```sql
SELECT COUNT(*), MIN(timestamp), MAX(timestamp), AVG("pupilDiameter")
FROM "PupilSizeLog"
WHERE "sessionId" = '{SESSION_ID}';
```
Expected: count > 0, AVG diameter in range 20–80

**Result:** PASS / FAIL
**Notes:**

---

## T01-5: sendBeacon Flushes Remaining Buffer on Page Close

**Setup:** Pupil tracking is active. Readings have been accumulating for 10–15 seconds since the last flush.

**Steps:**
1. Note the current `PupilSizeLog` row count:
   ```sql
   SELECT COUNT(*) FROM "PupilSizeLog" WHERE "sessionId" = '{SESSION_ID}';
   ```
   Save this as `COUNT_BEFORE`.
2. **Close the browser tab** (Ctrl+W / Cmd+W) — do NOT use the back button or navigate away
3. Within 5 seconds, run the count query again:
   ```sql
   SELECT COUNT(*) FROM "PupilSizeLog" WHERE "sessionId" = '{SESSION_ID}';
   ```
   Save as `COUNT_AFTER`.

**Expected:**
- `COUNT_AFTER > COUNT_BEFORE`
- The difference represents the readings delivered by `sendBeacon` (typically 20–30 entries for 10–15 seconds of capture at 2 Hz)

**Also check DevTools (before closing):**
- In DevTools → Network, after close you can check the browser history for a beacon request
- Or use `chrome://net-internals/#events` to confirm a beacon fired to `/pupil-size/logs`

**Result:** PASS / FAIL
**Notes:**

---

## T01-6: CSV Export for a Session

**Setup:** At least 30 `PupilSizeLog` rows exist for `{SESSION_ID}` (confirmed in T01-4).

**API verification first:**
```bash
curl -X GET "{API_BASE}/pupil-size/logs/{STUDENT_ID}/{SESSION_ID}/export" \
  -H "Authorization: Bearer {TEACHER_JWT}"
```
Expected: 200 response with a JSON body containing `{ "url": "http://localhost:9000/ats-data/pupil-size/..." }`

**Steps:**
1. Log in as teacher → `{WEB_BASE}/teacher/students/{STUDENT_ID}/logs` → **Biometrics** tab
2. Find the **Pupil Size Log Viewer**
3. Select the session `{SESSION_ID}` from the session dropdown
4. Click **Export CSV**

**Expected:**
- Browser downloads a `.csv` file
- Open the file — verify the header row:
  ```
  studentId,sessionId,courseId,timestamp,pupilDiameter,rawData
  ```
- Row count matches the DB:
  ```sql
  SELECT COUNT(*) FROM "PupilSizeLog" WHERE "sessionId" = '{SESSION_ID}';
  ```
- All `pupilDiameter` values are positive numbers

**MinIO verification:**
```bash
mc ls local/ats-data/pupil-size/{STUDENT_ID}/{SESSION_ID}/
```
Expected: `pupil_size.csv` is listed

**Result:** PASS / FAIL
**Notes:**

---

## T01-7: Pupil Size Chart Renders in Teacher Log Viewer

**Setup:** Log in as teacher, navigate to Student Log page.

**Steps:**
1. `{WEB_BASE}/teacher/students/{STUDENT_ID}/logs` → **Biometrics** tab → Pupil Size Log Viewer
2. Select a date range that includes today
3. Select session `{SESSION_ID}` from the dropdown

**Expected:**
- **Line chart** renders with:
  - X-axis: timestamp values (formatted as HH:mm:ss)
  - Y-axis: pupilDiameter in px
  - Data points visible (not a blank chart)
- **Data table** below chart shows paginated rows: timestamp, diameter, sessionId
- Switching sessions in the dropdown updates the chart

**Result:** PASS / FAIL
**Notes:**

---

## T01-8: Feature Disabled — No Webcam Access Attempted

**Steps:**
1. Teacher toggles Pupil Size Tracking → OFF for the course → Save
2. Student refreshes the page (ensure no other biometric feature requires the camera)

**API verification:**
```bash
curl -X GET {API_BASE}/pupil-size/config/{COURSE_ID} \
  -H "Authorization: Bearer {TEACHER_JWT}"
```
Expected: `{ "isEnabled": false }`

**Expected student UI:**
- No webcam permission prompt fires for pupil size
- `BiometricsActiveBanner` does not mention pupil monitoring
- In dev mode: `PupilSizeOverlay` shows status `disabled`
- Network tab: `GET /pupil-size/config/{COURSE_ID}` returns `{ isEnabled: false }`, no further pupil-related requests

**Result:** PASS / FAIL
**Notes:**

---

## T01-9: Webcam Denied — Graceful Degradation

**Setup:** Re-enable pupil tracking. Clear the browser's camera permission for `localhost:5173` (browser settings → Site Permissions → Camera → Block for this site).

**Steps:**
1. Student navigates to the course page
2. When the webcam permission prompt appears, click **Block** (or the browser auto-blocks if already set)
3. Observe behaviour for 30 seconds

**Expected:**
- No JavaScript error or page crash
- No readings are captured or submitted (Network tab: zero `POST /pupil-size/logs` requests)
- `BiometricsActiveBanner` either hides pupil tracking or shows a warning: *"Pupil tracking unavailable — camera access denied"*
- In dev mode: `PupilSizeOverlay` shows status `error`

**ActivityLog verification:**
```sql
SELECT action, metadata
FROM "ActivityLog"
WHERE "action" = 'PUPIL_SIZE_TRACKING_STOPPED'
ORDER BY "createdAt" DESC
LIMIT 1;
```
Expected: 1 row with `metadata.reason = 'camera_denied'` (or similar)

**Result:** PASS / FAIL
**Notes:**

---

## T01-10: OffscreenCanvas / Worker Thread (Performance Check)

**Setup:** Pupil tracking active in Chrome. Open DevTools → Performance tab.

**Steps:**
1. Click Record in the Performance tab
2. Stay on the page for 15 seconds with pupil tracking active
3. Click Stop

**Expected in the flame chart:**
- Canvas processing tasks appear in a **Worker** thread (not the Main thread), if `OffscreenCanvas` is used
- OR if running on main thread: individual canvas tasks are each **< 16 ms** (no long tasks blocking frame rendering)
- No red "long task" markers (> 50 ms) caused by pupil processing

**Result:** PASS / FAIL
**Notes:**

---

## Stage 2 Summary

| Test | Description | Result | Notes |
|------|-------------|--------|-------|
| T01-1 | Teacher enables tracking | | |
| T01-2 | Webcam permission + banner | | |
| T01-3 | ~2 Hz capture rate | | |
| T01-4 | 30s buffer flush | | |
| T01-5 | sendBeacon on page close | | |
| T01-6 | CSV export per session | | |
| T01-7 | Chart in teacher log viewer | | |
| T01-8 | No webcam when disabled | | |
| T01-9 | Graceful degradation on deny | | |
| T01-10 | No long tasks on main thread | | |

**Overall Stage 2 status:** PASS / FAIL / PARTIAL

Proceed to **TEST_STAGE_3_webgazer.md**.
