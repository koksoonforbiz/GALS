# 01 — Functionality Inventory

> **Basis:** Read directly from the source on branch `claude/capstone-evidence-pack-h737h5` (based on `origin/KianYu`, 93 commits ahead of `milestone-1-monorepo`). Backend is NestJS + Prisma (PostgreSQL) + Redis + MinIO/S3; frontend is React (Vite). Where a design doc and the code disagree, the code wins and the disagreement is flagged. This document is descriptive of what exists, not what was promised.
>
> **Maturity legend:** `production-ready` = complete, guarded, works end-to-end · `works-with-caveats` = works but has a documented fragility/placeholder · `partial` = core path only, gaps remain · `stub` = declared but not implemented.

The system is one monorepo (`apps/api`, `apps/web`, plus three sensing workers `apps/pyfeat-worker`, `apps/openface3-worker`, `apps/worker`). The API has **46 module directories**; the Prisma schema has **~90 models** (full list in §6).

---

## 1. Instructor-side

### 1.1 Backend modules

| Module | Base route(s) | Purpose | Key tables | Maturity |
|---|---|---|---|---|
| `courses` | `courses` | Course CRUD, publish/unpublish, duplicate (deep clone), soft-delete (`archivedAt`), enrollment-policy flags, dialogue settings (Zod + model-registry validated) | `Course`, `User` | production-ready |
| `modules` | `courses/:courseId/modules`, `modules/:moduleId/items`, `items` | Module + ModuleItem CRUD, transactional reorder, PDF presigned upload/download, page-content version snapshots + rollback | `CourseModule`, `ModuleItem`, `PageContentVersion` | production-ready |
| `topics` | `topics` | Ownership-guarded topic CRUD grouping questions | `Topic`, `Course` | production-ready |
| `questions` | `questions` | Question-bank CRUD, bulk import/status, MCQ single/multi validation, KC junctions, optimistic versioning | `Question`, `QuestionKc` | works-with-caveats — create/update bodies typed `Record<string,any>`/`as any`, no Zod pipe |
| `assessments` | `assessments` | Assemble question collections, reorder/points/sections; `GET /available` for students | `Assessment`, `AssessmentQuestion`, `Question` | production-ready (loosely-typed settings) |
| `course-structure` | `admin/courses/:courseId/...` | LLM course-outline generation (real RAG + LLM JSON mode) → transactional materialisation into Topic→Module→Item | `LlmGenerationJob`, `Topic`, `CourseModule`, `ModuleItem`, `SourceDocument`, `LlmAuditLog` | works-with-caveats — fails job on unparseable LLM JSON (`course-structure.service.ts:541`), hand-rolled validation |
| `page-content` | `admin/...` | Per-page lesson generation, most advanced LLM path (multimodal PDF attach via OpenAI Files API vs chunked-text fallback), versioning, fires KC suggestion | `ModuleItem`, `PageContentVersion`, `LlmGenerationJob`, `LlmAuditLog` | works-with-caveats — single-page failures swallowed into `ERROR` (`page-content.service.ts:377`) |
| `question-generation` | `question-generation` | Generate→review→approve→grade pipeline + Hattie-model open-ended AI grading + feedback config | `QuestionGenerationJob`, `Question`, `QuestionKc`, `FeedbackPromptConfig`, `CourseFeedbackSetting` | works-with-caveats — `runGeneration` fire-and-forget in-process, errors only logged (`:101`) |
| `kc` | `proposed-kcs`, `kc-graph`, `kc-mappings` | "KC Studio": AI-proposed KCs, prerequisite graph (Kahn topo-sort, DFS cycle detection), KC↔page mappings, graph layout persistence | `ProposedKC`, `KcEdge`, `KcContentMapping`, `KcGraphLayout` | production-ready — real graph algorithms; name-only Jaccard for "similar pairs" |
| `kc-evaluation` | `courses/:courseId/kc-evaluation` | Deterministic (no-LLM) 4-dimension content evaluation (KC support, prerequisite integrity, cognitive load, outcome alignment) | `KcEvaluationRun`, `ProposedKC`, `KcContentMapping`, `KcEdge` | production-ready (coarse heuristics) |
| `knowledge-version` | `courses/:courseId/knowledge-versions` | Immutable numbered snapshots of KCs/edges/mappings, diff, JSON export, transactional restore | `KnowledgeVersion` | production-ready |
| `curriculum-coverage` | `courses/:courseId/curriculum-coverage` | Syllabus-vs-content coverage/gap analysis with LLM-or-heuristic (regex/Bloom-verb) degradation | `CurriculumCoverageRun` | production-ready |
| `publish-gate` | `courses/:courseId/publish-gate` | 5 deterministic pre-publish checks (DAG, isolated-KC, prereq completeness, evidence threshold, eval-critical-resolved) + justification-gated override | `PublishGateRun` | works-with-caveats — `EVAL_CRITICAL_RESOLVED` silently downgrades to warn when no evaluation ran |
| `evaluation` | `courses/:courseId/evaluation` | Page-level content-quality eval (deterministic math normaliser for 6 broken-math categories + optional LLM rubric) + `apply-fixes` | `EvaluationRun`, `PageEvalResult` | production-ready |
| `rag` | `courses/:courseId/...`, `llm-settings` | Teacher RAG ingest (upload→extract→chunk→contextualise→embed→multimodal); hosts the central `LlmService` provider funnel (key encryption, model resolution, grounded answers, drafts, usage/audit) | `SourceDocument`, `DocumentChunk`, `ContentDraft`, `LlmAuditLog`, `LlmUsageLog`, `LlmModelPricing` | works-with-caveats — template (non-LLM) placeholders when no API key (`rag/llm.service.ts:1265`); multimodal + contextual-retrieval flags default OFF |
| `user-management` | `user-management` | Roster: list/provision (crypto temp passwords), bulk-enroll, password reset, per-student/teacher LLM cost + usage analytics | `User`, `Enrollment`, `LlmUsageLog`, `LlmModelPricing` | production-ready |
| `enrollments` | `enrollments` | Policy-gated enroll/self-enroll/self-drop/teacher-drop; ACTIVE/DROPPED soft states | `Enrollment` | production-ready |
| `vlm` | `vlm` | In-process synchronous "describe this slide" via multimodal LLM (base64 image); enriches sparse slides for exercise generation | `VlmConfig` | production-ready |

