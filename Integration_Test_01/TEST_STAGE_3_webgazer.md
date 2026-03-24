# TEST STAGE 3 — WebGazer Eye Tracking & Calibration (Feature 02)

## Your Role

You are a test assistant for the **Adaptive Tutoring System (ATS)**. This stage tests **Feature 02: WebGazer Eye Tracking with Calibration** end-to-end. Work through every test in order. Report each result as **PASS**, **FAIL**, or **BLOCKED** with a one-line reason.

---

## Values From Previous Stages

```
COURSE_ID   = _______________
STUDENT_ID  = _______________
SESSION_ID  = _______________
TEACHER_JWT = _______________
STUDENT_JWT = _______________
API_BASE    = http://localhost:3000
WEB_BASE    = http://localhost:5173
```

---

## Context: What This Feature Does

- WebGazer.js tracks real-time gaze (X, Y screen coordinates) via the student's webcam
- A **9-point calibration** sequence runs at new session start and after inactivity timeout
- Gaze data is captured at **~5 Hz**, buffered, and flushed to `POST /webgazer/logs` every 30 seconds
- `sendBeacon` flushes remaining buffer on page unload
- Teacher configures: enable/disable, calibrate-on-new-session, inactivity timeout
- Teacher views: gaze timeline chart, heatmap, calibration history in Student Log page
- **Chrome or Edge required** — WebGazer does not work in Firefox

---

## Pre-Check: Confirm Browser

Verify the student browser is **Chrome** or **Edge**. Run:
```javascript
// In DevTools Console:
console.log(navigator.userAgent);
```
If "Firefox" appears, switch to Chrome before proceeding. WebGazer requires WebGL which may not work in Firefox.

---

## T02-1: Teacher Enables WebGazer and Configures Settings

**Steps:**
1. Log in as teacher → `{WEB_BASE}/teacher/courses/{COURSE_ID}` → **Biometrics** tab
2. Find **WebGazer Settings** panel
3. Configure:
   - Enable WebGazer: **ON**
   - Calibrate on new session: **ON**
   - Enable recalibration on inactivity: **ON**
   - Inactivity Timeout: **60 seconds** (short value for testing — change back to 1800 after tests)
4. Click Save

**API verification:**
```bash
curl -X GET {API_BASE}/webgazer/config/{COURSE_ID} \
  -H "Authorization: Bearer {TEACHER_JWT}"
```
Expected response:
```json
{
  "isEnabled": true,
  "calibrationOnNewSession": true,
  "recalibrationEnabled": true,
  "inactivityTimeoutSecs": 60
}
```

**DB verification:**
```sql
SELECT "isEnabled", "calibrationOnNewSession", "recalibrationEnabled", "inactivityTimeoutSecs"
FROM "WebgazerConfig"
WHERE "courseId" = '{COURSE_ID}';
```

**Result:** PASS / FAIL
**Notes:**

---

## T02-2: Calibration Modal Appears on New Session

**Setup:** Log in as student (use a new session — log out and log back in to force a new `sessionId`).

**Steps:**
1. Navigate to `{WEB_BASE}/student/courses/{COURSE_ID}` or the DialogueLearning page
2. Observe immediately on load — do not click anything

**Expected:**
- Full-screen `CalibrationModal` appears **before** any course content is shown
- Instruction text present: *"Please look at each dot and click it when your gaze is on it."* (or similar)
- Modal is **not dismissible** by clicking outside or pressing Escape
- Two options visible: a way to proceed with calibration and a **Skip** button

**Result:** PASS / FAIL
**Notes:**

---

## T02-3: Complete the 9-Point Calibration Sequence

**Setup:** Calibration modal is open (from T02-2). Sit 50–70 cm from the screen.

**Steps:**
1. Look at each dot as it appears and click it
2. Repeat for all 9 points (corners, edge midpoints, center)
3. After all 9 points: an **accuracy test** dot appears in a random position
4. Note the accuracy score displayed (mean gaze error in pixels)

**Expected flow:**
- Each dot click advances to the next point smoothly
- After 9 clicks: accuracy result is shown
- If accuracy **≤ 80 px**: calibration completes automatically, modal closes
- If accuracy **> 80 px**: option to **Redo** or **Continue anyway** is offered

**Complete calibration** and confirm the modal closes.

**API verification (fired after completion):**
- Network tab: `POST {API_BASE}/webgazer/calibration` → **201**
- Request body:
  ```json
  {
    "sessionId": "...",
    "courseId": "{COURSE_ID}",
    "triggeredBy": "new_session",
    "completedAt": "2024-11-15T14:30:22.000Z",
    "accuracy": 42.1
  }
  ```

