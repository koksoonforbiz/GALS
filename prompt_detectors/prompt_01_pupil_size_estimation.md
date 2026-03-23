# Feature Prompt 01 — SET Pupil Size Estimation

## Context

You are building a new feature inside an existing **Adaptive Tutoring System (ATS)** monorepo with the following stack:

- **Monorepo**: pnpm + Turbo
- **Backend**: NestJS 10 (TypeScript), REST + Socket.io WebSockets
- **Frontend**: React 18 + React Router 6, Vite, Tailwind CSS 4
- **Database**: PostgreSQL + Prisma ORM
- **Cache/Queue**: Redis
- **Blob Storage**: MinIO (S3-compatible)

The system has a **Student Portal** and a **Teacher Portal**. Students interact with learning content (dialogue, assessments, review queues). Teachers manage courses, monitor students, and configure the platform. The existing activity log system tracks 30+ action types per student session via `StudentSession` → `ActivityLog` → `SessionSummary` models.

Reference repository for the pupil size algorithm: https://github.com/kianyu/SET_pupil

---

## Feature Overview

Implement **SET (Simple Eye Tracking) Pupil Size Estimation** using the webcam directly in the browser. This feature:

- Runs client-side using the student's webcam
- Estimates pupil size in real time
- Logs timestamped pupil diameter readings to a CSV file per student per session
- Is fully controllable from the Teacher Portal (enable/disable, view logs)

---

## Stage 1 — Database Schema (Prisma)

Add the following models to `apps/api/prisma/schema.prisma`:

```prisma
model PupilSizeConfig {
  id          String   @id @default(cuid())
  courseId    String   @unique
  course      Course   @relation(fields: [courseId], references: [id], onDelete: Cascade)
  isEnabled   Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model PupilSizeLog {
  id            String   @id @default(cuid())
  studentId     String
  student       User     @relation(fields: [studentId], references: [id], onDelete: Cascade)
  sessionId     String
  session       StudentSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  courseId      String
  course        Course   @relation(fields: [courseId], references: [id], onDelete: Cascade)
  timestamp     DateTime
  pupilDiameter Float    // in pixels or normalised units
  rawData       Json?    // optional: store full frame metadata
  createdAt     DateTime @default(now())
}
```

- Run `pnpm prisma migrate dev --name add_pupil_size_tracking` inside `apps/api`.
- Add the corresponding relation fields to `User`, `StudentSession`, and `Course` models.

---

## Stage 2 — Backend: NestJS Module (`apps/api/src/pupil-size/`)

Create a new NestJS module `PupilSizeModule` with the following structure:

```
apps/api/src/pupil-size/
  pupil-size.module.ts
  pupil-size.controller.ts
  pupil-size.service.ts
  dto/
    create-pupil-log.dto.ts
    pupil-size-config.dto.ts
```

### `pupil-size.service.ts`

Implement the following methods:

```typescript
// Teacher: get or create config for a course
getConfig(courseId: string): Promise<PupilSizeConfig>

// Teacher: update config (enable/disable)
updateConfig(courseId: string, dto: PupilSizeConfigDto): Promise<PupilSizeConfig>

// Student: batch insert pupil size readings (called periodically from browser)
bulkCreateLogs(studentId: string, sessionId: string, courseId: string, readings: CreatePupilLogDto[]): Promise<void>

// Teacher: fetch all logs for a student (for log viewer)
getLogsForStudent(studentId: string, courseId: string, options: { from?: Date; to?: Date }): Promise<PupilSizeLog[]>

// Teacher/Student: export logs as CSV for a specific session
exportSessionCsv(studentId: string, sessionId: string): Promise<string> // returns CSV string
```

### `pupil-size.controller.ts`

Register these REST endpoints (guard with `JwtAuthGuard` + role guards from existing auth system):

| Method | Path                                            | Role            | Description           |
| ------ | ----------------------------------------------- | --------------- | --------------------- |
| GET    | `/pupil-size/config/:courseId`                  | teacher         | Get config            |
| PATCH  | `/pupil-size/config/:courseId`                  | teacher         | Update config         |
| POST   | `/pupil-size/logs`                              | student         | Batch submit readings |
| GET    | `/pupil-size/logs/:studentId/:courseId`         | teacher         | View logs             |
| GET    | `/pupil-size/logs/:studentId/:sessionId/export` | teacher/student | Download CSV          |

### CSV Export Format

The exported CSV for a session must follow this column structure:

```
studentId,sessionId,courseId,timestamp,pupilDiameter,rawData
```

- Store the generated CSV temporarily in MinIO under the path: `pupil-size/{studentId}/{sessionId}/pupil_size.csv`
- Return a presigned download URL using the existing `BlobService`.

### `dto/create-pupil-log.dto.ts`

```typescript
export class CreatePupilLogDto {
  timestamp: string; // ISO8601
  pupilDiameter: number;
  rawData?: Record<string, unknown>;
}
```

---

## Stage 3 — Frontend: Student-Side Integration

### `apps/web/src/lib/pupil-size/`

Create the following files:

#### `usePupilSize.ts` (React hook)

This hook:

