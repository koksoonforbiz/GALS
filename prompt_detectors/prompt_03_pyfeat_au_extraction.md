# Feature Prompt 03 — py-feat Action Unit (AU) Extraction

## Context

You are extending the **Adaptive Tutoring System (ATS)** monorepo. Stack: NestJS 10 backend, React 18 frontend, PostgreSQL + Prisma, Redis, MinIO. The system captures student activity via `StudentSession` → `ActivityLog`.

This feature adds an **offline/asynchronous facial Action Unit (AU) extraction pipeline** using **py-feat**, run as a standalone Python microservice. It processes webcam video frames or short video clips captured from student sessions, extracts AU intensities (AU01–AU28 etc.), and logs the results for teacher review.

Reference: https://github.com/cosanlab/py-feat  
py-feat docs: https://py-feat.org/

---

## Feature Overview

- A **Python microservice** (`apps/pyfeat-worker/`) consumes processing jobs from a Redis queue
- Video frames/clips are uploaded to MinIO during the session (see Feature 04 for the recording pipeline — this service processes those files)
- Extracted AU data is stored in PostgreSQL and viewable in the Teacher Portal
- Teachers can configure: enable/disable per course, target FPS for extraction, which AUs to display
- The feature runs **asynchronously** — it does not affect real-time student experience

---

## Stage 1 — Database Schema (Prisma)

Add to `apps/api/prisma/schema.prisma`:

```prisma
model PyfeatConfig {
  id               String   @id @default(cuid())
  courseId         String   @unique
  course           Course   @relation(fields: [courseId], references: [id], onDelete: Cascade)
  isEnabled        Boolean  @default(false)
  extractionFps    Float    @default(1.0)   // frames per second to sample from video
  enabledAus       String[] @default([])    // e.g. ["AU01","AU04","AU06","AU07","AU12","AU17"]
  detectorBackend  String   @default("retinaface") // py-feat detector: retinaface | mtcnn | img2pose
  auPredictor      String   @default("xgb")        // py-feat AU predictor: xgb | svm | logistic
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

model PyfeatJob {
  id            String        @id @default(cuid())
  studentId     String
  student       User          @relation(fields: [studentId], references: [id], onDelete: Cascade)
  sessionId     String
  session       StudentSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  courseId      String
  course        Course        @relation(fields: [courseId], references: [id], onDelete: Cascade)
  status        PyfeatJobStatus @default(PENDING)
  sourceMinioKey String       // path to source video in MinIO
  resultMinioKey String?      // path to output CSV in MinIO
  error         String?
  startedAt     DateTime?
  completedAt   DateTime?
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  auResults     PyfeatAuResult[]
}

enum PyfeatJobStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

model PyfeatAuResult {
  id          String    @id @default(cuid())
  jobId       String
  job         PyfeatJob @relation(fields: [jobId], references: [id], onDelete: Cascade)
  frameIndex  Int       // frame number within the clip
  timestamp   Float     // seconds from clip start
  wallTime    DateTime  // synchronised wall clock timestamp
  au01        Float?
  au02        Float?
  au04        Float?
  au05        Float?
  au06        Float?
  au07        Float?
  au09        Float?
  au10        Float?
  au12        Float?
  au14        Float?
  au15        Float?
  au17        Float?
  au20        Float?
  au23        Float?
  au24        Float?
  au25        Float?
  au26        Float?
  au28        Float?
  // Add further AUs as needed
  faceConf    Float?    // py-feat face detection confidence
  faceBox     Json?     // bounding box {x, y, w, h}
  createdAt   DateTime  @default(now())
}
```

- Run `pnpm prisma migrate dev --name add_pyfeat_au_extraction`
- Add back-relations on `User`, `StudentSession`, `Course`.

---

## Stage 2 — Python Microservice (`apps/pyfeat-worker/`)

### Directory Structure

```
apps/pyfeat-worker/
  main.py               # Entry point — poll Redis queue
  processor.py          # Core AU extraction logic
  db.py                 # PostgreSQL writes via psycopg2 or asyncpg
  minio_client.py       # MinIO download/upload helpers
  requirements.txt
  Dockerfile
  .env.example
```

### `requirements.txt`

```
feat>=0.5.0
torch>=2.0.0
torchvision>=0.15.0
opencv-python-headless>=4.8.0
redis>=5.0.0
psycopg2-binary>=2.9.0
minio>=7.2.0
python-dotenv>=1.0.0
numpy>=1.24.0
pandas>=2.0.0
```

### `main.py` — Queue Consumer

```python
"""
Polls Redis list key: 'pyfeat:jobs'
Each job is a JSON object:
{
  "jobId": str,
  "studentId": str,
  "sessionId": str,
  "courseId": str,
  "sourceMinioKey": str,
  "extractionFps": float,
  "enabledAus": list[str],
  "detectorBackend": str,
  "auPredictor": str,
  "clipStartWallTime": str  // ISO8601 wall time of the first frame
}
"""
```