### 1.2 Instructor-side UI surfaces (routes from `apps/web/src/App.tsx`)

| Surface | Route | Purpose | Maturity |
|---|---|---|---|
| Teacher Dashboard | `/teacher` | Landing page | **stub** — four stat cards hardcoded to `-`, no data fetch (`pages/teacher/TeacherDashboard.tsx`) |
| Courses list | `/teacher/courses` | List/create courses | production-ready |
| **Course Builder** | `/teacher/courses/:courseId` | Central authoring hub. Tabs: Overview, Content, Sources, Evaluate (Content Eval / KC-Aware Eval / Coverage), Knowledge (KC Studio / Graph / Learning Path / Mappings / Evaluate / Versions), Publish, **Dialogue** (DIALOGUE mode only), **Biometrics**, Settings | production-ready (imports ~30 sub-panels; legacy tab redirects present) |
| Course Studio (RAG authoring) | `/teacher/studio/:courseId` | AI content workspace: Generate Content, RAG Query, Drafts (approve/reject), Audit Logs; `RagDebugDrawer` shows retrieved/final chunks | works-with-caveats — debug `retrievalTimeMs`/`rerankTimeMs` hardcoded `0`; raw-textarea MDX editing |
| Prompt Settings | `/teacher/courses/:courseId/prompts` | Per-course intervention/prompt tuning + enrollment toggles | works-with-caveats |
| Question Generation | `/teacher/courses/:courseId/generate-questions` | AI question generation with steering prompt | works-with-caveats |
| AI Settings | `/teacher/ai-settings` | Provider API-key mgmt (OpenAI/Gemini/Cohere), model selection; graceful legacy-model handling | production-ready |
| Questions bank | `/teacher/questions` | Question CRUD + bulk import | production-ready |
| Assessments | `/teacher/assessments` | Assessment assembly | production-ready |
| Review (grading queue) | `/teacher/review` | Grade student text attempts | production-ready |
| Attempt Detail | `/teacher/attempt/:attemptId` | Multi-dimension (Hattie) AI feedback + grading history | production-ready |
| User Management / Bulk Provisioning | `/teacher/user-management`, `/teacher/users/bulk` | Account CRUD, bulk creation, teacher-driven password resets | production-ready |
| **Student Logs review hub** | `/teacher/students/:studentId/logs` | Per-session review console (see §4) | production-ready |
| Student Text-Mining dashboard | `/teacher/students/:studentId/text-mining` | Cross-session EF/construct dashboard | works-with-caveats |
| **Session Timeline** | `/dashboard/sessions/:sessionId/timeline` | Per-session analytics one-pager (stat cards + swimlane + emotion + text-mining) | works-with-caveats — dead breadcrumb link to unregistered `/teacher/students` |