1. On mount, checks via `GET /pupil-size/config/:courseId` whether the feature is enabled.
2. If enabled, requests webcam access (`navigator.mediaDevices.getUserMedia`).
3. Loads the SET pupil size algorithm from the reference repo. Adapt the JavaScript port of the algorithm:
   - Draw each video frame onto a hidden `<canvas>`
   - Convert to grayscale
   - Apply Gaussian blur (kernel 5×5, sigma ~1.5)
   - Threshold to isolate dark pupil region (adaptive threshold preferred)
   - Find contours and pick the largest circular blob
   - Compute the equivalent circle diameter as `pupilDiameter = 2 * sqrt(area / π)`
4. Runs estimation at **2 Hz** (every 500 ms) using `setInterval`.
5. Buffers readings locally in a `useRef` array.
6. Every **30 seconds**, flushes the buffer to the backend via `POST /pupil-size/logs`.
7. On unmount / page unload (`beforeunload`), flushes the remaining buffer synchronously using `navigator.sendBeacon`.

```typescript
export interface PupilReading {
  timestamp: string;
  pupilDiameter: number;
}

export function usePupilSize(
  courseId: string,
  sessionId: string,
): {
  isActive: boolean;
  latestDiameter: number | null;
};
```

#### `PupilSizeOverlay.tsx` (optional debug overlay)

A small floating badge (bottom-right corner, only in development mode) that shows:

- Current pupil diameter in px
- Status: `active | calibrating | error | disabled`

### Integration Point

Mount the hook inside `apps/web/src/pages/student/dialogue/DialogueLearning.tsx` and `apps/web/src/pages/student/StudentCourseViewPage.tsx`. Pass `courseId` and `sessionId` from the page context.

```tsx
const { isActive } = usePupilSize(courseId, currentSession.id);
```

---

## Stage 4 — Frontend: Teacher Portal Settings

### `apps/web/src/pages/teacher/CourseBuilderPage.tsx`

Add a new tab to the existing **8-tab interface**: **"Biometrics"** (or append to the existing Settings tab if a new tab is not desired).

#### `PupilSizeSettings.tsx` component

Location: `apps/web/src/components/teacher/biometrics/PupilSizeSettings.tsx`

UI elements:

- **Toggle switch**: Enable / Disable pupil size tracking for this course
- **Status badge**: Shows current config state (Enabled / Disabled)
- **Save button**: Calls `PATCH /pupil-size/config/:courseId`

#### `PupilSizeLogViewer.tsx` component

Location: `apps/web/src/components/teacher/biometrics/PupilSizeLogViewer.tsx`

This is embedded in the **StudentLogPage** (`/teacher/students/:studentId/logs`) as a new tab alongside the existing Summary, Conversation, Timeline, and Interventions tabs. Name it **"Biometrics"**.

UI elements:

- **Date range picker**: Filter logs by date range
- **Session selector dropdown**: Filter by specific session
- **Line chart** (use recharts): X-axis = timestamp, Y-axis = pupilDiameter. One series per session if multiple are shown.
- **Data table**: Paginated table of raw readings (timestamp, diameter, sessionId)
- **Export CSV button**: Calls `GET /pupil-size/logs/:studentId/:sessionId/export` and triggers file download

---

## Stage 5 — Shared Zod Schemas (`packages/shared/src/`)

Add:

```typescript
// pupil-size.schema.ts
export const CreatePupilLogSchema = z.object({
  timestamp: z.string().datetime(),
  pupilDiameter: z.number().nonnegative(),
  rawData: z.record(z.unknown()).optional(),
});

export const PupilSizeBatchSchema = z.object({
  sessionId: z.string(),
  courseId: z.string(),
  readings: z.array(CreatePupilLogSchema),
});

export const PupilSizeConfigSchema = z.object({
  isEnabled: z.boolean(),
});
```

---

## Stage 6 — ActivityLog Integration

When the pupil size tracker starts or stops, emit an activity log event using the existing `ActivityLog` system:

```typescript
// Action types to add to the existing enum:
PUPIL_SIZE_TRACKING_STARTED = 'PUPIL_SIZE_TRACKING_STARTED',
PUPIL_SIZE_TRACKING_STOPPED = 'PUPIL_SIZE_TRACKING_STOPPED',
PUPIL_SIZE_BATCH_SUBMITTED   = 'PUPIL_SIZE_BATCH_SUBMITTED',
```

Log `PUPIL_SIZE_BATCH_SUBMITTED` on every successful flush with metadata: `{ count: number, sessionId: string }`.

---

## Testing Checklist

- [ ] Webcam permission prompt appears on first use when feature is enabled
- [ ] Readings are captured at ~2 Hz with valid diameter values
- [ ] Buffer flushes to backend every 30 s; verified in network tab
- [ ] On page unload, `sendBeacon` fires with remaining buffer
- [ ] CSV export produces correct columns and is downloadable
- [ ] Teacher toggle enables/disables the feature per course
- [ ] Log viewer chart renders pupil data by session
- [ ] If webcam is denied, feature gracefully disables without breaking the page

---

## Key Notes

- **Privacy**: Display a persistent, dismissible banner on the student page when biometric tracking is active: _"Pupil size monitoring is active for this course."_
- **Performance**: The canvas processing runs on a `OffscreenCanvas` in a Web Worker if available, to avoid blocking the main thread.
- **Data retention**: CSV files in MinIO should have a lifecycle policy of 90 days (configure in MinIO bucket settings, document this in the README).
- **No face data is stored** — only the scalar pupil diameter value is persisted.
