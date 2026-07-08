# 02 — Revised Scope vs. Proposal

> **Basis:** Read from source on `claude/capstone-evidence-pack-h737h5`. Status verdicts are grounded in the code; where a promised item was reframed or descoped, the actual built alternative is named with citations. Cross-references: doc 01 (inventory), 03 (pedagogy), 04 (sensing), 05 (measurement).

**Verdict legend:** **Delivered** = built as promised · **Exceeded** = built beyond the proposal · **Partial** = core exists, promised scope incomplete · **Reframed** = built differently, research-driven pivot · **Descoped/Unverifiable** = not built, or not verifiable from code.

---

## 1. Status table — the 18 proposal items

| # | Proposal item | Verdict | Code evidence |
|---|---|---|---|
| 1 | Login pages for instructor and learners via email authentication | **Delivered** | `auth` module: bcrypt register, identifier(email-or-loginId) login → 24h JWT, RBAC guards, Redis throttling. `pages/Login.tsx`, `Register.tsx`, `RoleRoute`. `User.email @unique` + optional `loginId`. |
| 2 | RAG pipeline to upload course materials | **Exceeded** | `rag` module: upload→extract→chunk (512-tok/100-overlap)→contextualise→embed→**multimodal (Cohere Embed-4 page-image vectors)**; hybrid retrieval (dense cosine + sparse ILIKE + RRF k=60 + optional Cohere rerank). `SourceDocument`, `DocumentChunk`. (doc 03 §1) |
| 3 | LLM course generation (API calls with RAG embeddings) | **Delivered** | `course-structure` module: real RAG + LLM JSON-mode → transactional Topic→Module→Item materialisation. `LlmGenerationJob`, `page-content` per-page generation with multimodal PDF attach. |
| 4 | Human safeguard edits | **Delivered** | `ContentDraft` DRAFT/APPROVED/REJECTED workflow; `PageContentVersion` (human/ai/rollback) with version history + rollback; `publish-gate` justification-gated override. |
| 5 | **Learning path generation with KCs (knowledge graph theory)** | **Partial / Reframed** | See §1.1 below. |
| 6 | **LLM-evaluation of course content (formatting, accuracy, pedagogy)** | **Delivered** (with a nuance) | See §1.2 below. |
| 7 | Curation of question banks and assessment | **Exceeded** | `questions` (CRUD, bulk import, MCQ/structured), `assessments` (assembly, points/sections), `question-generation` (AI generate→review→approve→grade pipeline + Hattie grading). |
| 8 | **LMS monitoring enrolment, progress, performance** | **Partial / Reframed** | See §1.3 below. |
| 9 | Lesson content page (modular lesson pages) | **Delivered** | `ModuleItem` PAGE (BlockDocument/MDX) / PDF; `StudentCourseViewPage` with `BlockRenderer` + `PdfReader` + docked chatbot. |
| 10 | **Assessment page with adaptive feedback** | **Reframed** | See §1.4 below. |
| 11 | Chatbot linked to LLM for dialogue-based learning | **Exceeded** | Two surfaces: NotebookLM-style **dialogue mode** (`DialogueService`, StudioOutputs, citations) + **floating/docked chatbot** (`chat()`), both grounded via shared grounding contract. (doc 03 §1) |
| 12 | WebGazer tracing eye gaze and facial expressions | **Exceeded** | WebGazer gaze (10 Hz) + **two real facial-analysis workers**: OpenFace 3.0 (8-class emotion) + Py-Feat (18 AUs). (doc 04 §1–2) |
| 13 | **Learners' progress report** | **Partial / Reframed** | See §1.5 below. |
| 14 | User study with ≥30 participants | **Unverifiable from code** | Not code-verifiable. Infrastructure exists; the codebase references **"54 sessions"** predating the emotion survey (commit `eed4b21`). Session/participant counts live in the DB, not the repo. |
| 15 | Validation of system-detected vs self-reported states | **Partial** | Self-report ground truth EXISTS (`EMOTION_SELF_REPORT` → `ActivityLog.metadata.emotion`, 5-class, every 15 min) and machine states exist (`affective_state_windows`, `ef_detections`); **no agreement metric is computed in-repo** and self-report only covers post-2026-07-01 sessions. (doc 05 §5) |
| 16 | T-test / one-way ANOVA (phase 1 vs phase 2) | **Partial** | Continuous DVs exportable via `analysis/export_logs.py`; **no phase1/phase2 marker exists in the schema/data** — grouping must be defined externally. |
| 17 | Mann-Whitney if normality fails | **Partial** | Same DVs/exports; same grouping gap; no normality test or non-parametric test computed in-repo. |
| 18 | Report of effect sizes | **Partial** | Raw numbers present; **no effect-size or normalized-gain (`⟨g⟩`) field stored** — must be computed in analysis. |