- Use `BLPOP` with a 5-second timeout to block-wait on the queue (no busy polling).
- On job receipt: update `PyfeatJob.status = PROCESSING`, `startedAt = now()` in PostgreSQL.
- Call `processor.process_job(job)`.
- On success: update `status = COMPLETED`, `completedAt = now()`, `resultMinioKey`.
- On exception: update `status = FAILED`, `error = str(exception)`.
- Run N worker threads (configurable via `WORKER_CONCURRENCY` env var, default 2).

### `processor.py` — Core Logic

```python
from feat import Detector

def process_job(job: dict) -> None:
    """
    1. Download video from MinIO to a temp file
    2. Extract frames at job['extractionFps']
    3. Run py-feat Detector on extracted frames
    4. Build PyfeatAuResult rows with synchronised wall timestamps
    5. Bulk-insert rows into PostgreSQL
    6. Write results CSV to MinIO
    7. Clean up temp files
    """
```

**Frame extraction logic**:
```python
import cv2
import numpy as np

cap = cv2.VideoCapture(temp_video_path)
native_fps = cap.get(cv2.CAP_PROP_FPS)
sample_every = max(1, round(native_fps / job['extractionFps']))

frames = []
frame_indices = []
idx = 0
while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break
    if idx % sample_every == 0:
        frames.append(frame)
        frame_indices.append(idx)
    idx += 1
cap.release()
```

**py-feat detection**:
```python
detector = Detector(
    face_model=job['detectorBackend'],
    au_model=job['auPredictor'],
    emotion_model="resmasknet",
    identity_model=None,
)

# Write frames to a temp directory as images
# py-feat can process a list of image paths
result_df = detector.detect_image(frame_paths)
```

**Wall time synchronisation**:
```python
clip_start = datetime.fromisoformat(job['clipStartWallTime'])
for i, (frame_idx, row) in enumerate(result_df.iterrows()):
    seconds_offset = frame_idx / native_fps
    wall_time = clip_start + timedelta(seconds=seconds_offset)
    # build PyfeatAuResult row
```

**Output CSV columns**:
```
jobId,studentId,sessionId,frameIndex,timestamp,wallTime,AU01,AU02,AU04,...,AU28,faceConf
```

Upload to MinIO at: `pyfeat/{studentId}/{sessionId}/{jobId}_au_results.csv`

---

## Stage 3 — Backend: NestJS Module (`apps/api/src/pyfeat/`)

```
apps/api/src/pyfeat/
  pyfeat.module.ts
  pyfeat.controller.ts
  pyfeat.service.ts
  dto/
    pyfeat-config.dto.ts
    enqueue-job.dto.ts
```

### `pyfeat.service.ts` — Methods

```typescript
getConfig(courseId: string): Promise<PyfeatConfig>
updateConfig(courseId: string, dto: PyfeatConfigDto): Promise<PyfeatConfig>

// Called by the webcam recording feature (Feature 04) when a clip is ready
enqueueJob(dto: EnqueueJobDto): Promise<PyfeatJob>
  // 1. Create PyfeatJob in DB with status=PENDING
  // 2. Push JSON job payload to Redis list 'pyfeat:jobs' using RPUSH

getJobs(studentId: string, courseId: string): Promise<PyfeatJob[]>
getJobResults(jobId: string): Promise<PyfeatAuResult[]>
exportJobCsv(jobId: string): Promise<string> // presigned MinIO URL
getConfig(courseId: string): Promise<PyfeatConfig>
```

### `pyfeat.controller.ts` — REST Endpoints

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/pyfeat/config/:courseId` | teacher | Get config |
| PATCH | `/pyfeat/config/:courseId` | teacher | Update config |
| POST | `/pyfeat/jobs` | system/internal | Enqueue a job (called internally by session recording feature) |
| GET | `/pyfeat/jobs/:studentId/:courseId` | teacher | List jobs |
| GET | `/pyfeat/jobs/:jobId/results` | teacher | Get AU results for job |
| GET | `/pyfeat/jobs/:jobId/export` | teacher | Export results CSV |

---

## Stage 4 — Frontend: Teacher Portal Settings

### `PyfeatSettings.tsx`

Location: `apps/web/src/components/teacher/biometrics/PyfeatSettings.tsx`

Mount in the **Biometrics** tab of `CourseBuilderPage`.

**Fields**:

| Field | Type | Description |
|-------|------|-------------|
| Enable py-feat | Toggle | Master on/off per course |
| Extraction FPS | Slider (0.5–5.0, step 0.5) | Frames per second to sample |
| Detector backend | Select | retinaface / mtcnn / img2pose |
| AU predictor | Select | xgb / svm / logistic |
| Enabled AUs | Multi-checkbox | Select which AUs to display in viewer (AU01, AU04, AU06, AU07, AU12, AU17, AU25, AU26 pre-checked) |

Tooltip on "Extraction FPS": *"Higher FPS increases processing time. 1 FPS is recommended for most use cases."*

### `PyfeatLogViewer.tsx`

Location: `apps/web/src/components/teacher/biometrics/PyfeatLogViewer.tsx`

Mount in `StudentLogPage` under the **Biometrics** tab.

**Sections**:

1. **Job List Table**:
   - Columns: Session ID, Created At, Status (badge: PENDING / PROCESSING / COMPLETED / FAILED), Actions
   - Status auto-refreshes every 10 seconds while any job is PENDING/PROCESSING (poll `GET /pyfeat/jobs/:studentId/:courseId`)

2. **AU Timeline (for a selected completed job)**:
   - recharts `LineChart` or `AreaChart`
   - X-axis: wallTime (formatted as HH:mm:ss)
   - Y-axis: AU intensity (0–5 or 0–1 depending on predictor)
   - One line per selected AU (use distinct colours)
   - Legend showing AU labels (e.g. "AU06 — Cheek Raiser", "AU12 — Lip Corner Puller")
   - Show a reference table mapping AU codes to FACS descriptions

3. **AU Heatmap Grid** (optional enhancement):
   - A grid showing mean AU intensity per time bin (rows = AUs, columns = time buckets)
   - Colour scale: low=white, high=red

4. **Export CSV button**: calls `GET /pyfeat/jobs/:jobId/export`

---

## Stage 5 — Shared Zod Schemas (`packages/shared/src/`)

```typescript
// pyfeat.schema.ts
export const PyfeatConfigSchema = z.object({
  isEnabled: z.boolean(),
  extractionFps: z.number().min(0.5).max(5.0),
  enabledAus: z.array(z.string()),
  detectorBackend: z.enum(['retinaface', 'mtcnn', 'img2pose']),
  auPredictor: z.enum(['xgb', 'svm', 'logistic']),
});

