# Feature Prompt 04 — Webcam Session Recording with Synchronised Timestamps

## Context

You are extending the **Adaptive Tutoring System (ATS)** monorepo. Stack: NestJS 10, React 18 + Vite, PostgreSQL + Prisma, Redis, MinIO. The system tracks student activity via `StudentSession` → `ActivityLog`.

This feature **continuously records the student's webcam** during an active learning session. Recordings are:
- Segmented on page refresh / session boundaries
- Uploaded to MinIO with a structured filename
- Synchronised to all other log data (pupil size, gaze, AU, activity logs) via a shared `wallClockOffset`
- Used downstream by Feature 03 (py-feat AU extraction) as the video source

---

## Feature Overview

- Client-side `MediaRecorder` API captures webcam video in chunks
- On page refresh or session end, the current chunk is finalised and uploaded
- Each recording segment is labelled: `{studentId}_{sessionId}_{date}_{timestamp}.webm`
- A `RecordingSegment` database record stores the MinIO path, timing metadata, and sync offset
- After upload, if py-feat is enabled for the course, a py-feat job is automatically enqueued
- Teacher Portal: enable/disable per course, view recording inventory per student

---

## Stage 1 — Database Schema (Prisma)

Add to `apps/api/prisma/schema.prisma`:

```prisma
model RecordingConfig {
  id          String   @id @default(cuid())
  courseId    String   @unique
  course      Course   @relation(fields: [courseId], references: [id], onDelete: Cascade)
  isEnabled   Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model RecordingSegment {
  id                String   @id @default(cuid())
  studentId         String
  student           User     @relation(fields: [studentId], references: [id], onDelete: Cascade)
  sessionId         String
  session           StudentSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  courseId          String
  course            Course   @relation(fields: [courseId], references: [id], onDelete: Cascade)
  minioKey          String   // full path in MinIO
  filename          String   // {studentId}_{sessionId}_{date}_{timestamp}.webm
  startWallTime     DateTime // UTC wall clock when recording started
  endWallTime       DateTime? // set on upload completion
  durationMs        Int?
  fileSizeBytes     Int?
  mimeType          String   @default("video/webm")
  segmentIndex      Int      @default(0) // 0 = first segment, increments on refresh
  uploadStatus      RecordingUploadStatus @default(PENDING)
  pyfeatJobId       String?  // linked py-feat job (if processing enabled)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

enum RecordingUploadStatus {
  PENDING
  UPLOADING
  COMPLETED
  FAILED
}
```

- Run `pnpm prisma migrate dev --name add_webcam_recording`
- Add back-relations on `User`, `StudentSession`, `Course`.

---

## Stage 2 — Backend: NestJS Module (`apps/api/src/recording/`)

```
apps/api/src/recording/
  recording.module.ts
  recording.controller.ts
  recording.service.ts
  dto/
    recording-config.dto.ts
    create-segment.dto.ts
    complete-segment.dto.ts
```

### `recording.service.ts` — Methods

```typescript
getConfig(courseId: string): Promise<RecordingConfig>
updateConfig(courseId: string, dto: RecordingConfigDto): Promise<RecordingConfig>

// Called by client before recording starts — creates the DB record and returns a MinIO presigned PUT URL
initiateSegment(dto: CreateSegmentDto): Promise<{
  segmentId: string;
  uploadUrl: string;  // presigned PUT URL valid for 2 hours
  minioKey: string;
}>

// Called by client after successful upload
completeSegment(segmentId: string, dto: CompleteSegmentDto): Promise<RecordingSegment>
  // 1. Update status=COMPLETED, endWallTime, durationMs, fileSizeBytes
  // 2. If PyfeatConfig.isEnabled for courseId → call PyfeatService.enqueueJob(...)
  // 3. Return updated segment

// Mark segment as failed (e.g., upload error)
failSegment(segmentId: string, error: string): Promise<void>

// Teacher: list all segments for a student
getSegments(studentId: string, courseId: string): Promise<RecordingSegment[]>

// Generate download URL for a segment
getDownloadUrl(segmentId: string): Promise<string> // presigned GET URL
```

