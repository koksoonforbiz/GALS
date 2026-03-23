# Feature Prompt 02 — WebGazer Eye Tracking with Calibration

## Context

You are extending the **Adaptive Tutoring System (ATS)** monorepo. Stack and existing modules are as described in the project architecture. The platform tracks student activity via `StudentSession` → `ActivityLog` → `SessionSummary`. Students access learning content through the Student Portal; teachers configure the platform via the Teacher Portal.

Reference repository for WebGazer: https://github.com/kianyu/WebGazer  
Upstream WebGazer documentation: https://webgazer.cs.brown.edu/

---

## Feature Overview

Integrate **WebGazer.js** to capture real-time gaze coordinates (X, Y) on the student's screen during learning sessions. Key requirements:
- Calibration runs at **new session start** and after a **configurable inactivity timeout**
- Gaze data is logged per student per session with synchronised timestamps
- Teacher Portal exposes settings (enable/disable, calibration timeout) and a log viewer
- All settings are configurable per course

---

## Stage 1 — Database Schema (Prisma)

Add to `apps/api/prisma/schema.prisma`:

```prisma
model WebgazerConfig {
  id                    String   @id @default(cuid())
  courseId              String   @unique
  course                Course   @relation(fields: [courseId], references: [id], onDelete: Cascade)
  isEnabled             Boolean  @default(false)
  calibrationOnNewSession Boolean @default(true)
  inactivityTimeoutSecs Int      @default(1800)  // 30 minutes default
  recalibrationEnabled  Boolean  @default(true)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
}

model WebgazerLog {
  id          String   @id @default(cuid())
  studentId   String
  student     User     @relation(fields: [studentId], references: [id], onDelete: Cascade)
  sessionId   String
  session     StudentSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  courseId    String
  course      Course   @relation(fields: [courseId], references: [id], onDelete: Cascade)
  timestamp   DateTime
  gazeX       Float    // screen X coordinate (px)
  gazeY       Float    // screen Y coordinate (px)
  confidence  Float?   // WebGazer prediction confidence (0–1)
  pageUrl     String?  // current page URL at time of capture
  createdAt   DateTime @default(now())
}

model WebgazerCalibrationEvent {
  id          String   @id @default(cuid())
  studentId   String
  student     User     @relation(fields: [studentId], references: [id], onDelete: Cascade)
  sessionId   String
  session     StudentSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  courseId    String
  triggeredBy String   // 'new_session' | 'inactivity' | 'manual'
  completedAt DateTime?
  accuracy    Float?   // mean gaze error in px after calibration
  createdAt   DateTime @default(now())
}
```

- Run `pnpm prisma migrate dev --name add_webgazer_tracking`
- Add back-relations on `User`, `StudentSession`, `Course`.

---

## Stage 2 — Backend: NestJS Module (`apps/api/src/webgazer/`)

```
apps/api/src/webgazer/
  webgazer.module.ts
  webgazer.controller.ts
  webgazer.service.ts
  dto/
    webgazer-config.dto.ts
    create-gaze-log.dto.ts
    calibration-event.dto.ts
```

### `webgazer.service.ts` — Methods

```typescript
getConfig(courseId: string): Promise<WebgazerConfig>
updateConfig(courseId: string, dto: WebgazerConfigDto): Promise<WebgazerConfig>

// Batch insert gaze readings from student
bulkCreateLogs(studentId: string, sessionId: string, courseId: string, readings: CreateGazeLogDto[]): Promise<void>

// Record a calibration event start/completion
recordCalibrationEvent(studentId: string, sessionId: string, courseId: string, dto: CalibrationEventDto): Promise<WebgazerCalibrationEvent>

// Teacher: query logs with time range + session filters
getLogs(studentId: string, courseId: string, filters: { sessionId?: string; from?: Date; to?: Date }): Promise<WebgazerLog[]>

// Export full session as CSV (stored in MinIO)
exportSessionCsv(studentId: string, sessionId: string): Promise<string> // returns presigned URL

// Get calibration history for a student
getCalibrationHistory(studentId: string, courseId: string): Promise<WebgazerCalibrationEvent[]>
```