> **Discrepancy:** "Course Studio" (`/teacher/studio`) is RAG **content authoring**, not student behavioural review. The student behavioural review lives at the **Student Logs** hub (§4). Don't conflate the two "Studio" names.

---

## 2. Student-side

### 2.1 Backend modules

| Module | Base route | Purpose | Key tables | Maturity |
|---|---|---|---|---|
| `attempts` | `attempts` | Attempt lifecycle: create (assessment or single question), submit with inline MCQ auto-grade; other types publish `GRADE_SUBMISSION` to event bus | `Attempt`, `GradingResult`, `AssessmentQuestion`, `CourseFeedbackSetting` | works-with-caveats — `triggerAiGrading` writes placeholder `score=0` awaiting an external consumer (`attempts.service.ts:437-500`) |
| `learning-interventions` | `learning-interventions` | The four evidence-based strategies + grounded chatbot + prompt-config CRUD + saved reviews + `preGeneratePage`. Largest service (~4360 lines) | `LearningIntervention`, `InterventionPromptConfig`, `SpacedRepetitionCard`, `SavedInterventionReview`, `ChatbotMessage`, `PreGeneratedExercise` | production-ready |
| `dialogue` | `dialogue` (+WS) | NotebookLM-style chat over the student's own uploaded sources; hybrid RAG, grounded multimodal messages, faithfulness self-check, `StudioService` outputs, guide poller, WS gateway | `DialogueSession`, `DialogueMessage`, `StudioOutput`, `StudentSourceGuide`, `StudentRagChunk` | works-with-caveats — controller reaches into private `dialogueService['prisma']` (`dialogue.controller.ts:153`) |
| `dialogue-notes` | `dialogue-notes` | Student-owned session annotations (doc/page/highlight anchor + colour) + Markdown export | `DialogueNote` | production-ready |
| `chat-history` | `chat-history` | Read-only unified transcript review (chatbot + dialogue), cursor pagination | `ChatbotMessage`, `DialogueSession`, `DialogueMessage` | production-ready |
| `mastery` | `me/*`, `students/*`, `kcs` | EMA (α=0.3) mastery over graded attempts, append-only `KcEvidence`, ZPD-band revision-worksheet generator | `UserMastery`, `KcEvidence`, `KnowledgeComponent`, `QuestionKc` | production-ready |
| `student-rag` | `student-rag` | Student upload→parse→chunk→contextualise→embed; hosts the **shared retriever** for both corpora | `StudentSourceDocument`, `StudentRagChunk`, `StudentSourceGuide` | works-with-caveats — `parseImage` returns a hard-coded placeholder (`file-parser.service.ts:185`); SHA256 pseudo-embedding fallback (blocked in prod) |