### `recording.controller.ts` — REST Endpoints

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/recording/config/:courseId` | teacher | Get config |
| PATCH | `/recording/config/:courseId` | teacher | Update config |
| POST | `/recording/segments/initiate` | student | Create segment + get upload URL |
| PATCH | `/recording/segments/:segmentId/complete` | student | Mark upload complete |
| PATCH | `/recording/segments/:segmentId/fail` | student | Mark upload failed |
| GET | `/recording/segments/:studentId/:courseId` | teacher | List segments |
| GET | `/recording/segments/:segmentId/download` | teacher | Get download URL |

### MinIO Path Convention

```
recordings/{courseId}/{studentId}/{sessionId}/{filename}
```

Where `filename` = `{studentId}_{sessionId}_{YYYY-MM-DD}_{HHmmss-SSS}_{segmentIndex}.webm`

Example:
```
recordings/clx1a2b3/usr_abc123/sess_xyz789/usr_abc123_sess_xyz789_2024-11-15_143022-000_0.webm
```

---

## Stage 3 — Frontend: Webcam Recording Hook

### `apps/web/src/lib/recording/`

#### `useWebcamRecording.ts` (React hook)

This is the **central recording hook**. It manages the full `MediaRecorder` lifecycle, handles page transitions, and coordinates uploads.

**Initialisation**
1. On mount, call `GET /recording/config/:courseId`. If `isEnabled = false`, return early.
2. Request webcam access: `navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 15 }, audio: false })`.
3. Compute and store the **wall clock offset**: `wallClockOffset = Date.now() - performance.now()`. This is used to convert `performance.now()` timestamps to absolute UTC across all data streams.
4. Call `POST /recording/segments/initiate` to create the DB record and obtain a presigned upload URL.
5. Create a `MediaRecorder` with `mimeType: 'video/webm;codecs=vp8'` (or `vp9` if supported, check via `MediaRecorder.isTypeSupported()`).
6. Collect `ondataavailable` chunks into a local `Blob` array.
7. Start recording: `mediaRecorder.start(1000)` (1-second time slices for memory efficiency).

**Chunk Management**
- On each `ondataavailable` event: push `event.data` to `chunks` array.
- Keep a running total of blob size. If it exceeds **50 MB**, force-stop and restart a new segment (prevents memory overflow on long sessions).

**Upload Flow**
```
mediaRecorder.stop()
  → onstop fires
  → blob = new Blob(chunks, { type: mimeType })
  → PUT blob to presigned upload URL (fetch with PUT method)
  → on success: PATCH /recording/segments/:segmentId/complete { endWallTime, durationMs, fileSizeBytes }
  → on error: PATCH /recording/segments/:segmentId/fail { error }
```

**Page Visibility / Refresh Handling**

Use a combination of events to catch all page-leave scenarios:

```typescript
// 1. beforeunload: synchronous flush attempt
window.addEventListener('beforeunload', (e) => {
  mediaRecorder.stop(); // triggers onstop
  // Note: can't await async upload in beforeunload
  // Use sendBeacon for the complete/fail notification
});

// 2. visibilitychange: pause on tab hide, resume on tab show
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    handlePageLeave();
  } else {
    handlePageReturn();
  }
});

// 3. pagehide (more reliable than beforeunload on mobile)
window.addEventListener('pagehide', handlePageLeave);
```

**On page return / remount after refresh**:
- A new session will have a new `sessionId` from the existing session management system.
- Increment `segmentIndex` by calling `POST /recording/segments/initiate` again with the new `sessionId`.
- The `segmentIndex` on the server should auto-increment per `(studentId, sessionId)` pair.

**sendBeacon for in-flight notifications**:
```typescript
// On beforeunload, use sendBeacon to notify server of segment completion
// even if the page is closing
const completionPayload = JSON.stringify({
  endWallTime: new Date().toISOString(),
  durationMs: Date.now() - segmentStartTime,
  fileSizeBytes: totalBytesCollected,
});
navigator.sendBeacon(
  `/api/recording/segments/${segmentId}/complete`,
  new Blob([completionPayload], { type: 'application/json' })
);
```

**Return shape**:
```typescript
export interface RecordingState {
  isActive: boolean;
  isUploading: boolean;
  segmentId: string | null;
  startWallTime: Date | null;
  wallClockOffset: number; // ms offset: Date.now() - performance.now()
  error: string | null;
}