### `webgazer.controller.ts` — REST Endpoints

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/webgazer/config/:courseId` | teacher | Get config |
| PATCH | `/webgazer/config/:courseId` | teacher | Update config |
| POST | `/webgazer/logs` | student | Batch submit gaze data |
| POST | `/webgazer/calibration` | student | Record calibration event |
| GET | `/webgazer/logs/:studentId/:courseId` | teacher | View gaze logs |
| GET | `/webgazer/logs/:studentId/:sessionId/export` | teacher | Export CSV |
| GET | `/webgazer/calibration/:studentId/:courseId` | teacher | Calibration history |

### CSV Export Format

```
studentId,sessionId,courseId,timestamp,gazeX,gazeY,confidence,pageUrl
```

Stored in MinIO at: `webgazer/{studentId}/{sessionId}/gaze.csv`

---

## Stage 3 — Frontend: WebGazer Integration

### Library Setup (`apps/web/`)

Install WebGazer from the reference fork:
```bash
# In apps/web/package.json, add:
"webgazer": "github:kianyu/WebGazer"
```

Or if the fork provides a bundled JS file, place it at `apps/web/public/webgazer.js` and load it dynamically.

Create `apps/web/src/lib/webgazer/`:

#### `useWebgazer.ts` (React hook)

This hook manages the full WebGazer lifecycle:

**Initialisation**
1. On mount, fetch config from `GET /webgazer/config/:courseId`.
2. If `isEnabled = false`, return early (no webcam access).
3. Dynamically import WebGazer: `const webgazer = await import('webgazer')`.
4. Call `webgazer.setRegression('ridge').setTracker('TFFaceMesh').begin()`.
5. Hide the default WebGazer face overlay (`.webgazerVideoFeed`, `.webgazerFaceFeedbackBox`) or configure them via `webgazer.showVideo(false).showFaceOverlay(false).showFaceFeedbackBox(false)`.

**Gaze Listener**
```typescript
webgazer.setGazeListener((data, timestamp) => {
  if (!data) return;
  buffer.current.push({
    timestamp: new Date(timestamp).toISOString(),
    gazeX: data.x,
    gazeY: data.y,
    confidence: data.confidence ?? null,
    pageUrl: window.location.pathname,
  });
});
```
- Capture at **5 Hz** by throttling the listener (only push if 200 ms has elapsed since last push).
- Flush buffer to `POST /webgazer/logs` every **30 seconds** or when buffer size exceeds 300 entries.
- On unmount / `beforeunload`, use `navigator.sendBeacon` to flush remaining data.

**Inactivity Detection**
- Listen to `mousemove`, `keydown`, `scroll`, `click` events to reset an inactivity timer.
- If no event fires within `config.inactivityTimeoutSecs` seconds AND `config.recalibrationEnabled = true`, pause gaze capture and trigger recalibration flow.

**Session Trigger**
- On new session start (`sessionId` changes), if `config.calibrationOnNewSession = true`, immediately trigger calibration.

**Return shape**:
```typescript
{
  isActive: boolean;
  isCalibrating: boolean;
  triggerCalibration: () => void;
  latestGaze: { x: number; y: number } | null;
}
```

#### `CalibrationModal.tsx`

A full-screen overlay modal that runs the calibration sequence. Follows the standard 9-point or 13-point grid calibration protocol.

**Flow**:
1. Display instruction screen: *"Please look at each dot and click it when your gaze is on it."*
2. Show calibration points one at a time (positions: corners, edges, center — configurable).
3. For each point: render a red dot → user clicks → WebGazer records gaze data for that point via `webgazer.clearData()` then point-click training.
4. After all points: run accuracy test (show a dot, capture 50 gaze samples, compute mean error in px).
5. If mean error > 80 px, offer to redo calibration. Otherwise mark calibration complete.
6. On completion: call `POST /webgazer/calibration` with `{ triggeredBy, completedAt, accuracy }`.
7. Dismiss modal and resume gaze capture.

**Props**:
```typescript
interface CalibrationModalProps {
  courseId: string;
  sessionId: string;
  triggeredBy: 'new_session' | 'inactivity' | 'manual';
  onComplete: () => void;
  onSkip: () => void;
}
```

#### `WebgazerStatusBadge.tsx`

A small persistent indicator for the student (bottom-left corner):
- Green dot: active and tracking
- Yellow dot: calibration needed
- Red dot: error / webcam unavailable
- Hidden when feature is disabled

### Integration Points

Mount `useWebgazer` in:
- `apps/web/src/pages/student/dialogue/DialogueLearning.tsx`
- `apps/web/src/pages/student/StudentCourseViewPage.tsx`
- `apps/web/src/pages/student/attempt/AttemptPage.tsx`

Render `<CalibrationModal>` and `<WebgazerStatusBadge>` conditionally based on hook state.

```tsx
const { isCalibrating, triggerCalibration, isActive } = useWebgazer(courseId, sessionId);
```

Wrap the calibration modal render at the layout level (e.g., in `apps/web/src/components/Layout.tsx`) so it persists across page transitions without unmounting WebGazer.

---

## Stage 4 — Teacher Portal Settings

### Settings Component: `WebgazerSettings.tsx`

Location: `apps/web/src/components/teacher/biometrics/WebgazerSettings.tsx`

Mount inside the **Biometrics** tab added in Feature 01 (or create it now if implementing independently).

**Fields**:

| Field | Type | Description |
|-------|------|-------------|
| Enable WebGazer | Toggle | Master on/off per course |
| Calibrate on new session | Toggle | Always calibrate when session starts |
| Enable recalibration on inactivity | Toggle | Trigger recal after inactivity |
| Inactivity timeout | Number input (seconds) | Min: 300, Max: 7200, Default: 1800 |

- On save, call `PATCH /webgazer/config/:courseId`.
- Show current saved values on load.

### Log Viewer: `WebgazerLogViewer.tsx`

Location: `apps/web/src/components/teacher/biometrics/WebgazerLogViewer.tsx`

Mount in `StudentLogPage` under the **Biometrics** tab alongside `PupilSizeLogViewer`.

**Sections**:

1. **Gaze Heatmap** (optional but preferred):
   - Use a canvas-based heatmap (simple density estimation using a 2D grid).
   - Plot all `(gazeX, gazeY)` readings for the selected session as a heatmap overlaid on a blank 1920×1080 canvas (normalised to the container size).
   - Session selector to switch between sessions.

2. **Gaze Timeline Chart** (recharts `LineChart`):
   - X-axis: timestamp
   - Two Y-axes: gazeX (blue) and gazeY (orange)
   - Confidence as a translucent area fill

3. **Calibration History Table**:
   - Columns: Date, Session ID, Triggered By, Accuracy (px), Completed
   - Sorted newest first

4. **Export button**: Calls `GET /webgazer/logs/:studentId/:sessionId/export`

---

## Stage 5 — Shared Zod Schemas (`packages/shared/src/`)

```typescript
// webgazer.schema.ts
export const CreateGazeLogSchema = z.object({
  timestamp: z.string().datetime(),
  gazeX: z.number(),
  gazeY: z.number(),
  confidence: z.number().min(0).max(1).optional(),
  pageUrl: z.string().optional(),
});