### 2.2 Student-side UI surfaces

| Surface | Route | Purpose | Maturity |
|---|---|---|---|
| Student Dashboard | `/student` | Enrollments, per-topic KC mastery, "generate worksheet" | production-ready |
| My Courses / Catalog | `/student/courses`, `/student/catalog` | Enrolled grid; browse/enroll public courses | production-ready |
| Course View (STANDARD mode) | `/student/courses/:courseId` | Module/item nav, PAGE via `BlockRenderer`, PDF via `PdfReader`, resizable `DockedChatbot` | works-with-caveats — "PDF not yet uploaded" placeholder when blob missing |
| **Dialogue Learning** (DIALOGUE mode) | `/student/courses/:courseId/dialogue` | NotebookLM three-panel: Sources / Chat (citations) / Studio (AI outputs, interventions) / PDF reader (highlights + notes) over socket.io | production-ready |
| Dialogue Session History | `/student/courses/:courseId/dialogue/sessions` | Past dialogue sessions | production-ready |
| Chat History | `/student/chat-history` | Past chatbot conversations | production-ready |
| Assessments / Attempt / Assessment Attempt | `/student/assessments`, `/student/attempt/:id`, `/student/courses/:courseId/assessment/:id` | Take questions/assessments, live grade push via socket, multi-level AI feedback | production-ready |
| Results | `/student/results` | Graded attempts | production-ready |
| Review Queue | `/student/review-queue` | Saved intervention reviews + spaced-repetition due cards | production-ready |

> **Note (intentional removals, not bugs):** student self-service `/change-password` route removed; PdfReader zoom controls removed; student self-unenroll button removed. `captureDom` is deliberately **OFF** for the 2026 study (`App.tsx:70-77`), so DOM-tree replay is screenshot-driven.

---

## 3. Sensing / Logging

### 3.1 Backend modules

| Module | Base route | Purpose | Key tables | Maturity |
|---|---|---|---|---|
| `logs` | `logs` | Raw client telemetry ingest (cursor/click/scroll/keystroke-summary/visibility/clipboard/viewport/performance/errors) + replay snapshots + clock sync anchors; sanitises `\x` byte-escapes that crash Postgres JSON; owns heavy Replay read `getSessionReplayData` (hard cap 50 000 frames) | `cursor_logs`, `click_logs`, `scroll_logs`, `keystroke_logs`, `visibility_logs`, `clipboard_logs`, `viewport_logs`, `performance_logs`, `error_logs`, `session_sync_anchors`, `SessionReplaySnapshot` | production-ready |
| `recording` | `recording` | Webcam capture: presigned MinIO upload per segment, lifecycle verification, per-course consent; auto-enqueues py-feat + OpenFace3 on completion | `RecordingConfig`, `RecordingSegment`, `RecordingConsent` | production-ready — **caveat:** enqueue failures only warned (`recording.service.ts:171`), a segment can be COMPLETED with no analysis job |
| `webgazer` | `webgazer` | Bulk gaze-sample ingest (coords computed client-side), calibration events, CSV export | `WebgazerConfig`, `WebgazerLog`, `WebgazerCalibrationEvent` | production-ready — no server-side gaze modelling |
| `pupil-size` | `pupil-size` | Bulk pupil-diameter ingest (client-precomputed), CSV export | `PupilSizeConfig`, `PupilSizeLog` | production-ready — heuristic source signal (see doc 04) |
| `activity-log` | `activity-log` | Structured event backbone + session lifecycle + export; fire-and-forget event recording, live/persisted summaries, cascade session delete across ~24 tables | `ActivityLog`, `StudentSession`, `SessionSummary` | production-ready — **external dep:** `triggerExport` shells out to `analysis/export_logs.py`, gated behind `ENABLE_SESSION_AUTO_EXPORT` (off) |