export function useWebcamRecording(courseId: string, sessionId: string): RecordingState
```

**Expose `wallClockOffset`** — this value must be shared with `usePupilSize` and `useWebgazer` hooks so all data streams use the same time reference. Pass it via a React context or a shared `BiometricsSyncContext`.

#### `BiometricsSyncContext.tsx`

Create `apps/web/src/contexts/BiometricsSyncContext.tsx`:

```typescript
interface BiometricsSyncContextValue {
  sessionId: string;
  courseId: string;
  wallClockOffset: number;  // from useWebcamRecording
  isRecordingActive: boolean;
}

export const BiometricsSyncContext = createContext<BiometricsSyncContextValue | null>(null);
export const useBiometricsSync = () => useContext(BiometricsSyncContext);
```

Wrap the student layout with `BiometricsSyncProvider`, which internally calls `useWebcamRecording`, `usePupilSize`, and `useWebgazer`, injecting `wallClockOffset` into the latter two so all logs share the same time base.

#### `RecordingIndicator.tsx`

A persistent, non-intrusive recording indicator for the student:
- Small red pulsing dot in the top-right corner of the page when recording is active
- Tooltip on hover: *"Session is being recorded for learning analytics"*
- Orange dot when upload is in progress

---

## Stage 4 — Timestamp Synchronisation Across All Features

This is the **critical cross-feature requirement**. All biometric streams must use the same wall clock reference so data can be correlated in time during analysis.

### Synchronisation Protocol

All four data streams (pupil size, gaze, AUs, activity logs) must be anchored to the same `wallClockOffset`:

```typescript
// Computed once at session start by useWebcamRecording:
const wallClockOffset = Date.now() - performance.now();

// Used by ALL hooks to convert a performance.now() reading to UTC:
const toWallTime = (perfNow: number): string =>
  new Date(perfNow + wallClockOffset).toISOString();
```

### Updated Hook Signatures

`usePupilSize` and `useWebgazer` accept `wallClockOffset`:

```typescript
usePupilSize(courseId: string, sessionId: string, wallClockOffset: number)
useWebgazer(courseId: string, sessionId: string, wallClockOffset: number)
```

All timestamp fields in `CreatePupilLogDto`, `CreateGazeLogDto`, and video `startWallTime` derive from `toWallTime(performance.now())` using the shared offset.

### ActivityLog Sync

Add a `wallClockOffset` field to `StudentSession` or store it in the `SessionSummary.metadata` JSON so analysts can retrospectively align the existing activity log timestamps.

---

## Stage 5 — Teacher Portal Settings

### `RecordingSettings.tsx`

Location: `apps/web/src/components/teacher/biometrics/RecordingSettings.tsx`

Mount in the **Biometrics** tab of `CourseBuilderPage`.

**Fields**:

| Field | Type | Description |
|-------|------|-------------|
| Enable recording | Toggle | Master on/off per course |

Note: display a privacy warning box: *"Enabling this feature will record video of students during learning sessions. Ensure students have been informed and have consented per your institution's policies."*

### `RecordingLogViewer.tsx`

Location: `apps/web/src/components/teacher/biometrics/RecordingLogViewer.tsx`

Mount in `StudentLogPage` under the **Biometrics** tab.

**Sections**:

1. **Segment Table**:
   - Columns: Segment File, Session ID, Date, Start Time, Duration, Size, Status, py-feat Status, Actions
   - Status badge: PENDING / UPLOADING / COMPLETED / FAILED
   - py-feat badge (links to Feature 03 job status): PENDING / PROCESSING / COMPLETED / FAILED / N/A
   - **Download button** per row: calls `GET /recording/segments/:segmentId/download` → opens presigned URL

2. **Timeline Alignment View** (advanced, optional for first iteration):
   - For a selected session, show a horizontal timeline bar chart
   - One row per data stream: Recording, Gaze, Pupil Size, Activity Events
   - X-axis: wall clock time
   - Shows coverage/gaps in each stream
   - Useful to diagnose sync issues

---

## Stage 6 — Shared Zod Schemas (`packages/shared/src/`)

```typescript
// recording.schema.ts
export const RecordingConfigSchema = z.object({
  isEnabled: z.boolean(),
});

