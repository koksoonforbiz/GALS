# Stage 1 — OpenFace 3 Worker Service, Prisma Schema, Ingestion API

## Context

You are working in an existing adaptive tutoring monorepo (pnpm workspaces + TurboRepo) with the following stack:

- **Backend:** NestJS 10 (REST + Socket.IO) at `apps/api`
- **DB:** PostgreSQL 16 via Prisma 6.19 (`packages/db/prisma/schema.prisma`)
- **Cache/Queue:** Redis 7
- **Object storage:** MinIO (S3-compatible)
- **Existing Python workers:** `services/grading-worker` (FastAPI) and `services/pyfeat-worker` (PyTorch + py-feat, GPU/CUDA)
- **Orchestration:** Docker Compose (8 services)

The platform already has **Feature 04 — Webcam Recording**: WebM segments (~50MB auto-rotate) uploaded to MinIO via presigned URLs, with metadata stored as a `RecordingSegment` row (start/end wall time, duration, file size, upload status).

The platform already has **Feature 03 — py-feat Facial AU Extraction** that consumes `RecordingSegment` rows via a Redis job queue. Mirror that exact pattern for OpenFace 3 — do **not** replace py-feat; OpenFace 3 runs alongside it.

## Goal of Stage 1

Add **OpenFace 3** as an independent Python worker that:

1. Consumes completed webcam recording segments
2. Runs OpenFace 3's emotion estimation head to produce **8 universal emotions per frame**: `happiness`, `sadness`, `surprise`, `fear`, `anger`, `disgust`, `contempt`, `neutral`
3. Persists per-frame emotion probabilities to Postgres
4. Exposes a NestJS ingestion + read API for emotion frames

Do **not** implement the sliding window aggregation, affective state mapping, or teacher dashboard in this stage — those are Stages 3 and 4.

## Why OpenFace 3 specifically