### 3.2 Sensing UI (student capture, `apps/web/src/components/student/`)

`BiometricsWrapper` (starts capture on attempt/course/dialogue routes), `PermissionGate` (blocks student rendering until permissions granted), `RecordingConsentModal`, `WebcamPreviewWindow`, `PupilSizeOverlay`, `WebgazerStatusBadge`, `PyfeatStatusBadge`, `BiometricsActiveBanner`. Client capture libs live in `apps/web/src/lib/webgazer`, `lib/pupil-size`, `lib/interaction-log`.

---

## 4. Analysis / Replay

### 4.1 Backend modules

| Module | Base route | Purpose | Key tables | Maturity |
|---|---|---|---|---|
| `analytics` | `analytics` | Batch on-demand derived-analytics engine; `POST /compute` fans out to 5 deterministic services writing `derived_*` tables | `derived_engagement`, `derived_cognitive_load`, `derived_emotion_timeline`, `derived_learning_velocity`, `derived_at_risk_flags` | works-with-caveats — hardcoded weights; learning-velocity crude `attemptsCount*0.05` back-off; at-risk mixes session-relative + wall-clock windows |
| `affective-mapping` | `affective-mapping` | Teacher-configurable rules mapping emotion-probability frames → engagement/boredom/confusion/frustration; config CRUD + versioning/history, live `preview`, CSV export | `AffectiveMappingConfig`, `AffectiveMappingConfigHistory`, `AffectiveStateWindow`, `EmotionFrame` | production-ready — `getCourseOverview` N+1 |
| `text-mining` | `text-mining` (+WS) | LLM-driven EF/affect construct detection from chat utterances; `ingest`→per-construct concurrent LLM JSON detections→persist→realtime WS; dashboards, prompt versioning, teacher settings | `EfDetection`, `EfConstructPrompt`, `EfTeacherSettings` | works-with-caveats — **1 stub endpoint** `POST /sessions/:id/reprocess` throws `NotImplementedException` (`text-mining.controller.ts:255`); orphan `pending` rows on failure |
| `replay-annotations` | `replay-annotations` | Researcher-scoped qualitative coding: `ReplayCode` CRUD + time-anchored `ReplayAnnotation` CRUD, per-researcher isolation | `ReplayCode`, `ReplayAnnotation` | production-ready |

### 4.2 The teacher review surfaces (the analytical heart)

The **Student Logs hub** (`/teacher/students/:studentId/logs`, `pages/teacher/student-logs/`) is a two-pane console (`SessionList` + `SessionLogViewer`) with tabs: **Summary, Timeline, Conversations, Interventions, Replay, Biometrics** (`SessionLogViewer.tsx:17-24`).

- **Replay tab** (`tabs/ReplayTab.tsx`, ~3,754 lines — the most sophisticated surface): double-buffered iframe DOM playback (cross-fade), pixel-screenshot thumbnails, synced webcam video, 5 FPS playhead, scrubber, gaze/click/pupil/AOI overlays, multi-signal timeline chart (8 OpenFace emotions + 4 client-computed learning states + 18 AUs), **AOI scoring panel** (`lib/aoiScoring.ts`), researcher **annotations layer**, and **CSV export** (`lib/exportReplayCsv.ts`). Details in docs 04 and 05.
- **Session Timeline page** (`/dashboard/sessions/:sessionId/timeline`) is a separate one-page analytics overview (stat cards + `SessionTimeline` swimlane + `SessionEmotionTab` + `SessionTextMiningTab`).

Feature modules: `features/openface3/` (`SessionEmotionTab`, `EmotionTimelineLane`, `AffectiveStatCards`) and `features/text-mining/` (`StudentTextMiningPage`, `DashboardPanel`, `ConstructRow`, `TraceDrawer`).

---

## 5. Background workers / infrastructure

