# GALS Platform — Tech Architecture Report

**Report date:** 2026-07-02
**Basis:** Latest state of the repository, taken from branch `KianYu` (commit `58bcc8f`, 2026-07-01) — by far the most advanced branch (+47k lines / 213 files vs. the default `milestone-1-monorepo`). Cross-checked against `milestone-1-monorepo` and the `claude/*` feature branches.

---

## 1. Executive summary

GALS is an **AI-powered adaptive tutoring platform** with an unusually heavy **multimodal learning-analytics** layer bolted on. Internally the codebase is named the *Adaptive Tutoring System* (`adaptive-tutoring-system`, `@ats/*`). It has grown into **two related products** living in one Git repo:

1. **The live learning platform** (`apps/`, `packages/`) — students take courses, are assessed (auto-graded), receive four evidence-based learning interventions and an LLM tutor, and the whole session is instrumented (cursor, keystroke, gaze, pupil, webcam → facial affect, DOM/screenshot replay).
2. **GALS Studio** (`gals-studio/` + `tools/gals-export/`) — a **separate, offline, single-machine research application** for replaying recorded sessions and having human coders label affect / executive-function / behavior on top of them, then computing inter-rater reliability and affect/attention analytics. Data crosses from platform → Studio via **portable "session bundles"**, never a shared DB.

The platform is a **pnpm + Turborepo monorepo** with a NestJS API, a React/Vite web app, and **three Python workers** (grading, py-feat facial action units, OpenFace 3.0 emotion). Postgres is the system of record (~94 Prisma models), Redis handles rate-limiting + facial-worker job queues, and MinIO (S3) holds all blobs (drawings, webcam video, DOM snapshots).

```
                        ┌─────────────────────────── LIVE PLATFORM ───────────────────────────┐
  Student browser  ───► apps/web (React/Vite)  ──REST/WS──►  apps/api (NestJS)
    - lessons/PDF                                              │  ├─ Postgres 16 (94 models)
    - assessments                                              │  ├─ Redis 7 (throttle + queues)
    - LLM tutor + 4 interventions                              │  └─ MinIO (blobs)
    - emotion self-report (15m)                                │
    - INSTRUMENTATION:                                         ├──► apps/worker (FastAPI): answer-key grading + KC mastery
      cursor/click/scroll/key                                  ├──► apps/pyfeat-worker: facial Action Units (py-feat)
      gaze (WebGazer/WebEyeTrack)                              └──► apps/openface3-worker: 8-emotion frames (OpenFace 3.0)
      pupil, webcam→MinIO
      DOM+screenshot replay        Teacher/Researcher ──► ReplayTab, biometrics, text-mining dashboards
                        └──────────────────────────────────────────────────────────────────────┘
                                        │  (analysis/*.py: backup + multimodal_sync + export)
                                        ▼
                        tools/gals-export ── portable session bundle (zip) ──►  ┌──── GALS STUDIO (offline) ────┐
                        reads live Postgres + MinIO                              │ studio-server (Fastify+SQLite) │
                                                                                 │ studio-web (React): replay,    │
                                                                                 │  window/timeline coding,       │
                                                                                 │  reliability + affect analytics│
                                                                                 │ Electron desktop wrapper       │
                                                                                 └────────────────────────────────┘
```

---

## 2. Repository & monorepo tooling

- **Package manager:** `pnpm@10.28.2`, Node ≥ 20. **Build orchestration:** Turborepo (`turbo.json` — `build` fans out on `^build`, `dev` is persistent/uncached, `test`/`lint`/`typecheck` depend on upstream builds).
- **Workspaces** (`pnpm-workspace.yaml`): `apps/*` + `packages/*`.
  - `apps/`: `api`, `web`, `worker`, `pyfeat-worker`, `openface3-worker`.
  - `packages/`: `shared` (`@ats/shared`), `config` (`@ats/config`).