### 1.1 Item 5 — Learning path generation with KCs (knowledge graph theory): **Partial / Reframed**

**What exists (substantial):** a full teacher-facing **KC graph** — `ProposedKC` nodes, `KcEdge` prerequisite/related/builds-on edges, real **Kahn topological ordering + DFS cycle detection**, `KcGraphLayout` persistence, `KcContentMapping` (KC↔page), AI edge generation, and a `LearningPathPanel.tsx` UI. So knowledge-graph theory is genuinely implemented (`kc`, `kc-graph`, `kc-mappings` modules; doc 01 §1.1).

**Why it's Partial/Reframed:**
- It is **teacher curation + graph analytics**, not a **student-facing adaptive path** that routes a learner through prerequisites at runtime. The topological order and prerequisites are computed and visualised for the teacher; there is no runtime "next-best-KC" router for students.
- **Two independent KC systems coexist and are not wired together:** the graph system (`ProposedKC`/`KcEdge`/`KcContentMapping`) vs the student-mastery system (`KnowledgeComponent`/`UserMastery`/`KcEvidence`, EMA α=0.3). Mastery is not fed by the graph, so a personalised path can't currently be driven by mastery over the prerequisite graph. Disclose this seam.

### 1.2 Item 6 — LLM-evaluation of course content: **Delivered** (nuance on "accuracy")

`evaluation` module: `PageEvalResult.scores` = `{formatting, equations, pedagogy, rigor, overall}` with `issues[]` (category/severity/location/message/suggestedFix). It combines a **deterministic `MathNormalizerService`** (6 broken-math categories) with an optional LLM rubric pass, and can `apply-fixes` back into the BlockDocument (snapshotting a version). Plus `kc-evaluation` (deterministic 4-dimension KC-aware eval) and `curriculum-coverage` (syllabus gap map). **Nuance:** "accuracy" is assessed as **rigor/pedagogy rubric scoring + deterministic math checks**, not external fact-checking against ground truth — say "content-quality evaluation", not "factual verification".

### 1.3 Item 8 — LMS monitoring enrolment, progress, performance: **Partial / Reframed**

**What exists:** `enrollments` (policy-gated enroll/drop, ACTIVE/DROPPED), `mastery` per-topic views (student + teacher), `user-management` per-student/teacher **LLM cost + usage analytics**, `SessionSummary` per-session rollups, and the deep **Student Logs review hub** (Summary/Timeline/Conversations/Interventions/Replay/Biometrics tabs).

**Why Partial/Reframed:**
- The classic at-a-glance **"LMS dashboard" is a stub** — `TeacherDashboard.tsx` shows four stat cards hardcoded to `-` with no data fetch. There is no consolidated cohort progress overview.
- Monitoring was **reframed** away from a conventional LMS dashboard toward **fine-grained per-session behavioural + biometric analytics** (the Replay tab, text-mining dashboards, session summaries). That is far richer than the proposal, but a teacher wanting a simple "who's behind" roster view doesn't have one.

### 1.4 Item 10 — Assessment page with adaptive feedback: **Reframed**

**What exists:** `AttemptPage`/`AssessmentAttemptPage` with **multi-level Hattie feedback** (`HattieFeedbackLevel` = TASK / PROCESS / SELF_REGULATION / SELF), per-course enabled levels (`CourseFeedbackSetting`), teacher-editable feedback prompts (`FeedbackPromptConfig`), live grade push over socket, and KC-linked mastery updates.