| Module / worker | Purpose | Key tables | Maturity |
|---|---|---|---|
| `apps/pyfeat-worker` | Python worker: Redis `blpop('pyfeat:jobs')` → py-feat `Detector.detect_image` → **18 AU intensities** → `pyfeat_au_results` | `PyfeatJob`, `PyfeatAuResult` | works-with-caveats — inert unless deployed + weights present; `pyfeatConfig.isEnabled` defaults false |
| `apps/openface3-worker` | Python worker: Redis `blpop('openface3:jobs')` → OpenFace 3.0 (RetinaFace + MTL) → **8-class emotion probabilities** → `emotion_frames` | `Openface3Job`, `EmotionFrame` | works-with-caveats — inert unless deployed + weights at `OPENFACE3_MODEL_PATH` |
| `openface3` / `pyfeat` (API) | API orchestrators only (no in-process CV): enqueue to Redis, retry/backfill/stats/health/DLQ | as above | works-with-caveats |
| `pre-generation` | In-process pre-computation of intervention exercises (60s backfill scan + 5s worker claim) | `PreGenerationConfig`, `PreGeneratedExercise` | production-ready — assumes single API instance |
| `event-bus` | Postgres transactional-outbox (`FOR UPDATE SKIP LOCKED`) | `EventQueue` | works-with-caveats — no retry/backoff/DLQ (`event-bus.service.ts:54`) |
| `grading` | **No grading logic** (that's in `attempts`); real-time fan-out: `GradeCompletedPoller` (2s) + `GradingGateway` WS to `student:<id>`; hosts dev `SeedController` | `EventQueue` | production-ready |
| `blob` | `@Global` S3/MinIO wrapper (put/get/delete/head, presigned URLs) | — (S3) | production-ready |
| `auth` | `@Global` bcrypt register, identifier(email-or-loginId) login → 24h JWT, Passport JWT + RBAC guards, Redis throttler | `User` | production-ready |
| `prisma` | Shared `PrismaClient` lifecycle | all | production-ready |
| `common` | `GlobalExceptionFilter`, `ZodValidationPipe`, `ThrottlerRedisStorage`, `SessionId` decorator | — | production-ready — throttle storage always returns `isBlocked:false` (`throttle-redis.storage.ts:35`) |
| `health` | `GET /health` (Postgres/blob/event-bus probes) | — | production-ready |
| `jobs` | Teacher/admin triggers for offline session-export (`child_process.exec` → `analysis/export_logs.py`) | — | works-with-caveats — **`sessionId` string-interpolated into shell command (`jobs.controller.ts:18`) → command-injection risk, no validation** |
| `llm` | Read-only model registry (`model-registry.ts`); the actual `LlmService` funnel lives in `rag/` | — | production-ready |

---

## 6. Complete Prisma model list (one-line purpose each)

> From `apps/api/prisma/schema.prisma` (2,542 lines). Grouped by domain.

### Identity, courses, content
| Model | Purpose |
|---|---|
| `User` | Accounts (student/teacher/admin), per-user LLM provider/key/model, embedding + Cohere keys, onboarding fields |
| `Course` | Course entity; `learningMode` STANDARD/DIALOGUE, enrollment-policy flags, `rerankTopK`, `dblSettings` |
| `Enrollment` | Student↔course link, ACTIVE/DROPPED |
| `Topic` | Course sub-division grouping questions/KCs/modules |
| `CourseModule` | Ordered module within a course/topic |
| `ModuleItem` | Leaf content: PAGE (MDX), PDF (blob), LINK, ASSESSMENT |
| `PageContentVersion` | Versioned BlockDocument JSON per PAGE item (human/ai/rollback) |
| `Question` | Question bank item (text/MCQ single/multi/structured) with rubric, KCs, provenance |
| `Attempt` | A student's answer to a question (in_progress→submitted→grading→graded) |
| `GradingResult` | Score + feedback for an attempt (auto/manual), Hattie feedback JSON |
| `Assessment` | Collection of questions, mode practice/test |
| `AssessmentQuestion` | Join: question ↔ assessment with points/section/order |

### RAG / documents
| Model | Purpose |
|---|---|
| `SourceDocument` | Teacher-uploaded course material; embedding-model pin, OpenAI file cache, re-embed marker |
| `DocumentChunk` | Teacher-corpus chunk: content, embedding (JSON vector), contextual blurb, multimodal (`chunkKind`/`imageObjectKey`/`caption`) |
| `StudentSourceDocument` | Student-uploaded dialogue-mode source (PDF/DOCX/TXT/MD/IMAGE/CODE) |
| `StudentSourceGuide` | AI summary/TOC/suggested-questions/key-topics per student doc |
| `StudentRagChunk` | Student-corpus chunk (mirror of DocumentChunk) |

### Dialogue / chatbot
| Model | Purpose |
|---|---|
| `DialogueSession` | A NotebookLM-style dialogue session (active sources, messages, outputs) |
| `DialogueMessage` | One dialogue turn (role, content, citations, tokenUsage) |
| `ChatbotMessage` | Floating/docked chatbot turn; survives session purge; `contextSource`, `selectedText`, `currentPage`, `suggestedStrategy` |
| `StudioOutput` | AI study artifact (briefing/flashcards/table/mind-map/timeline/FAQ) |
| `DialogueNote` | Student note anchored to source/page/highlight |

### LLM audit / pricing
| Model | Purpose |
|---|---|
| `ContentDraft` | RAG-generated lesson draft (DRAFT/APPROVED/REJECTED) with citations |
| `LlmGenerationJob` | Async LLM job (course structure/page content) with token/duration |
| `LlmAuditLog` | Per-LLM-action audit (model, tokens, payloads) |
| `LlmUsageLog` | Per-call cost log (provider/model/tokens/USD/feature/modality) |
| `LlmModelPricing` | Per-model input/output price table |

### Knowledge components (**two independent systems**)
| Model | Purpose |
|---|---|
| `KnowledgeComponent` | Topic-scoped KC used by the **student mastery** system |
| `QuestionKc` | Join: question ↔ KC (weight, auto-assigned, confidence) |
| `KcEvidence` | Per-grading-result KC correctness evidence |
| `UserMastery` | Per-(user,KC) mastery (`probabilityKnown`, BKT-ready columns) |
| `ProposedKC` | AI-proposed KC for the **teacher curation/graph** system |
| `KcEdge` | Prerequisite/related edge between ProposedKCs |
| `KcContentMapping` | ProposedKC ↔ page mapping strength |
| `KnowledgeVersion` | Immutable snapshot of KCs/edges/mappings |
| `KcGraphLayout` | Persisted graph node coordinates |

### Evaluation / coverage / publish
| Model | Purpose |
|---|---|
| `EvaluationRun` / `PageEvalResult` | Content-quality evaluation run + per-page results |
| `KcEvaluationRun` | KC-aware evaluation run |
| `CurriculumCoverageRun` | Syllabus-vs-content coverage analysis |
| `PublishGateRun` | Pre-publish gate audit (checks, override) |

### Interventions
| Model | Purpose |
|---|---|
| `LearningIntervention` | One intervention session (type, status, selectedText, sessionData JSON) |
| `SavedInterventionReview` | Student-saved intervention for later review |
| `InterventionPromptConfig` | Per-course teacher system-prompt + Practice-Testing default counts |
| `SpacedRepetitionCard` | Distributed-practice flashcard with SM-2 state (ease/interval/repetitions) |
| `QuestionGenerationJob` | AI question-generation job |
| `FeedbackPromptConfig` / `CourseFeedbackSetting` | Hattie feedback-level prompts + enabled levels |
| `PreGenerationConfig` / `PreGeneratedExercise` | Pre-computed intervention exercises per page/strategy |

### Sessions & activity logging
| Model | Purpose |
|---|---|
| `StudentSession` | A learning session (start/end/duration, IP/UA) — anchor for all logs |
| `ActivityLog` | Structured event (43-value `ActivityAction` enum) with optional FKs + metadata JSON |
| `SessionSummary` | Per-session rollup (events, active time, intervention/dialogue/mastery stats, event timeline) |
| `cursor_logs`, `click_logs`, `scroll_logs`, `keystroke_logs`, `visibility_logs`, `clipboard_logs`, `viewport_logs`, `performance_logs`, `error_logs` | Raw interaction streams (details in doc 04) |
| `session_sync_anchors` | Wall-clock ↔ monotonic ↔ server-receive clock anchor for cross-modal alignment |
| `modality_offsets` | Per-modality time offset estimates |

### Biometrics
| Model | Purpose |
|---|---|
| `RecordingConfig` / `RecordingSegment` / `RecordingConsent` | Webcam recording config, uploaded segments, per-course consent |
| `PupilSizeConfig` / `PupilSizeLog` | Pupil capture config + per-sample diameter |
| `WebgazerConfig` / `WebgazerLog` / `WebgazerCalibrationEvent` | Gaze config, per-sample gaze (x/y/confidence), calibration events |
| `PyfeatConfig` / `PyfeatJob` / `PyfeatAuResult` | Py-feat config, job, per-frame **18 AU intensities** |
| `Openface3Job` / `EmotionFrame` | OpenFace3 job + per-frame **8-class emotion probabilities** + (NULL) head pose |

### Affective state & derived analytics
| Model | Purpose |
|---|---|
| `AffectiveMappingConfig` / `AffectiveMappingConfigHistory` | Teacher rule config (window/stride/rules) + version history |
| `AffectiveStateWindow` | Per-window engagement/boredom/confusion/frustration + mean emotions |
| `derived_engagement` | Interaction-based engagement per window |
| `derived_cognitive_load` | Pupil/gaze/AU-based cognitive-load index per window |
| `derived_emotion_timeline` | Emotion label per window |
| `derived_learning_velocity` | Mastery delta / velocity per session×KC |
| `derived_at_risk_flags` | At-risk flag events |
| `aligned_frames` | Fused multimodal frame (pupil + gaze + 18 AUs + cursor + scroll + intervention + activity + score) |

### Text-mining & replay coding
| Model | Purpose |
|---|---|
| `EfDetection` | One LLM detection of an EF/affect construct on a message |
| `EfConstructPrompt` | Versioned per-construct detection prompt (global or per-course) |
| `EfTeacherSettings` | Teacher text-mining settings (window, concurrency, overrides, pause) |
| `SessionReplaySnapshot` | DOM/screenshot snapshot with `aois`, `scrollHosts`, PDF page |
| `ReplayCode` / `ReplayAnnotation` | Researcher qualitative codes + time-anchored annotations |
| `VlmConfig` | Per-teacher vision-LLM settings (thresholds, image size, provider) |

---

## 7. Headline maturity flags (for the viva)

1. **One true stub endpoint:** `POST /text-mining/sessions/:sessionId/reprocess` → `NotImplementedException` (`text-mining.controller.ts:255`).
2. **Teacher Dashboard is a placeholder** (hardcoded `-` stat cards).
3. **AI grading of structured questions is not closed** — `attempts.triggerAiGrading` writes `score=0` awaiting an external consumer that isn't in-repo (MCQ auto-grade and the separate `question-generation` open-ended grader *are* real).
4. **CV analysis depends on out-of-process workers** — openface3/pyfeat are real code but inert unless deployed with model weights; webgazer/pupil are client-computed ingest only.
5. **Two independent KC systems** (`ProposedKC` graph vs `KnowledgeComponent`/`UserMastery` mastery) are **not wired together**.
6. **Security flag:** command-injection surface in `jobs.controller.ts:18` (un-validated `sessionId` in a shell command).
7. **In-process schedulers assume a single API instance** (pre-generation, pollers, rag progress `Map`).