- **Outside the workspace** (deliberately independent): `gals-studio/` (its own npm-workspaces monorepo) and `tools/gals-export/`.
- **TypeScript baseline** (`tsconfig.base.json`): ES2022, `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`, declaration + source maps.
- **Quality gates:** shared ESLint + Prettier via `@ats/config`; Husky + lint-staged pre-commit; CI on GitHub Actions.
- **Root docs of note:** `README.md`, `LLM_AUDIT.md`, `LLM_VERIFICATION.md`, `docs/rag/AUDIT.md`, `text-mining-recon.md`, and the `00_OVERVIEW.md`–`06_*.md` design series for GALS Studio.

---

## 3. API backend — `apps/api` (NestJS)

- **Stack:** NestJS 10 on Express, TypeScript 5.5, Prisma 6.19, Zod validation, `@nestjs/jwt` + `passport-jwt`, `@nestjs/throttler`, `ioredis`, Socket.IO, AWS S3 SDK (MinIO). Entry `src/main.ts` (global prefix `/api`, 12 MB body limits for base64 snapshot payloads, global exception filter, `rawBody: true`).
- **Env** validated at boot via Zod (`src/env.ts`) — `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` (≥16 chars), `BLOB_STORAGE_*`. Process exits on invalid config.
- **~45 feature modules.** Domains:
  - **Core LMS:** `courses`, `topics`, `modules`, `page-content` (versioned block content + multimodal PDF page-content gen), `course-structure`, `enrollments`, `publish-gate`.
  - **Assessment & grading:** `questions`, `assessments`, `question-generation`, `attempts`, `grading` (WS gateway + poller), `evaluation` (per-page LLM content eval + deterministic math normalizer).
  - **Knowledge components / curriculum:** `kc`, `kc-evaluation`, `curriculum-coverage`, `knowledge-version`, `mastery`.
  - **RAG / LLM:** `rag` (teacher corpus), `student-rag` (per-student corpus + auto study guide), `llm` (model registry), `vlm` (vision config), `pre-generation`, `blob`.
  - **Learning / dialogue:** `learning-interventions` (4 interventions + spaced-rep + chatbot), `dialogue` (NotebookLM-style Dialogue-Based Learning + studio outputs), `dialogue-notes`, `chat-history`.
  - **Telemetry / affect:** `activity-log`, `logs`, `recording`, `pupil-size`, `webgazer`, `pyfeat`, `openface3`, `affective-mapping`, `analytics`, `replay-annotations`, `text-mining`.
  - **Infra:** `prisma`, `event-bus`, `auth` (global), `user-management`, `jobs`.

### Auth & security
- **JWT + Passport**; `jwt.strategy.ts` re-loads the user (fresh role) on every request; tokens `expiresIn: 24h`. `RolesGuard` + `@Roles(...)` gate by `student|teacher|admin`.
- **Students never self-set passwords** — teacher/admin-issued resets only; no forgot-password flow.
- **Rate limiting:** global 30 req/min via `ThrottlerModule` backed by a **custom Redis storage** (`common/throttle-redis.storage.ts`); per-route overrides (register 5/min, login 10/min).
- **Teacher LLM API keys** are **AES-256-GCM encrypted at rest** (`User.encryptedApiKey`, `User.cohereApiKey`), key derived via scrypt from `JWT_SECRET`.

### Real-time (Socket.IO) — three gateways
- Default namespace: `grading.gateway.ts` — student rooms, emits `grade_completed`.
- `dialogue` namespace: streaming chat (`message_chunk`/`message_complete`) + document-processing progress.
- `text-mining` namespace: `ef.detection.created` / `ef.detection.batch.completed`.

---

## 4. Database — PostgreSQL via Prisma (~94 models)

Single Postgres 16 database, `apps/api/prisma/schema.prisma` (~2.5k lines, 60+ additive migrations Jan–Jul 2026). Major clusters:

