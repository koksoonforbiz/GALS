# GALS Monorepo — Tech Architecture

## Stack

| Layer                   | Tech                                                   |
| ----------------------- | ------------------------------------------------------ |
| Backend                 | NestJS + Prisma ORM                                    |
| Database                | PostgreSQL 16                                          |
| Cache / queue           | Redis                                                  |
| Object store            | MinIO (S3-compatible)                                  |
| Frontend                | React 18 + Vite + TypeScript + Tailwind CSS            |
| Router                  | React Router v6                                        |
| Realtime                | Socket.IO (dialogue chat)                              |
| Rich text               | TipTap (ProseMirror) for lesson editor                 |
| PDF rendering           | react-pdf (PDF.js → canvas)                            |
| Eye tracking            | WebGazer.js (in-browser, no SDK fee)                   |
| Facial analysis         | Py-Feat (Python worker) → emotion probs + Action Units |
| Detail face             | OpenFace3 (Python worker) — head pose, gaze            |
| Camera recording        | MediaRecorder → MP4 chunks → MinIO                     |
| LLM provider            | OpenAI (configurable; per-course API key)              |
| Container orchestration | Docker Compose for local dev                           |

## Top-level layout

```
GALS-milestone-1-monorepo/
├── apps/
│   ├── api/                     ← NestJS backend
│   │   ├── prisma/
│   │   │   ├── schema.prisma    ← single source of truth for DB
│   │   │   ├── migrations/      ← timestamp-prefixed SQL migrations
│   │   │   └── scripts/         ← ad-hoc maintenance (e.g. session-trim)
│   │   └── src/
│   │       ├── auth/            ← JWT issue + Bearer guard
│   │       ├── activity-log/    ← event spine (POST /activity-log/batch)
│   │       ├── logs/            ← high-frequency interaction streams
│   │       │                       (click/cursor/scroll/keystroke/
│   │       │                       clipboard/visibility/viewport/replay)
│   │       ├── webgazer/        ← gaze sample ingest
│   │       ├── pyfeat/          ← face-analysis jobs
│   │       ├── openface3/       ← OF3 jobs
│   │       ├── recording/       ← MP4 segment upload → MinIO
│   │       ├── learning-interventions/  ← 4 strategy generators + Q&A
│   │       ├── dialogue/        ← NotebookLM-style dialogue mode
│   │       ├── rag/             ← LLM client + retrieval
│   │       ├── text-mining/     ← EF construct detection on messages
│   │       └── ...
│   └── web/                     ← React frontend
│       ├── src/
│       │   ├── pages/
│       │   │   ├── student/     ← course view, dialogue, review queue
│       │   │   └── teacher/     ← course builder, student-logs (incl. Replay tab)
│       │   ├── components/
│       │   │   ├── FloatingChatbot/   ← floating + docked variant
│       │   │   ├── dialogue/          ← Sources / Chat / Studio / PDF panels
│       │   │   ├── editor/            ← TipTap-based block editor
│       │   │   └── PdfReader.tsx      ← slim react-pdf wrapper
│       │   ├── lib/
│       │   │   ├── interaction-log/   ← capture-side recorders + buffers
│       │   │   ├── webgazer/          ← calibration modal + sample sender
│       │   │   └── activity-log/      ← React context + track() API
│       │   └── contexts/
│       │       ├── AuthContext.tsx
│       │       ├── PageContext.tsx    ← global "what page is this?" metadata
│       │       └── ...
│       └── ...
└── docker-compose.yml           ← postgres / redis / minio / api / web
```

## Core domain models

```
User (student | teacher | admin)
 ├── Course (owned by teacher)
 │   ├── Module
 │   │   └── ModuleItem (PAGE | PDF | LINK | ASSESSMENT)
 │   └── SourceDocument (RAG corpus, uploaded PDFs)
 │
 ├── StudentSession   ← per-login activity session, anchor for all logs
 │   ├── activity_logs (event spine)
 │   ├── session_replay_snapshots (DOM + screenshot + AOIs)
 │   ├── session_sync_anchors (wall ↔ monotonic clock)
 │   ├── click_logs / scroll_logs / cursor_logs / keystroke_logs /
 │   │   clipboard_logs / visibility_logs / viewport_logs
 │   ├── webgazer_logs (gaze x/y/confidence)
 │   ├── pupil_size_logs
 │   ├── recording_segments → MinIO (MP4 chunks)
 │   │     └── pyfeat_jobs / openface3_jobs
 │   │         ├── pyfeat_au_results
 │   │         └── emotion_frames
 │   └── chatbot_messages (floating/docked chat history)
 │
 ├── DialogueSession (NotebookLM-style, can span StudentSessions)
 │   └── dialogue_messages
 │
 └── LearningIntervention (per selection)
     ├── type: PRACTICE_TESTING | INTERROGATIVE_ELABORATION |
     │         STEPWISE_LEARNING | DISTRIBUTED_PRACTICE
     ├── sessionData (JSON; shape varies by type)
     └── spaced_repetition_cards (DISTRIBUTED_PRACTICE only)

ef_detections — text-mining construct labels per chatbot/dialogue message
```

## Backend — request flow

```
Browser
  │  HTTPS (localhost:5173 → nginx-style proxy in dev)
  ▼
NestJS API (apps/api)
  │  JWT Bearer guard on protected routes
  │  Validated DTOs (Zod / class-validator)
  ▼
Service layer (per module)
  │  Prisma queries (parallelized where independent)
  ▼
PostgreSQL ← Redis (cache/session) ← MinIO (binary objects)
```

Notable backend patterns:

- **Single fan-out query** for the Replay tab: `LogsService.getSessionReplayData()` runs ~20 parallel Prisma queries after one sequential session fetch.
- **Defensive JSON sanitization** for high-frequency batches — strips `\x` byte-escape sequences Postgres' JSONB lexer rejects (`unexpected end of hex escape`).
- **Time-window joins with padding** for messages whose session id is ambiguous (dialogue across logins, chatbot session-id race).
- **forwardRef** for circular DI (LearningInterventions ↔ TextMining).

## Frontend — interaction-log capture spine

```
Student page mounts
  │
  ▼
ActivityLogProvider (root)
  │  track(action, meta) appends to in-memory buffer
  │  Flush every 30 s → POST /activity-log/batch
  │
  ├── useSessionReplayRecorder
  │   │  - Periodic 1 Hz DOM snapshot:
  │   │      serializeDocument() → cloneNode, sync inputs,
  │   │      inline canvas pixels (PDF), strip <script>,
  │   │      inject <base href>, capture AOI rects, screenshot
  │   │  - Triggers: periodic, pagehide, beforeunload, hidden,
  │   │              route change
  │   │  - Buffer → POST /logs/replay-snapshots in ≤3 MB chunks
  │   │  - keepalive: true on unload
  │   │
  │   └── captureScreenshot() via getDisplayMedia (optional)
  │
  ├── useInteractionLogger (mouse / scroll / click / visibility /
  │   keystroke / clipboard) — throttled, batched
  │
  ├── WebGazer pipeline (browser-only, ~10–30 Hz)
  │   → POST /webgazer/batch
  │
  └── MediaRecorder (camera + mic)
      → uploads ~30 s MP4 segments to /recording/segments
      → backend creates a recording_segment row →
         enqueues PyFeat job → emotion_frames + AU results
```

## Page surfaces (student-facing)

| Page                        | Layout                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| Course view (standard mode) | Sidebar (modules) · main (PAGE/PDF/LINK content) · docked chatbot — drag-resizable divider |
| Course view (dialogue mode) | Sources panel · chat panel · studio panel · PDF reader panel (NotebookLM style)            |
| Review queue                | Spaced-repetition cards due today                                                          |
| Assessments                 | Standalone assessment runner                                                               |

Layout containers are tagged with `data-replay-region` (`sidebar`, `lesson`, `pdf-viewer`, `chatbot`) for AOI capture.

## Page surfaces (teacher-facing)

- **Course builder** — drag-orderable modules, TipTap block editor for PAGE items, PDF upload for PDF items
- **Student logs** — per-student dashboard with several tabs; the **Replay** tab is the deepest (everything in the per-session summary I gave earlier)
- **Biometrics** — aggregate emotion / AU dashboards across sessions
- **Conversations** — chatbot + dialogue transcripts with EF-detection overlays
- **Settings** — per-course intervention prompt config, learning thresholds

## Async worker pipelines

```
MP4 segment uploaded
  → recording_segments row created (uploadStatus = 'PENDING')
  → PyFeat job enqueued
      → Python worker pulls MP4 from MinIO
      → runs face detection + emotion + AU extraction
      → writes emotion_frames (~5 Hz) + pyfeat_au_results
      → job status → 'COMPLETED' or 'FAILED'
  → (optionally) OpenFace3 job enqueued for head pose / detail gaze

Chatbot/Dialogue message persisted
  → TextMiningService scores against EF constructs
      (procrastination, off-task, metacognition, …)
  → ef_detections rows
```

## Sync clock & timeline alignment

A `session_sync_anchors` row written at session start captures `{ wallClockMs, monotonicMs, serverReceiveMs, timezone, userAgent }`. All replay computations derive `baseWallClockMs` from this anchor (with fallbacks: first snapshot, then `session.startedAt`). Cross-stream alignment uses absolute wall clock everywhere, with offsets only computed for display.

## Auth

- JWT Bearer tokens, stored in `localStorage` on the web client
- Sent as `Authorization: Bearer <token>` on every request
- Backend role guard distinguishes teacher / student / admin
- Per-course API key for LLM provider (teacher-supplied; encrypted in DB)

## Dev orchestration

```
sudo docker compose up -d
  ├─ postgres   (5432)
  ├─ redis      (6379)
  ├─ minio      (9000/9001)
  ├─ api        (3000) — start-dev.sh: prisma generate → prisma migrate deploy → nest start --watch
  └─ web        (5173) — Vite dev server, HTTPS via self-signed cert
```

Source folders are bind-mounted into the api/web containers, so HMR works without rebuilding the image. Prisma migrations run on every API start (idempotent — additive migrations only).

## Observability conventions

- `console.debug` for per-frame replay diagnostics (Verbose-gated)
- `console.warn` for "this is a real signal, look at it" events (sanitizer drops, AOI budget exceeded, snapshot truncation)
- Activity-log spine doubles as user-behavior telemetry — every meaningful page event has an `ActivityAction` enum entry and ends up queryable per session
- The Replay tab's "Coverage" panel surfaces per-source counts (snapshots, gaze, pupil, AU, fetched-vs-rendered messages with fallback-recovery indicator) so missing data is visible at a glance

## House conventions

- Prisma models mix two casing styles intentionally: PascalCase models map to snake_case columns via `@map`; lowercase models like `cursor_logs` use camelCase columns directly. Match what's around the code you're editing.
- Migrations are timestamp-prefixed (`YYYYMMDDhhmmss_name/migration.sql`), purely additive in production, never destructive without explicit user signoff.
- React state effects that touch iframes / canvases / external systems always have triple-defensive try/catch — "capture failure must never block a snapshot" is an invariant.
- High-frequency batches (cursor, scroll, click) include a hex-escape sanitizer + graceful-drop-on-Postgres-error so one malformed payload can't 500 the whole batch.