export const WebgazerBatchSchema = z.object({
  sessionId: z.string(),
  courseId: z.string(),
  readings: z.array(CreateGazeLogSchema),
});

export const WebgazerConfigSchema = z.object({
  isEnabled: z.boolean(),
  calibrationOnNewSession: z.boolean(),
  recalibrationEnabled: z.boolean(),
  inactivityTimeoutSecs: z.number().int().min(300).max(7200),
});

export const CalibrationEventSchema = z.object({
  sessionId: z.string(),
  courseId: z.string(),
  triggeredBy: z.enum(['new_session', 'inactivity', 'manual']),
  completedAt: z.string().datetime().optional(),
  accuracy: z.number().nonnegative().optional(),
});
```

---

## Stage 6 — ActivityLog Integration

Add to the existing `ActivityLog` action type enum:

```typescript
WEBGAZER_TRACKING_STARTED       = 'WEBGAZER_TRACKING_STARTED',
WEBGAZER_TRACKING_STOPPED       = 'WEBGAZER_TRACKING_STOPPED',
WEBGAZER_CALIBRATION_STARTED    = 'WEBGAZER_CALIBRATION_STARTED',
WEBGAZER_CALIBRATION_COMPLETED  = 'WEBGAZER_CALIBRATION_COMPLETED',
WEBGAZER_CALIBRATION_SKIPPED    = 'WEBGAZER_CALIBRATION_SKIPPED',
WEBGAZER_BATCH_SUBMITTED        = 'WEBGAZER_BATCH_SUBMITTED',
WEBGAZER_RECALIBRATION_PROMPTED = 'WEBGAZER_RECALIBRATION_PROMPTED',
```

---

## Testing Checklist

- [ ] WebGazer loads and webcam permission is requested when feature is enabled
- [ ] Calibration modal appears on new session start when `calibrationOnNewSession = true`
- [ ] Calibration modal re-appears after inactivity timeout elapses
- [ ] Gaze data (x, y) is captured at ~5 Hz
- [ ] Buffer flushes every 30 s; verified in network tab
- [ ] `sendBeacon` fires on page unload with remaining buffer
- [ ] CSV export contains correct columns and is downloadable
- [ ] Teacher can toggle feature per course and change inactivity timeout
- [ ] Log viewer shows gaze chart and calibration history
- [ ] Heatmap renders correctly for a session with data
- [ ] Skipping calibration is possible; skip event is logged

---

## Key Notes

- **Privacy disclosure**: Display *"Eye tracking is active for this course"* banner consistently.
- **WebGazer state persistence**: Use `webgazer.saveDataAcrossSessions(false)` — do not persist calibration data to `localStorage` across sessions; always recalibrate.
- **Iframe isolation**: If any module content is in an iframe, gaze coordinates will be relative to the iframe viewport. Document this limitation.
- **Browser support**: WebGazer requires Chrome or Edge with WebGL. Display an unsupported-browser warning if `!window.WebGLRenderingContext`.
- **MinIO CSV lifecycle**: Set 90-day expiry on the `webgazer/` prefix in MinIO bucket policies.