| Cluster | Representative models |
|---|---|
| **Identity & courses** | `User` (roles + encrypted LLM keys + provider/model prefs), `Course` (STANDARD vs DIALOGUE mode, `dblSettings`), `Topic`, `Enrollment`, `CourseModule`, `ModuleItem`, `PageContentVersion` |
| **Assessment / grading** | `Question` (text/MCQ_SINGLE/MCQ_MULTI/STRUCTURED), `Assessment`, `AssessmentQuestion`, `Attempt`, `GradingResult` (Hattie feedback), `EventQueue` (Postgres job queue) |
| **Knowledge / mastery** | `KnowledgeComponent`, `QuestionKc`, `KcEvidence`, `UserMastery` (BKT-ready: pLearn/pGuess/pSlip/pTransit), `ProposedKC`, `KcEdge` (prereq graph), `KcContentMapping`, `KnowledgeVersion`, `KcEvaluationRun`, `CurriculumCoverageRun`, `PublishGateRun` |
| **RAG corpora** | Teacher: `SourceDocument`→`DocumentChunk` (JSONB embeddings, per-chunk model/dim pinning, `contextualText`, multimodal `page_image` chunks, `openaiFileId`). Student: `StudentSourceDocument`→`StudentRagChunk`, `StudentSourceGuide` |
| **Dialogue / chat** | `DialogueSession`, `DialogueMessage`, `StudioOutput`, `DialogueNote`, `ChatbotMessage` |
| **LLM tracking** | `LlmUsageLog` (tokens + USD, text/image modality), `LlmAuditLog`, `LlmModelPricing` (effective-dated), `LlmGenerationJob`, `ContentDraft` |
| **Interventions** | `LearningIntervention` (4 types), `SavedInterventionReview`, `InterventionPromptConfig` (custom prompts + default MCQ/short-answer counts), `SpacedRepetitionCard` (SM-2), `FeedbackPromptConfig`/`CourseFeedbackSetting` |
| **Session capture / biometrics** | `StudentSession`, `ActivityLog` (+typed `ActivityAction` incl. `EMOTION_SELF_REPORT`), `SessionSummary`; `RecordingConfig`/`Segment`/`Consent`; `PupilSize*`; `Webgazer*`; `Pyfeat*`/`PyfeatAuResult`; `Openface3Job`/`EmotionFrame`; `AffectiveMappingConfig`/`AffectiveStateWindow` |
| **Raw interaction logs** (BigInt ms) | `cursor_logs`, `click_logs`, `scroll_logs`, `keystroke_logs`, `visibility_logs`, `clipboard_logs`, `viewport_logs`, `performance_logs`, `error_logs` |
| **Sync / derived / replay** | `session_sync_anchors`, `modality_offsets`, `aligned_frames`, `derived_engagement/cognitive_load/emotion_timeline/learning_velocity/at_risk_flags`, `SessionReplaySnapshot`, `ReplayCode`, `ReplayAnnotation` |
| **Text-mining (EF)** | `EfDetection`, `EfConstructPrompt`, `EfTeacherSettings` |

---

## 5. LLM & RAG subsystem

The single most-invested area. Documented in three root audits (`LLM_AUDIT.md`, `LLM_VERIFICATION.md`, `docs/rag/AUDIT.md`).