export const CreateSegmentSchema = z.object({
  sessionId: z.string(),
  courseId: z.string(),
  startWallTime: z.string().datetime(),
  segmentIndex: z.number().int().nonnegative(),
  mimeType: z.string().default('video/webm'),
});

export const CompleteSegmentSchema = z.object({
  endWallTime: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
  fileSizeBytes: z.number().int().nonnegative(),
});
```

---

## Stage 7 — ActivityLog Integration

```typescript
RECORDING_STARTED          = 'RECORDING_STARTED',
RECORDING_STOPPED          = 'RECORDING_STOPPED',
RECORDING_SEGMENT_UPLOADED = 'RECORDING_SEGMENT_UPLOADED',
RECORDING_UPLOAD_FAILED    = 'RECORDING_UPLOAD_FAILED',
RECORDING_RESUMED          = 'RECORDING_RESUMED',  // after page refresh
```

Emit `RECORDING_STARTED` with `{ segmentId, startWallTime, wallClockOffset }` so the offset is preserved in the activity log.

---

## Stage 8 — Integration with py-feat (Feature 03)

In `RecordingService.completeSegment()`, after marking the segment COMPLETED:

```typescript
const pyfeatConfig = await this.pyfeatService.getConfig(segment.courseId);
if (pyfeatConfig.isEnabled) {
  const job = await this.pyfeatService.enqueueJob({
    studentId: segment.studentId,
    sessionId: segment.sessionId,
    courseId: segment.courseId,
    sourceMinioKey: segment.minioKey,
    clipStartWallTime: segment.startWallTime.toISOString(),
  });
  await this.prisma.recordingSegment.update({
    where: { id: segment.id },
    data: { pyfeatJobId: job.id },
  });
}
```

---

## Testing Checklist

- [ ] Webcam permission is requested when recording is enabled
- [ ] `MediaRecorder` starts and `ondataavailable` fires at 1-second intervals
- [ ] Recording indicator (red dot) is visible while active
- [ ] On page refresh: `beforeunload` / `pagehide` stops the recorder
- [ ] `sendBeacon` fires with completion payload on page unload
- [ ] New session after refresh creates a new segment with incremented `segmentIndex`
- [ ] Presigned PUT upload succeeds; file appears in MinIO
- [ ] After upload, `PATCH /complete` updates DB with correct endWallTime and size
- [ ] If py-feat is enabled, a `PyfeatJob` is created automatically after upload
- [ ] Filename convention: `{studentId}_{sessionId}_{date}_{timestamp}_{segmentIndex}.webm`
- [ ] `wallClockOffset` is shared correctly to pupil size and gaze hooks
- [ ] Teacher toggle enables/disables per course
- [ ] Recording viewer shows all segments with correct status and download links
- [ ] 50 MB auto-segment rotation works on long sessions

---

## Key Notes

- **Video quality**: `{ width: 640, height: 480, frameRate: 15 }` balances quality and storage cost. Document expected storage use (≈ 25–40 MB per 10 minutes at these settings).
- **Audio**: `audio: false` — do not record audio. This simplifies privacy compliance and reduces file size.
- **Container format**: Use `video/webm;codecs=vp8`. Avoid MP4 in browser as it requires a fragmented MP4 writer. The Python worker can transcode to MP4 if needed using `ffmpeg`.
- **CORS on MinIO**: Ensure the MinIO bucket has a CORS policy that allows `PUT` requests from the app's origin for direct browser-to-MinIO uploads.
- **MinIO bucket policy**: Set lifecycle rule on `recordings/` prefix: delete objects older than 180 days (configurable).
- **Student consent**: Before activating the recorder for the first time per student per course, display a one-time consent modal. Store acceptance in a `RecordingConsent` model or in the existing user preferences. Do not record without explicit consent.
- **Multipart uploads for large files**: For segments > 5 MB (virtually all of them), use MinIO's multipart upload via presigned URLs (NestJS `BlobService` should generate a `CreateMultipartUpload` initiation URL and return presigned part URLs). This avoids single-request size limits.
  - Alternatively: use a single presigned PUT URL (MinIO supports up to 5 GB for a single PUT) which is simpler to implement — prefer this approach for V1.
