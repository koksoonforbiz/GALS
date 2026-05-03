# Stage 2 — Pipeline Integration: Wire OpenFace 3 into the Recording Flow

## Context

Stage 1 created:
- `services/openface3-worker` (Python worker)
- `Openface3Job` and `EmotionFrame` Prisma models
- `apps/api/src/modules/openface3` NestJS module with `POST /api/openface3/jobs`
- An enqueue call placed next to the existing py-feat enqueue in the recording-segment-completed event handler

This stage makes the integration **production-ready**: per-course config, backfill, observability, and graceful degradation. **Do not** touch the affective-state mapping or teacher dashboard yet — those are Stages 3 and 4.

## Goal of Stage 2

1. Add per-course OpenFace 3 enable/disable + extraction-FPS config (mirroring how pupil-size and py-feat are configured per course)
2. Build a **backfill** path so teachers can re-process historical recordings after enabling the feature
3. Add observability: job dashboards counts, dead-letter handling, structured logs
4. Ensure graceful degradation when the worker is down or GPU is unavailable
5. Add a Socket.IO event so teachers viewing a live session can see "X frames analyzed" tick up

## Deliverables

### 1. Per-course configuration

The platform already has a `CourseBiometricConfig` model (or equivalent — find the actual name; it's the model behind "per-course enable/disable" for pupil size and py-feat). **Extend** it; do not create a parallel model.

Add fields:

```prisma
// Append to existing CourseBiometricConfig (or whatever the actual model is called)
openface3Enabled        Boolean   @default(false)
openface3ExtractionFps  Int       @default(5)        // 1–15 valid range
openface3DetectorBackend String   @default("retinaface")  // 'retinaface' | 'mtcnn' | 'mediapipe'
openface3RunOnNewSegments Boolean @default(true)     // if false, only backfill manually
```

Migration name: `add_openface3_course_config`.

Update the existing teacher "Biometrics" config screen (find it under `/teacher/courses/:courseId/...` — it's the same screen that toggles pupil size and py-feat). Add a new section "Emotion Detection (OpenFace 3)" with:
- Toggle: enable/disable
- Number input: extraction FPS (1–15, default 5, with helper text "Higher FPS = more granular emotion timeline but more compute")
- Select: detector backend
- Toggle: auto-process new segments
- A small info box: "Outputs 8 universal emotions (happiness, sadness, surprise, fear, anger, disgust, contempt, neutral) per frame. Affective-state mapping is configured separately."

### 2. Gating the enqueue

Modify the recording-segment-completed handler so the OpenFace 3 enqueue:
- Only fires when `courseConfig.openface3Enabled === true` AND `courseConfig.openface3RunOnNewSegments === true`
- Passes `extractionFps` and `detectorBackend` from the course config into the job payload
- Logs a structured `openface3.enqueue.skipped` event with reason when gated off

The py-feat enqueue path stays unchanged.

### 3. Backfill endpoint and UI

Endpoint:
```
POST /api/openface3/backfill
Body: {
  courseId: string,
  sessionIds?: string[],         // optional — if omitted, all sessions in the course
  studentIds?: string[],         // optional — if omitted, all students
  fromDate?: ISO string,         // optional — restrict by recording date
  toDate?: ISO string,
  overwrite?: boolean            // if true, delete existing EmotionFrame rows and re-enqueue
}
Returns: { enqueuedJobs: number, skipped: number, alreadyComplete: number }
Role: teacher (course owner) or admin
```

Implementation notes:
- Resolve all `RecordingSegment` rows matching the filters whose `uploadStatus = 'COMPLETED'`
- For each, check if an `Openface3Job` already exists. If yes and `overwrite=false`, count as `alreadyComplete`. If yes and `overwrite=true`, delete the job + its frames and re-enqueue.
- Rate-limit: do not enqueue more than 200 jobs per backfill call. Return `enqueuedJobs` actually pushed and a `nextCursor` if more remain.

UI: add a "Backfill emotion data" button on the same biometrics config screen. On click, open a modal with date range, "Overwrite existing" toggle, and a confirmation. Show a toast with the result counts.

### 4. Observability

a. **Job-status counters endpoint** for admins:
```
GET /api/openface3/jobs/stats?courseId=&from=&to=
Returns: {
  pending: number,
  processing: number,
  completed: number,
  failed: number,
  cancelled: number,
  avgProcessingMs: number,
  p95ProcessingMs: number
}
```

b. **Dead-letter queue:** after 3 failed retries, move the job to status `FAILED` and push a record to a Redis list `openface3:dead_letter` containing `{ jobId, recordingSegmentId, errorMessage, failedAt }`. Add an admin endpoint `GET /api/openface3/dead-letter` and `POST /api/openface3/dead-letter/:jobId/requeue`.

c. **Structured logs** (use the existing logger; match its format):
- `openface3.job.enqueued { jobId, recordingSegmentId, courseId, extractionFps }`
- `openface3.job.started { jobId, deviceUsed }`
- `openface3.job.completed { jobId, framesProcessed, framesWithFace, durationMs }`
- `openface3.job.failed { jobId, error, retries }`

### 5. Graceful degradation

- If the OpenFace 3 worker hasn't reported a heartbeat to Redis (key `openface3:worker:heartbeat`) within the last 60 s, the API marks the worker as **degraded**. New enqueues still happen (jobs queue up), but a banner appears on the teacher biometrics screen: "OpenFace 3 worker unreachable — jobs are queued and will process when the worker reconnects."
- The worker writes its heartbeat (a UNIX timestamp) every 15 s.
- Add `GET /api/openface3/health` returning `{ workerReachable: bool, lastHeartbeatAt: ISO, queueDepth: number }`.

### 6. Live-session Socket.IO event

The teacher portal already has session timelines with live updates. When a session is in progress and OpenFace 3 finishes a job for one of its segments, emit:

```
event: 'openface3:frames_ingested'
payload: { sessionId, jobId, framesProcessed, framesWithFace, latestFrameWallMs }
room: `teacher:session:${sessionId}`
```

Hook this into the existing Socket.IO gateway. Subscribe in the session-timeline component (no UI changes needed yet — Stage 4 will visualize it; for now just confirm the event fires by logging it client-side).

### 7. Tests

Add to `apps/api/test/`:
- `openface3.config.spec.ts` — toggling `openface3Enabled` gates the enqueue
- `openface3.backfill.spec.ts` — backfill with/without overwrite
- `openface3.dead-letter.spec.ts` — failed job lands in dead-letter after 3 retries

For the worker, add `services/openface3-worker/tests/test_heartbeat.py`.

## Patterns to follow (read first)

1. The existing per-course pupil-size enable/disable flow — config model, UI section, and how it gates the data collector. Replicate the shape.
2. The existing py-feat enqueue path you wrote in Stage 1 — extend that exact event handler.
3. The Socket.IO gateway and how teacher-room subscriptions are scoped — find an existing emit and copy its room-naming convention.
4. The existing job-stats pattern (the platform has similar stats for grading jobs — find that controller and mirror its query style).

## Acceptance criteria

- [ ] Toggling "Emotion Detection" off on a course stops new jobs from enqueuing for that course's sessions
- [ ] Toggling it back on resumes enqueuing
- [ ] Backfill with `overwrite=false` is idempotent (running it twice does not duplicate frames)
- [ ] Backfill with `overwrite=true` cleanly replaces frames
- [ ] Killing the worker container makes `GET /api/openface3/health` return `workerReachable: false` within 75 s
- [ ] Restarting the worker drains the queued jobs and the banner disappears
- [ ] A failed job retries 3× then lands in the dead-letter list, and re-queue from dead-letter works
- [ ] Teacher viewing the live session sees `openface3:frames_ingested` events in the browser console as segments complete

## Out of scope for Stage 2

- Sliding-window aggregation (Stage 3)
- Affective-state mapping (Stage 3)
- Mapping editor UI (Stage 3)
- Emotion timeline charts and the affective-state visualization (Stage 4)