- **Central funnel:** `apps/api/src/rag/llm.service.ts` — `callLlmForUser()` / `callLlmStructured()` take a normalized request (system + messages, `jsonMode`/`jsonSchema`, `maxTokens`, `temperature`) and dispatch by resolved model. Supports multimodal parts (text, OpenAI Files `file_id` / inline base64, `image_url` data-URLs translated to Gemini `inlineData`).
- **Registry-driven models:** `apps/api/src/llm/model-registry.ts` is the source of truth.
  - **Chat OpenAI:** `gpt-5.5` (reasoning), `gpt-5.4-mini` (default), `gpt-5.4-nano`, `gpt-4.1`, `gpt-4o`/`4o-mini` (deprecated). **Chat Gemini:** `gemini-3.5-flash` (default), `gemini-3.1-pro`, `gemini-3.1-flash-lite`, `gemini-2.5-flash` (deprecated), `gemini-2.0-flash` (retired).
  - **Embedding:** OpenAI `text-embedding-3-small/large`, Gemini `gemini-embedding-001`, **Cohere `embed-v4.0`** (multimodal text+image). **Rerank:** Cohere `rerank-v3.5`.
  - Per-model **capability flags** drive request shape: `supportsTemperature`, `maxTokensParam` (`max_completion_tokens` vs `max_tokens`), `supportsJsonMode`, `geminiThinkingParam` (`thinking_level`/`thinking_budget`), `supportsOpenAiFilesApi`. Read-time guards substitute defaults for retired/unknown models; save-time asserts reject cross-provider/retired picks.
  - Raw `fetch` to OpenAI/Gemini HTTP APIs (no SDK). No-key path falls back to a deterministic `template` generator.
- **Provider upgrade (Stage 1–4, `LLM_VERIFICATION.md`):** 41 unit tests verify every feature works across OpenAI/Gemini × default/reasoning/legacy bands without live calls. **Known debt:** `LLM_AUDIT.md` catalogs 27 chat call sites — **7 bypass the funnel** (OpenAI-only: `page-content`, `evaluation`, `kc-graph`, etc.) and there are 17 hard-coded model strings.
- **RAG pipeline** (`rag.service.ts`, `student-rag/`):
  - Ingest → MinIO blob → async `chunkDocument` (in-memory progress map, **no queue/retry across restarts**). PDF text via `pdf-parse`; recursive/paragraph chunker (~1500-char ceiling).
  - Optional **contextual retrieval** (per-chunk blurb prepended before embedding, Anthropic-style). **Multimodal PDF**: rasterize pages → PNG to MinIO → Cohere Embed-4 image embeddings + VLM captions → `page_image` chunks.
  - Retrieval: **hybrid** dense cosine over JSONB vectors + optional Cohere cross-encoder rerank, with keyword fallback and strict `[N]` citation validation. Dimension-mismatch guard refuses to cosine across mixed embedding dims.
  - Per-teacher token/USD accounting into `LlmUsageLog` via `llm-cost-calculator.ts` against `LlmModelPricing`.

---

## 6. Web frontend — `apps/web` (React 18 + Vite)

- **Stack:** React 18.3 (StrictMode), Vite 5.4, TS 5.5 strict, **Tailwind v4**, React Router v6, `lucide-react`. **State = React Context only** (no Redux/Zustand). **Data = hand-rolled `fetch`** wrapper (`lib/api.ts`) — **no React Query/SWR** (manual caching/refetch). Realtime via `socket.io-client` singleton. Deployed behind nginx.
- **Auth:** localStorage JWT (`Bearer`) + `X-Session-Id` header; hard `window.location` redirect on 401 — **except background biometric paths**, which are exempted so telemetry flushes survive logout.
- **Content rendering:** block-editor renderer + MDX (`@mdx-js`), markdown (`react-markdown` + remark/rehype), math (`katex`), code highlighting, PDFs (`react-pdf` + `pdfjs-dist`). Lesson panels are tagged `data-replay-region` for AOI capture.
- **Student features:** course/lesson viewer (`StudentCourseViewPage`), assessments (text + MCQ; grading arrives async over WS), and four LLM **learning-strategy interventions** — **Practice Testing**, **Distributed Practice** (SM-2 flashcards + review queue), **Stepwise Learning**, **Interrogative Elaboration** — surfaced through a floating/docked chatbot. **Dialogue-Based Learning** (`DialogueLearning.tsx`, ~1.3k lines): sources/chat/studio/notes/mind-map panels with streaming. **Emotion self-report survey** (`EmotionSurveyModal`) every 15 min and forced on logout (non-dismissible; logged as `EMOTION_SELF_REPORT`).
- **Teacher/researcher features:** course authoring (TipTap + block editor + versioning), KC/curriculum tooling (graph, mapping, coverage, publish gate), question generation, AI settings, user/bulk provisioning, and the **session-log/replay viewer** (`pages/teacher/student-logs/`) whose `ReplayTab.tsx` (~3.8k lines) reconstructs sessions from DOM/screenshot snapshots with gaze-AOI overlays, coverage scoring, annotations, and CSV export. Plus OpenFace3 emotion-timeline and text-mining (EF) dashboards.