export const EnqueueJobSchema = z.object({
  studentId: z.string(),
  sessionId: z.string(),
  courseId: z.string(),
  sourceMinioKey: z.string(),
  clipStartWallTime: z.string().datetime(),
});
```

---

## Stage 6 — Docker Compose Integration

Add to `docker-compose.yml` (or create `docker-compose.pyfeat.yml`):

```yaml
pyfeat-worker:
  build:
    context: ./apps/pyfeat-worker
    dockerfile: Dockerfile
  environment:
    - REDIS_URL=redis://redis:6379
    - DATABASE_URL=postgresql://user:pass@postgres:5432/ats
    - MINIO_ENDPOINT=minio
    - MINIO_PORT=9000
    - MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}
    - MINIO_SECRET_KEY=${MINIO_SECRET_KEY}
    - MINIO_BUCKET=ats-data
    - WORKER_CONCURRENCY=2
  depends_on:
    - redis
    - postgres
    - minio
  restart: unless-stopped
  deploy:
    resources:
      limits:
        memory: 4G  # py-feat models are large
```

### `Dockerfile`

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# System deps for OpenCV
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download py-feat models at build time
RUN python -c "from feat import Detector; Detector(face_model='retinaface', au_model='xgb')"

COPY . .

CMD ["python", "main.py"]
```

---

## Stage 7 — ActivityLog Integration

```typescript
PYFEAT_JOB_ENQUEUED    = 'PYFEAT_JOB_ENQUEUED',
PYFEAT_JOB_COMPLETED   = 'PYFEAT_JOB_COMPLETED',
PYFEAT_JOB_FAILED      = 'PYFEAT_JOB_FAILED',
```

Emit `PYFEAT_JOB_ENQUEUED` from `PyfeatService.enqueueJob()` with metadata `{ jobId, sessionId }`.

---

## Testing Checklist

- [ ] Python worker starts and polls Redis successfully
- [ ] A test job with a sample MP4 file completes and inserts AU results in DB
- [ ] CSV is uploaded to MinIO with correct path
- [ ] NestJS `enqueueJob` pushes a valid JSON payload to Redis
- [ ] Job status transitions: PENDING → PROCESSING → COMPLETED
- [ ] Failed jobs update status and error field
- [ ] Teacher toggle enables/disables per course
- [ ] FPS slider persists and is used in job payload
- [ ] Log viewer shows job list with live status refresh
- [ ] AU timeline chart renders when a COMPLETED job is selected
- [ ] CSV export is downloadable and contains expected AU columns

---

## Key Notes

- **py-feat models are large (~300 MB–1 GB)**. Pre-download in Docker build step to avoid cold-start delays.
- **GPU acceleration**: If a GPU is available, py-feat will use it automatically via PyTorch. Document GPU requirements in `README`.
- **No real-time AU extraction in browser** — this is entirely offline/async to avoid performance impact.
- **FACS reference table** to include in the UI:
  - AU01 Inner Brow Raise, AU02 Outer Brow Raise, AU04 Brow Lowerer, AU05 Upper Lid Raiser, AU06 Cheek Raiser, AU07 Lid Tightener, AU09 Nose Wrinkler, AU10 Upper Lip Raiser, AU12 Lip Corner Puller, AU14 Dimpler, AU15 Lip Corner Depressor, AU17 Chin Raiser, AU20 Lip Stretcher, AU23 Lip Tightener, AU24 Lip Pressor, AU25 Lips Part, AU26 Jaw Drop, AU28 Lip Suck