**DB verification:**
```sql
SELECT "triggeredBy", "completedAt", "accuracy", "createdAt"
FROM "WebgazerCalibrationEvent"
WHERE "studentId" = '{STUDENT_ID}'
ORDER BY "createdAt" DESC
LIMIT 1;
```
Expected:
- `triggeredBy = 'new_session'`
- `completedAt` is not NULL
- `accuracy` is a positive number

Note the new `sessionId` — save as `{WG_SESSION_ID}`.

**ActivityLog verification:**
```sql
SELECT action FROM "ActivityLog"
WHERE "action" IN ('WEBGAZER_CALIBRATION_STARTED', 'WEBGAZER_CALIBRATION_COMPLETED')
ORDER BY "createdAt" DESC LIMIT 2;
```

**Result:** PASS / FAIL
**Notes:**

---

## T02-4: Gaze Data Is Captured at ~5 Hz After Calibration

**Setup:** Calibration is complete. `NODE_ENV=development`.

**Steps:**
1. Open DevTools → Console
2. Temporarily add this log to `useWebgazer.ts` (or confirm dev mode already logs):
   ```typescript
   console.log('[WebGazer]', Date.now(), 'gaze:', data.x, data.y);
   ```
3. Move your eyes around the screen for **20 seconds**

**Expected:**
- Approximately 5 console entries per second (~100 total over 20 seconds)
- `gazeX` values are within `0` to `window.innerWidth` (e.g., 0–1920)
- `gazeY` values are within `0` to `window.innerHeight` (e.g., 0–1080)
- `pageUrl` matches current path

**Also verify the `WebgazerStatusBadge`:**
- Badge in bottom-left corner shows a **green dot** (tracking active)

**Result:** PASS / FAIL
**Notes:**

---

## T02-5: 30-Second Buffer Flush to Backend

**Setup:** Gaze tracking is active post-calibration. DevTools Network tab open, filter by `webgazer/logs`.

**Steps:**
1. Stay on the page for **35 seconds**, actively looking around the screen
2. Watch the Network tab

**Expected at ~30-second mark:**
- `POST {API_BASE}/webgazer/logs` → **201**
- Request body:
  ```json
  {
    "sessionId": "...",
    "courseId": "{COURSE_ID}",
    "readings": [
      { "timestamp": "...", "gazeX": 640.2, "gazeY": 400.1, "confidence": 0.87, "pageUrl": "/student/..." },
      ...
    ]
  }
  ```
- `readings` array has approximately **140–160 entries** (30 seconds × 5 Hz)

**DB verification:**
```sql
SELECT COUNT(*), AVG("gazeX"), AVG("gazeY"), MIN(timestamp), MAX(timestamp)
FROM "WebgazerLog"
WHERE "sessionId" = '{WG_SESSION_ID}';
```
Expected: count > 0, avg values within screen bounds

**Result:** PASS / FAIL
**Notes:**

---

## T02-6: Inactivity Triggers Recalibration

**Setup:** Gaze tracking is active. Inactivity timeout is set to **60 seconds** (from T02-1).

**Steps:**
1. Stop all mouse movement, keyboard input, and scrolling
2. Keep the page in the foreground (do not switch tabs)
3. Wait **65 seconds** without any interaction

**Expected at ~60-second mark:**
- `CalibrationModal` reappears automatically
- `triggeredBy` in the new calibration event = `'inactivity'`

**ActivityLog verification:**
```sql
SELECT action, metadata, "createdAt"
FROM "ActivityLog"
WHERE "action" = 'WEBGAZER_RECALIBRATION_PROMPTED'
ORDER BY "createdAt" DESC LIMIT 1;
```
Expected: 1 row within the last 90 seconds

**After confirming:** Complete or skip the recalibration, then reset inactivity timeout to `1800` in teacher settings.

**Result:** PASS / FAIL
**Notes:**

---

## T02-7: Skip Calibration Is Logged Correctly

**Setup:** Trigger a fresh calibration modal (log out and back in, or wait for inactivity modal).

**Steps:**
1. When the `CalibrationModal` appears, click **Skip**
2. Confirm the modal closes and gaze tracking continues (or starts without calibration data)

**DB verification:**
```sql
SELECT "triggeredBy", "completedAt", "accuracy"
FROM "WebgazerCalibrationEvent"
WHERE "studentId" = '{STUDENT_ID}'
ORDER BY "createdAt" DESC LIMIT 1;
```
Expected:
- `completedAt` is **NULL** (calibration was not completed)
- `accuracy` is **NULL**