**Why Reframed:** "adaptive" was delivered as **adaptive *feedback depth* (Hattie levels + KC mastery signals)**, not **adaptive *item selection*** (no computerised-adaptive-testing / difficulty branching). `UserMastery` carries BKT-ready columns (`pLearn/pGuess/pSlip/pTransit`) but **BKT is not implemented** — mastery uses a simple EMA (α=0.3). The revision-worksheet generator does select by ZPD band, which is the closest thing to adaptive item selection.

### 1.5 Item 13 — Learners' progress report: **Partial / Reframed**

**What exists:** `SessionSummary` (events, active time, questions correct, intervention/dialogue stats, mastery deltas, event timeline), student `StudentResultsPage` (graded attempts + feedback), `StudentDashboard` per-topic mastery, `ReviewQueuePage` (saved reviews + spaced-rep due), and teacher-side per-session analytics.

**Why Partial/Reframed:** there is **no consolidated, longitudinal "progress report" artifact** (no printable/exportable per-student progress document). Progress reporting was reframed into (a) the teacher review/replay + text-mining dashboards and (b) the CSV/ZIP exporters (per-session and cohort). A student-facing longitudinal report is the main gap.

---

## 2. New deliverables (built, never proposed)

These are substantial capabilities absent from the original 18-item proposal — the core of the "evolution" story.

| Capability | What it is | Key evidence |
|---|---|---|
| **Session replay engine** | 3-stage-load DOM/pixel replay with synced webcam, gaze/click/pupil/AOI overlays, multi-signal timeline (8 emotions + 4 states + 18 AUs) | `ReplayTab.tsx` (~3,753 lines), `useSessionReplay.ts` (doc 04 §7) |
| **AOI / SEEV attention scoring** | `data-replay-region` capture, epoch segmentation, TV-distance alignment, duration-weighted `allocation_score` | `aoiScoring.ts` (doc 04 §5) |
| **Four learning interventions** | Practice Testing, Interrogative Elaboration, Stepwise Learning, Distributed Practice (SM-2) | `learning-interventions` (doc 03 §3) |
| **EF text-mining** | 9 executive-function/affect constructs detected from utterances by LLM, with confidence/severity/rationale/promptVersion | `text-mining` module (doc 05 §2) |
| **Retrospective coding** | Researcher qualitative codes + time-anchored annotations on replays | `replay-annotations`, `ReplayCode`/`ReplayAnnotation` (doc 04 §7.2) |
| **CSV / multi-CSV exporters** | Wide-format replay CSV + full-session ZIP + 7-CSV cohort ZIP (free-dialogue vs learning-strategy split) | `exportReplayCsv.ts`, `exportSessionData.ts`, `gals-studio/.../analysisSummary.ts` (doc 04 §7.3) |
| **Dialogue mode (NotebookLM-style)** | Source panel + grounded chat + StudioOutputs (briefing/flashcards/table/mind-map/FAQ) + notes | `dialogue` module, `DialogueLearning.tsx` (doc 03 §1) |
| **Affective-state mapping engine** | Teacher-configurable Wickens-derived rules mapping emotions → engagement/boredom/confusion/frustration, versioned | `affective-mapping`, `AffectiveMappingConfig` (doc 04 §4) |
| **Sync-anchor time alignment** | Wall/monotonic/server clock anchor unifying all modalities on one wall-clock t0 | `session_sync_anchors`, `ReplayTab.tsx:786` (doc 04 §6) |
| **Teacher prompt configuration** | Per-course editable system prompts for interventions + Hattie feedback + EF constructs | `InterventionPromptConfig`, `FeedbackPromptConfig`, `EfConstructPrompt` |
| **Derived analytics tables** | Engagement, cognitive load, emotion timeline, learning velocity, at-risk flags, aligned multimodal frames | `analytics` module, `derived_*`, `aligned_frames` |
| **Curriculum coverage + gap map** | Syllabus-vs-content coverage analysis with LLM-or-heuristic degradation | `curriculum-coverage` |
| **Publish gate** | 5 deterministic pre-publish checks + justification-gated override | `publish-gate` |
| **Knowledge versioning** | Immutable numbered snapshots of KCs/edges/mappings with diff + restore | `knowledge-version` |
| **Multimodal + advanced RAG** | Cohere Embed-4 page-image vectors, contextual-retrieval blurbs, hybrid dense+sparse+RRF+rerank | `rag/shared/*`, `student-rag-retrieval.service.ts` (doc 03 §1) |
| **VLM slide description** | In-process vision-LLM "describe this slide" to enrich sparse slides | `vlm` module, `VlmConfig` |
| **Pre-generation of exercises** | Background pre-computation of intervention exercises per page/strategy | `pre-generation`, `PreGeneratedExercise` |
| **LLM cost/usage tracking** | Per-call token + USD logging with a per-model pricing table | `LlmUsageLog`, `LlmModelPricing`, `user-management` analytics |
| **Bulk user provisioning** | CSV/paste bulk account creation with temp passwords + progress panel | `BulkUserProvisioningPage.tsx`, `user-management` |
| **Emotion self-report survey** | Mandatory 5-option affect check every 15 min → self-report ground truth | `EmotionSurveyModal.tsx`, `EMOTION_SELF_REPORT` (doc 05 §5) |
| **Researcher session-trim** | Crop dead time from a session; reflected across replay + exports | KianYu commit `1d05640` |