### Client-side instrumentation (the standout)
Three parallel pipelines + a biometrics suite, all clock-synced to a wall-clock / `performance.now()` anchor:
1. **Interaction logger** — cursor (100 ms throttle), clicks, scroll, keystroke *metrics only* (count/pause/WPM — no content), visibility, clipboard *lengths*, viewport, JS errors; batched, `keepalive`-flushed.
2. **Session-replay recorder** — periodic screenshots (~3 s via `getDisplayMedia`→canvas→JPEG) + optional full DOM serialization (currently off to save storage), AOI rects, scroll-host state, PDF page anchors; password redaction; size caps.
3. **Semantic activity log** — coarse meaningful events; session open/close lifecycle.
4. **Biometrics** (consent-gated, `PermissionGate`): **gaze** via WebGazer *or* WebEyeTrack (per-course, 10 Hz), **pupil size** (canvas image-processing, 2 Hz), **webcam recording** (`MediaRecorder` VP9/VP8 webm → presigned MinIO PUT, rotate at 50 MB). Facial AU/emotion extraction runs **server-side** on the recorded segments.

---

## 7. Python workers

### `apps/worker` — grading (FastAPI)
- FastAPI + Uvicorn; only `GET /health`. **Pulls work from Postgres** `event_queue` (topic `grade_submission`) every 2 s via `UPDATE ... FOR UPDATE SKIP LOCKED` (raw `psycopg2`) — **not** Redis.
- Grading is **deterministic answer-key matching** (no LLM here): lowercase/trim vs `rubricJson.answer_key`. On completion it inserts `GradingResult`, updates attempt status, and updates **KC mastery** via EMA on `probability_known` (α=0.3), appends `kc_evidence`, upserts `user_mastery`, then publishes `grade_completed`.

### `apps/pyfeat-worker` — facial Action Units (py-feat)
- **Redis queue consumer** (`BLPOP pyfeat:jobs`, 2 concurrent threads). Downloads webm from MinIO, samples frames (OpenCV, timestamp-based) at `extractionFps`, runs `feat.Detector` (retinaface + XGB AU + resmasknet emotion), maps `AU01..AU28`→DB columns, bulk-inserts `pyfeat_au_results`, writes a results CSV back to MinIO.
- **Hardening (recent):** `_safe_float` nulls non-finite values, FPS clamps guard bad webm metadata, `face_box` NaN/Inf rejection before the Postgres JSON insert; **pins** `kornia==0.7.1`, `torch==2.1.2`, `py-feat==0.5.1`, `numpy==1.26.4`; models baked at Docker build.

### `apps/openface3-worker` — 8-emotion frames (OpenFace 3.0, real inference)
- **Redis queue consumer** (`openface3:jobs`) + 15 s heartbeat key. Loads real weights (`Alignment_RetinaFace.pth`, `MTL_backbone.pth`); `MultitaskPredictor.predict` returns emotion/gaze/AU but only **emotion logits** are used → softmax over 8 AffectNet categories → `emotion_frames` (dominant emotion + probabilities). Remuxes webm→mp4 via ffmpeg (cv2 chokes on MediaRecorder webm). Faces-not-found are honestly recorded as `face_detected=false` (not padded). CPU by default; GPU reservation prepared but commented out.