OpenFace 3 (CMU MultiComp Lab, https://github.com/CMU-MultiComp-Lab/OpenFace-3.0) is required because it ships a unified multi-task model that outputs the 8 universal emotions directly with per-frame probabilities, in addition to AUs and gaze. py-feat does AUs but does not output the categorical emotion labels we need for the affective-state mapping in Stage 3. Use OpenFace 3's **emotion estimation** output, not its AU output.

## Deliverables

### 1. New Python service: `services/openface3-worker`

Structure to mirror `services/pyfeat-worker`:

```
services/openface3-worker/
├── Dockerfile
├── pyproject.toml          # or requirements.txt — match what pyfeat-worker uses
├── README.md
├── src/
│   ├── main.py             # entry: connects Redis, loops over jobs
│   ├── worker.py           # job consumer + dispatch
│   ├── openface3_runner.py # wraps OpenFace 3 model load + per-frame inference
│   ├── db.py               # psycopg2 or asyncpg to write EmotionFrame rows
│   ├── minio_client.py     # presigned download of WebM segments
│   ├── config.py           # env vars: OPENFACE3_MODEL_PATH, FPS, BATCH_SIZE, DEVICE
│   └── schemas.py          # pydantic input/output types
└── tests/
    └── test_runner.py      # smoke test with a fixture video
```

Key behaviors:

- Load OpenFace 3 model **once** at startup (not per job). Support `DEVICE=cuda` and `DEVICE=cpu`.
- Job payload (Redis list `openface3:jobs`, JSON):
  ```json
  {
    "jobId": "uuid",
    "recordingSegmentId": "uuid",
    "minioBucket": "recordings",
    "minioKey": "courses/<courseId>/sessions/<sessionId>/<segmentId>.webm",
    "sessionId": "uuid",
    "userId": "uuid",
    "courseId": "uuid",
    "segmentStartWallMs": 1730000000000,
    "extractionFps": 5
  }
  ```
- Process pipeline:
  1. Download WebM from MinIO to `/tmp`
  2. Use `decord` or `opencv` to sample frames at `extractionFps` (default 5 Hz)
  3. For each sampled frame: run OpenFace 3 face detection + emotion head → get 8 emotion probs
  4. Compute `frameWallMs = segmentStartWallMs + (frameIdx / extractionFps) * 1000`
  5. Bulk-insert into `EmotionFrame` table (use `COPY` or chunked `INSERT ... VALUES` of 500 rows)
  6. Update `Openface3Job.status = 'COMPLETED'`, set `framesProcessed`, `framesWithFace`
  7. On failure: set `status = 'FAILED'`, `errorMessage`, retry up to 3 times with exponential backoff
- Skip frames with no detected face but still log them (set `faceDetected=false`, all emotion probs null)
- Health endpoint on `:8000/health` returning model load status and last job timestamp

### 2. Prisma schema additions

Add to `packages/db/prisma/schema.prisma`. Follow the existing naming and indexing conventions used by `PyfeatJob` and `PyfeatFrame` (look those up first; mirror them).

```prisma
enum Openface3JobStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
  CANCELLED
}

model Openface3Job {
  id                  String              @id @default(cuid())
  recordingSegmentId  String              @unique
  recordingSegment    RecordingSegment    @relation(fields: [recordingSegmentId], references: [id], onDelete: Cascade)
  status              Openface3JobStatus  @default(PENDING)
  extractionFps       Int                 @default(5)
  detectorBackend     String              @default("retinaface")     // configurable
  framesProcessed     Int                 @default(0)
  framesWithFace      Int                 @default(0)
  errorMessage        String?
  retries             Int                 @default(0)
  startedAt           DateTime?
  completedAt         DateTime?
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt

  emotionFrames       EmotionFrame[]

  @@index([status])
  @@index([recordingSegmentId])
}

model EmotionFrame {
  id                  String        @id @default(cuid())
  jobId               String
  job                 Openface3Job  @relation(fields: [jobId], references: [id], onDelete: Cascade)

  sessionId           String
  userId              String
  courseId            String

  frameWallMs         BigInt        // absolute wall-clock ms for cross-modal sync
  frameIndex          Int           // index within the segment
  faceDetected        Boolean

  // Eight universal emotion probabilities (0.0–1.0). Null when faceDetected=false.
  pHappiness          Float?
  pSadness            Float?
  pSurprise           Float?
  pFear               Float?
  pAnger              Float?
  pDisgust            Float?
  pContempt           Float?
  pNeutral            Float?

  // Convenience: argmax label + its probability (computed at insert time)
  dominantEmotion     String?       // 'happiness' | 'sadness' | ... | 'neutral'
  dominantProbability Float?

  // Optional auxiliary OpenFace 3 outputs we may want later — keep nullable
  headPoseYaw         Float?
  headPosePitch       Float?
  headPoseRoll        Float?

  createdAt           DateTime      @default(now())

  @@index([sessionId, frameWallMs])
  @@index([userId, frameWallMs])
  @@index([courseId, frameWallMs])
  @@index([jobId])
}
```

Also add the back-relation field on `RecordingSegment`:
```prisma
openface3Job        Openface3Job?
```

Generate a Prisma migration named `add_openface3_emotion_frames`.

### 3. NestJS module: `apps/api/src/modules/openface3`

Mirror the existing `pyfeat` module structure. Files:

- `openface3.module.ts`
- `openface3.controller.ts` — REST endpoints
- `openface3.service.ts` — business logic
- `openface3.queue.ts` — Redis publisher (use the existing Redis service)
- `dto/` — Zod or class-validator DTOs

Endpoints (all under `/api/openface3`, JWT-protected, role-checked):

| Method | Path | Role | Purpose |
|---|---|---|---|
| `POST` | `/jobs` | system/internal | Enqueue a job for a recording segment (called by the existing recording-segment-completed event handler) |
| `GET` | `/jobs/:id` | teacher/admin | Job status |
| `GET` | `/jobs?sessionId=&status=` | teacher/admin | List jobs |
| `POST` | `/jobs/:id/retry` | teacher/admin | Manual retry for FAILED jobs |
| `GET` | `/frames?sessionId=&from=&to=&limit=` | teacher/admin | Paginated emotion frames for a session, filterable by wall-time window. Cap `limit` at 5000. |
| `GET` | `/frames/student/:studentId?courseId=&from=&to=` | teacher/admin | Same, scoped to a student in a course |
| `GET` | `/frames/session/:sessionId/summary` | teacher/admin | Counts per dominantEmotion + mean probabilities for the whole session |

Wire the job enqueue into the existing recording-segment-completed flow in the same place where `PyfeatJob` is currently enqueued — both should fire from the same event so they run in parallel.

### 4. Docker Compose

Add `openface3-worker` to `docker-compose.yml`. Mirror the `pyfeat-worker` service definition. Include:
- GPU deploy block (commented out by default with a note: "uncomment for CUDA")
- `depends_on`: redis, postgres, minio
- Env vars from `.env`: `DATABASE_URL`, `REDIS_URL`, `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `OPENFACE3_MODEL_PATH`, `OPENFACE3_DEVICE`
- Health check hitting `:8000/health`

### 5. Documentation

Create `services/openface3-worker/README.md` covering:
- How to download/place OpenFace 3 model weights (link to the official repo, license note)
- Local dev (CPU mode) vs GPU mode
- How to inspect job status from the NestJS side
- How emotion-frame timestamps align with the existing `frameWallMs` convention used by py-feat and pupil-size logs (this is critical for downstream multimodal sync — emphasize it)

## Patterns to follow (read these files first before writing anything)

1. `services/pyfeat-worker/` — entire directory. The OpenFace 3 worker should be structurally identical.
2. `apps/api/src/modules/pyfeat/` — entire module.
3. `packages/db/prisma/schema.prisma` — find `PyfeatJob`, `PyfeatFrame`, `RecordingSegment` to copy field naming/index conventions.
4. The recording-segment-completed event handler — find it and add the OpenFace 3 enqueue call next to the py-feat one.
5. `analysis/multimodal_sync.py` — read it so you understand how `frameWallMs` is used downstream; your timestamps must be compatible.

## Acceptance criteria

- [ ] `pnpm prisma migrate dev` runs cleanly
- [ ] `docker compose up openface3-worker` starts without error in CPU mode
- [ ] Manually enqueueing a job via `POST /api/openface3/jobs` for an existing `RecordingSegment` produces `EmotionFrame` rows with all 8 probabilities and a non-null `dominantEmotion`
- [ ] `GET /api/openface3/frames?sessionId=...` returns frames ordered by `frameWallMs`
- [ ] py-feat job processing for the same segment continues to work unchanged
- [ ] No teacher-facing UI yet — that's Stage 4

## Out of scope for Stage 1

- Sliding-window aggregation (Stage 3)
- Affective-state mapping logic (Stage 3)
- Teacher configuration UI (Stage 3)
- Teacher dashboard / charts (Stage 4)
- Frontend changes (Stage 2 handles the trigger; Stage 4 handles display)