---

## 3. Suggested rewritten scope statement

> *Drop-in prose for the report. Adjust participant/session numbers to the final study figures.*

**Original intent and its evolution.** The project set out to build an intelligent tutoring system combining a RAG-grounded course pipeline, a dialogue chatbot, and webcam-based affect/cognition sensing, validated in a modest user study. During development the platform's centre of gravity shifted from *content authoring* toward *learning-process measurement*: the same webcam and interaction streams that were originally a single "WebGazer + facial expression" deliverable grew into a full multimodal instrumentation stack — 10 Hz gaze, a proxy pupil signal, and two independent facial-analysis workers (OpenFace 3.0 for eight-class emotion, Py-Feat for eighteen action units) — feeding a configurable affective-state mapping engine and a session-replay-with-retrospective-coding environment. This was a deliberate, research-driven pivot: to make claims about affect and cognition credible, the system needed dense, time-aligned, privacy-preserving behavioural data and the tools to review and code it, not merely to generate lessons.

**What the platform became.** The delivered system is best described as a **multimodal learning-analytics platform with an intelligent-tutoring front end**. The authoring side meets and in places exceeds the proposal (multimodal RAG with hybrid retrieval and reranking, LLM course/question generation with human-in-the-loop drafts and versioning, a knowledge-component graph with prerequisite reasoning, and automated content-quality evaluation). The learning side adds four theory-grounded, learner-initiated interventions (practice testing, interrogative elaboration, stepwise scaffolding, and SM-2 spaced repetition) and two grounded chat surfaces. Crucially, the sensing side is decoupled from the pedagogy: interventions are never triggered by affective signals, so the affect measurements are a clean observational layer rather than a confound in the learning loop. On top of this sits an instrumentation layer — synchronised interaction, gaze, pupil, emotion, and action-unit streams unified on a single wall-clock anchor — and a research toolset (session replay, area-of-interest attention scoring, executive-function text-mining, qualitative coding, and CSV/ZIP exporters) that turns each session into an analysable multimodal record.

**Honest scope of the evaluation.** Several proposal deliverables were reframed rather than dropped, and the report treats them as such: knowledge-graph "learning paths" exist as teacher-facing prerequisite graphs rather than a runtime adaptive router; "adaptive feedback" was delivered as adaptive feedback *depth* (Hattie levels) rather than adaptive item selection; LMS "monitoring" and the "progress report" were reframed into fine-grained per-session analytics rather than a conventional dashboard. The statistical programme (validation against self-report, t-test/ANOVA, non-parametric fallback, effect sizes) is **supported by the data but not yet executed in-repo**: a mandatory five-option self-report survey now provides affect ground truth whose label space matches the machine-detected states, but the analysis leaves two known gaps to address in write-up — the absence of a stored phase/condition marker (so any phase comparison is defined externally) and the absence of pre-computed normalized-gain and effect-size fields. Framed this way, the platform's evolution is the contribution: a working demonstration that a RAG-based tutor can be instrumented, end-to-end and privacy-first, to make its learners' attention, affect, and cognition measurable.