### `analysis/` scripts (offline)
- `multimodal_sync.py` — loads every modality for a session, applies per-modality clock offsets, builds a **per-video-frame master table** (`aligned_master.csv`) fusing gaze × pupil × AUs × cursor/scroll/click/visibility × interventions × attempts (`merge_asof`/interp/window-mean). Query helpers for AU spikes and before/after-intervention comparisons.
- `export_logs.py` — exports all per-session tables to CSV/JSONL (`raw/events/derived/aligned/sync/`) + manifest, uploads to MinIO bucket `log-exports`.
- `backup_all_sessions.py` — daily cron; tracks exported sessions in a local SQLite, exports every finished session.

---

## 8. GALS Studio — offline research app (`gals-studio/` + `tools/gals-export/`)

The newest and largest addition. An **independent, offline, single-machine** app: no cloud, no auth, no shared DB. Data arrives only as **portable session bundles**.

### 8.1 The session bundle (the contract) — `tools/gals-export`
- **Exporter** CLI (`gals-export`) reads the **live Postgres + MinIO directly** (reuses the live Prisma schema in `tools/gals-export/prisma/schema.prisma`; the Nest app need not run). Streams JSONL row-by-row with sha256 hashing so 65k+ row streams never fully load into memory; one failing stream logs a warning and writes an empty file rather than aborting.
- **Bundle layout** (`session_<id>/`, optional zip, spec in `BUNDLE_SPEC.md`, version 1):
  - `manifest.json` (versions, `baseWallClockMs`, `durationMs`, per-stream counts, per-file `{sha256, byteSize}`).
  - `session.json` (session row + sync anchor + display context; credentials/email/IP stripped).
  - `streams/*.jsonl` (webgazer, pupil, emotion_frames, au_results, clicks, scrolls, cursors, keystrokes, clipboard, visibility, viewport, activity — every record carries absolute `wallMs`).
  - `snapshots/` (index + verbatim `.html` + decoded `.jpg`), `webcam/` (index + `.webm`; missing MinIO blobs marked `status:"missing"`), `messages/` (chatbot, dialogue, interventions, **ef_detections**), `kc/`, optional `probes/` + `questionnaires/`, `annotations/` (carried-over reference labels, read-only in Studio).
  - Single time anchor `baseWallClockMs`; reading progress derived from `scrollHosts`/`pdfCurrentPage`, **never window `scrollY`**.