**ActivityLog verification:**
```sql
SELECT action FROM "ActivityLog"
WHERE "action" = 'WEBGAZER_CALIBRATION_SKIPPED'
ORDER BY "createdAt" DESC LIMIT 1;
```
Expected: 1 row

**Result:** PASS / FAIL
**Notes:**

---

## T02-8: WebgazerStatusBadge Reflects All States

Verify each badge state by inducing the corresponding condition:

| State | How to induce | Expected badge |
|-------|---------------|----------------|
| Calibrating | Open calibration modal (new session) | Yellow dot |
| Active / Tracking | After calibration completes | Green dot |
| Error / Denied | Block camera in browser settings, refresh | Red dot |
| Disabled | Teacher disables WebGazer, student refreshes | Badge hidden |

For the **Error** state: go to Chrome Settings → Privacy → Camera → Block `localhost:5173`, then refresh.
For the **Disabled** state: teacher sets `isEnabled = false` and student refreshes without granting new camera access.

**Check each state and record result:**

| State | Result |
|-------|--------|
| Calibrating (yellow) | |
| Active (green) | |
| Error (red) | |
| Disabled (hidden) | |

**Overall T02-8 result:** PASS / FAIL
**Notes:**

---

## T02-9: Teacher Views Gaze Chart and Calibration History

**Setup:** At least one completed session of gaze data and at least one calibration event exist.

**Steps:**
1. Log in as teacher → `{WEB_BASE}/teacher/students/{STUDENT_ID}/logs` → **Biometrics** tab → WebGazer Log Viewer

**Gaze Timeline Chart:**
- Session selector dropdown lists available sessions
- Select `{WG_SESSION_ID}`
- Chart renders with:
  - X-axis: timestamp (HH:mm:ss)
  - Blue line: `gazeX` over time
  - Orange line: `gazeY` over time
  - Confidence area fill (translucent, if confidence data is available)

**Gaze Heatmap:**
- Canvas renders a colour-density heatmap of gaze positions
- Brighter/hotter areas where the student looked more frequently
- Heatmap is sized 1920×1080 normalised to the container

**Calibration History Table:**
- Columns: Date, Session ID, Triggered By, Accuracy (px), Completed (✓/✗)
- Rows are sorted newest first
- Both completed and skipped calibrations appear

**Export:**
1. Click **Export CSV** for the selected session
2. Browser downloads a `.csv` file
3. Verify columns:
   ```
   studentId,sessionId,courseId,timestamp,gazeX,gazeY,confidence,pageUrl
   ```

**MinIO verification:**
```bash
mc ls local/ats-data/webgazer/{STUDENT_ID}/{WG_SESSION_ID}/
```
Expected: `gaze.csv` listed

**Result:** PASS / FAIL
**Notes:**

---

## T02-10: Browser Incompatibility Warning

**Setup:** WebGazer requires Chrome/Edge with WebGL. Test the warning in an incompatible environment.

**Option A — Disable WebGL in Chrome:**
1. Navigate to `chrome://flags/#disable-webgl`
2. Set to **Disabled**
3. Relaunch Chrome
4. Navigate to the student course page

**Option B — Open in Firefox** (if available for testing)

**Expected:**
- Instead of the calibration modal, an **unsupported-browser notice** appears
- WebGazer does not attempt to load (no webcam prompt specific to WebGazer)
- No JavaScript crash or blank page

**Re-enable WebGL after this test:**
1. Navigate back to `chrome://flags/#disable-webgl` and set to **Default**
2. Relaunch Chrome

**Result:** PASS / FAIL
**Notes:**

---

## Stage 3 Summary

| Test | Description | Result | Notes |
|------|-------------|--------|-------|
| T02-1 | Teacher enables + config saved | | |
| T02-2 | Calibration modal on new session | | |
| T02-3 | 9-point calibration + accuracy | | |
| T02-4 | ~5 Hz gaze capture | | |
| T02-5 | 30s buffer flush | | |
| T02-6 | Inactivity triggers recalibration | | |
| T02-7 | Skip calibration logged | | |
| T02-8 | Status badge states | | |
| T02-9 | Teacher gaze chart + cal history | | |
| T02-10 | Browser incompatibility warning | | |

**Values to carry to Stage 4:**
```
WG_SESSION_ID = _______________   (session with gaze data)
```

**Overall Stage 3 status:** PASS / FAIL / PARTIAL

Proceed to **TEST_STAGE_4_pyfeat.md**.