### 8.2 Studio server — Fastify + Prisma + **SQLite**
- Its own monorepo (`gals-studio/`, npm workspaces): `apps/studio-server`, `apps/studio-web`, `apps/desktop` (Electron), `packages/shared`.
- **SQLite schema** splits into two halves:
  - **Ingested** (mirrors the bundle, FK-cascade off `Session`, wiped on re-import): gaze/pupil/emotion/AU samples, interaction streams, `Snapshot`, `WebcamSegment`, chat/dialogue/intervention/`EfDetection`, mastery/cards/attempts, probes/questionnaires.
  - **Coding/analysis** (string-keyed, *not* FK-bound to Session, so they **survive re-import** — the platform's durability guarantee): `Coder`, `CodebookVersion` (locked, forked on edit), `CodingWindow` (20 s), `Annotation` (with `machineGuess`), `CarriedAnnotation`, `ReliabilityRun`, `SessionAoi`, `SessionTrim`, `UtteranceCoding`.
- **Importer** is idempotent: re-import deletes only that session's ingested cascade + media, batch-inserts streams, and regenerates 20 s `CodingWindow`s; questionnaires scored on import.
- **Routes:** `library`, `import`, `media` (path-traversal-guarded static), `replay` (decimated streams, snapshots, sparse events, PDT coverage), `coding` (codebook/coders/annotations/AOIs/trim/disagreements/derive-gold/EF-codings/utterance-CSV), `analysis` (reliability/dynamics/attention/reading/ground-truth/export/runs), `analysisSummary` (cohort/text-mining), `backup`.

### 8.3 Studio web — replay, coding, analytics (React/Vite)
- **Dual-pane synced replay** (`pages/Replay.tsx`): DOM iframe *or* screenshot "pixels" toggle + webcam `<video>` on a shared playhead, gaze/AOI overlays, signal strips.
- **Window coding studio** (`pages/Coding.tsx`): retrospective cued-recall coding of fixed **20 s windows** (±5 s buffer). Hierarchical codebook (AFFECT / BEHAVIOR / EF EVENT / MOTIVATION) with a full **keyboard shortcut** map (target 3–5 s/code). Multi-coder passes (`primary_rater_1/2`, `tiebreaker`), disagreement queue, tiebreaker side-by-side compare + **gold-consensus** derivation. Timing captured (`codingMs`).
- **Timeline coding studio** (`pages/TimelineCoding.tsx`, ~2.7k lines): video-editor timeline with cursor-anchored zoom (1×–512×), multi-lane tracks, **free-range interval coding**, **model-guess accept/override** (pre-filled machine affect/activity), session **trim**, researcher-drawn AOIs with gaze-dwell %, per-utterance + EF-detection coding.
- **Analysis dashboards** (`pages/Analysis.tsx`) — all math in pure, unit-tested `packages/shared/src/analysis/*`:
  - **Reliability:** Cohen's **κ**, **PABAK**, **Krippendorff's α**, % agreement, confusion-matrix heatmap; guards for the "kappa paradox" (PABAK-vs-κ gap; κ>0.85 caution).
  - **Dynamics:** dwell times, transition matrix, **cascade detector** (unresolved confusion→frustration→boredom, excluding *productive* confusion).
  - **Attention/SEEV:** per-AOI **PDT**, epoch segmentation, `allocationScore` (total-variation distance from expected weights), gaze-on-screen by quartile.
  - **Reading exposure:** furthest-vs-last % from `scrollHosts`/PDF pages (low-confidence banner when only window-scroll is available).
  - **Ground truth:** ESM/SAM trajectories + convergent-validity scatters (AEQ-S, PANAS, IMI).

### 8.4 Machine-assisted affect / activity / text-mining (Studio server)
- **Activity inference** (`activityInference.ts`): decision-level fusion of **gaze × DOM × interaction** per 1 s bin, emitting `conflict` and first-class `divided_attention` labels + allocation score.
- **Affect mapping** (`affectMapping.ts`, config `gals-affect-v1`): **late fusion** of three soft-posterior channels — py-feat AUs (AU4 disambiguated by AU7⇒confusion / AU14⇒frustration; person-baseline subtraction), OpenFace emotions, and a Wickens attention/load channel — debounced by persistence window into per-window machine guesses with unresolved-confusion detection.
- **Cohort / Research Analysis Studio** (`analysisSummary.ts` + `CohortAnalysis.tsx`): per-learner×session summaries (interventions system-vs-coder, practice-testing scores, EF detections, coder-override agreement via κ/PABAK, activity/affect rollups, data-health gap flags over the trim window) and a **one-click research export zip** (`free-dialogue.csv`, `learning-strategy-utterances.csv`, `intervention-responses.csv`, `ef-text-mining.csv`, `summary.csv`; Excel BOM/CRLF).

---

## 9. Infrastructure, storage, CI/CD

- **Two Docker Compose files.** `infra/docker-compose.yml` (infra only: `postgres:16-alpine`, `redis:7-alpine`, `minio`, `adminer`) for `pnpm infra:up` + native `pnpm dev`. Root `docker-compose.yml` (full stack: `api`, `web`, `worker`, `pyfeat-worker`, `openface3-worker`, `postgres`, `redis`, `minio`) for `pnpm docker:up`. Facial workers capped at 4 GB, `restart: unless-stopped`; OpenFace3 has a commented-out NVIDIA GPU block.
- **Storage (MinIO / S3, bucket `ats-blobs`):** assessment attempt blobs (`<attemptId>/strokes.json`, `snapshot.png`), webcam segments (`recordings/<course>/<student>/<session>/…webm`), DOM snapshots/screenshots, and facial-worker source clips + result CSVs. Presigned URLs are rewritten to relative `/s3/...` paths so the dev server proxies to MinIO (avoids CORS). Orphan-blob detect/cleanup scripts exist.
- **CI** (`.github/workflows/ci.yml`) on push to `main`/`milestone-*` and PRs: `lint-typecheck` → then `test-api` (Jest + supertest against real Postgres/Redis/MinIO service containers), `test-e2e` (Playwright over the full Docker stack, uploads HTML report), and `build`. **Python workers are only exercised via the E2E job**, not their own unit stage.
- **Testing:** API has 27 co-located `*.spec.ts` (heavy RAG/LLM/KC coverage); E2E in `e2e/` (`happy-path`, `dialogue-learning`) via `playwright.config.ts` (chromium, serial, retries:1). **Web has no unit tests** (covered only through E2E).
- **Deployment** is Docker-Compose-centric (no k8s/Terraform); Dockerfiles use a `development` target. Prisma migrations: `db:migrate` (dev) / `migrate:deploy` (prod & CI). Health endpoints back compose healthchecks: web `/health`, api `/api/health`, worker `/health`.

---

## 10. `packages/shared` (`@ats/shared`)

Zod-schema + TS-type + algorithm package (only runtime dep `zod`), imported across API/web/exporter. Notable: `roles`, `user` (bulk provisioning), `course`, `assessment`, `mastery` (BKT fields), `event-bus` (queue topics), `dialogue.schemas` (RAG knobs: contextual retrieval, reranker topK, multimodal ingest/generation, faithfulness check), the biometrics schemas (`recording`, `pupil-size`, `webgazer`, `pyfeat`), and **`affective-mapping.ts`** — maps 8 emotion probabilities → 4 affective states (engagement/boredom/confusion/frustration) via configurable combinators, shipping `DEFAULT_MAPPING`.

---

## 11. Cross-cutting observations & technical debt

- **Two clocks, one anchor:** every subsystem (live replay, exporter, Studio) times everything as wall-clock ms off a single `baseWallClockMs` + `session_sync_anchors`/`modality_offsets`. This is what makes offline multimodal fusion possible; it is consistently enforced (and window `scrollY` is deliberately distrusted everywhere).
- **Durability by design:** Studio coding artifacts are string-keyed and survive re-import; the exporter never aborts a bundle on one bad stream/blob; import is idempotent.
- **Queueing is split:** grading uses a **Postgres** `event_queue` (SKIP LOCKED); facial workers use **Redis** lists; Redis also backs throttling. RAG document chunking uses an **in-memory progress map with no retry across restarts** — the main durability gap on the live side.
- **LLM funnel debt:** 7 of 27 chat call sites bypass the provider funnel (OpenAI-only), and ~17 hard-coded model strings remain — enumerated in `LLM_AUDIT.md`, partially remediated per `LLM_VERIFICATION.md`.
- **Frontend scale vs. tooling:** a large app running on Context + hand-rolled `fetch` with no query cache and no web unit tests — flagged as a maintainability watch-point.
- **Branch landscape:** `KianYu` is the integration tip; `milestone-1-monorepo` is the default/base; `claude/openface3-real-inference` and `claude/openface3-textmining-wiring` show the OpenFace3 work being split between the recording pipeline and text-mining wiring.

---

*Prepared from a full read of the repository at the latest branch state. Section-level file references (e.g. `apps/api/src/rag/llm.service.ts`, `gals-studio/apps/studio-server/src/analysis/affectMapping.ts`, `tools/gals-export/src/export.ts`) can be traced directly in the tree.*
