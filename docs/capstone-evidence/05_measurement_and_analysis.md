# 05 — What You Can Measure & Report

> **Basis:** Read from source on `claude/capstone-evidence-pack-h737h5`. This document specifies concrete, runnable analyses grounded in the *actual* stored data, and states honestly what is missing for clean statistics.

---

## 1. On-task / off-task validation (cross-modal convergent validation)

**Goal:** validate AU-derived engagement against a *behavioural reference criterion* (gaze-AOI dwell). **This is cross-modal convergent validation, NOT human ground truth** — no human coder labels on/off-task; the "criterion" is itself a machine-derived gaze signal. State this limitation explicitly.

**What exists to build it:**
- **AU features** (per frame, `pyfeat_au_results`): the 18 AUs `au01, au02, au04, au05, au06, au07, au09, au10, au12, au14, au15, au17, au20, au23, au24, au25, au26, au28`. Engagement-relevant AUs commonly used: AU06+AU12 (positive/smile), AU04 (brow-lower/concentration or negative), AU07 (lid tightener), AU01+AU02 (surprise/attention). The server affective pipeline also produces a windowed engagement score in `affective_state_windows.engagement` from the OpenFace3 emotions — you can validate *either* the AU features directly *or* the derived engagement score.
- **AOI on-task reference** (per epoch, `aoiScoring.ts`): the "valid study" mask (confidence ≥ 0.5, not tab-hidden, not in a nav/click settle window, not idle) plus per-epoch bucket dwell. **On-task ≙ gaze dwelling in the epoch's expected AOI bucket.** Per epoch type: `reading_lesson` → on-task = dwell in `lesson+pdf`; `chatbot_dialogue` → on-task = dwell in `chatbot`; `intervention_active` → on-task = dwell in the active panel. The per-epoch `aoi_epoch_alignment` (TV-distance similarity to expected weights) is a ready-made continuous on-task index.

**Runnable analysis:**
1. **Window size:** align to the server affective window (30 s window, 10 s stride) OR a fixed **10 s window** for finer resolution — join both to the CSV `relative_s` grid.
2. Per window compute: (a) AU feature vector (mean of each AU over face-detected frames), or the derived `engagement` score; (b) AOI on-task label = 1 if the window's dominant gaze bucket matches the expected bucket for the concurrent epoch, else 0 (using `aoiScoring` output); optionally the continuous `aoi_epoch_alignment`.
3. **Agreement statistics computable:**
   - **Point-biserial / Pearson correlation** between the continuous engagement (AU-derived) and continuous `aoi_epoch_alignment`.
   - **Cohen's κ** over windows after binarising both (engagement above/below median vs AOI on/off-task).
   - **Confusion matrix** (AU-engaged × AOI-on-task) with sensitivity/specificity.
4. **Tables/joins:** `affective_state_windows` (or `pyfeat_au_results` aggregated) ⋈ `webgazer_logs`-derived AOI epochs (via `aoiScoring`) on `sessionId` + wall-clock window, both re-based to `session_sync_anchors.wallClockMs`.

**Caveats to disclose:** gaze is WebGazer (webcam, `weightedRidge`) — noisy; pupil is a proxy dark-area signal; AOI expected weights are placeholder SEEV/EV values; both modalities can be jointly wrong (correlated error), so agreement is *convergent*, not *criterion* validity.

---

## 2. Text-mining inference (EF constructs)

Constructs are **hard-coded** in `apps/api/src/text-mining/detection/constructs.ts:13` and seeded into `EfConstructPrompt` (courseId=null, version 1, updatedBy='system') at boot (`detection.service.ts:17-34`). Prompts in `detection/default-prompts.ts`. Teachers can override per-course/version (course-scoped preferred).

### 2.1 Full construct set (9)

| # | constructKey | Label | labelType | feasibility | Detects (gist) |
|---|---|---|---|---|---|
| 1 | `metacognition_general` | Metacognition (general) | binary | 5 | 1st-person + reference to a cognitive state/process |
| 2 | `metacognitive_monitoring` | Metacognitive monitoring | binary | 5 | Learner verbalises own work is wrong/incomplete; self-correction, doubt |
| 3 | `attention_regulation` | Attention / mind-wandering | binary | 2 | Task-unrelated thought / reading-without-comprehending; confidence capped ≤0.6 |
| 4 | `working_memory` | Working memory load | **ordinal** (low/med/high) | 2 | Lost-track markers, reformulations, reference loss; emits `warning` |
| 5 | `cognitive_flexibility` | Cognitive flexibility | binary | 1 | Verbal pivot / alternative strategy; emits `warning` "surface marker; not validated as EF" |
| 6 | `confusion` | Confusion | binary | 5 | Non-understanding / surprise-at-mismatch; **optional SEVERITY 1–5** |
| 7 | `frustration` | Frustration | binary | 4 | Sustained blockage, exasperation, give-up signals |
| 8 | `engagement` | Engagement / off-task | **engagement** (on/off-task) | 4 | ON/OFF-task relative to course context — **only construct needing retrieval** (course+session title injected) |
| 9 | `boredom` | Boredom | binary | 2 | Explicit boredom / monotony / restless-waiting; ~69% accuracy ceiling noted |

Only `confusion` populates `severity`; only `working_memory` & `cognitive_flexibility` prompts request a `warning`.

### 2.2 Detection flow

- **Trigger = on message create, per utterance, fire-and-forget** (not batch). Two entry points → `TextMiningService.ingest()`:
  1. `DialogueMessage` (main tutor chat), `dialogue.service.ts:338-347`.
  2. `ChatbotMessage` (floating chatbot), `learning-interventions.service.ts:4047-4058` — uses a **synthetic `messageId = randomUUID()`** (the floating chatbot doesn't persist to its own message table before mining) and `sessionId = activitySessionId`.
- `ingest()` (`text-mining.service.ts:19-70`): honours `pauseIngestion`; drops feasibility ≤2 when `disableLowFeasibility`; inserts placeholder `label:'pending'` rows; `queueMicrotask()` runs `detectAllForMessage()` then deletes the pending rows on success.
- `detectAllForMessage()` (`detection.service.ts:36`): runs enabled constructs concurrently under a semaphore bounded by `detectionConcurrency` (default 6); each construct = one LLM call (`jsonMode`, `maxTokens:200`); `createMany` into `ef_detections`; emits Socket.IO `detectionCreated`/`batchCompleted`.
- **Model/provider:** `detectionProviderOverride ?? llmSettings.provider ?? 'openai'`; `detectionModelOverride ?? llmSettings.model ?? 'gpt-4o-mini'` (`detection.service.ts:104-107`). `rollingWindowN` (default 5) is **dashboard-aggregation only**, never used in detection.

### 2.3 Validation fields on `EfDetection` (all present & populated)

| Field | From | Cite |
|---|---|---|
| `confidence` Float? | `parsed.confidence` | `detection.service.ts:175` |
| `severity` Int? | `parsed.severity` (only confusion emits) | `:176` |
| `rationale` String? | `parsed.rationale`; on error holds the error/parse message | `:177, 189, 204` |
| `warning` String? | `parsed.warning` (WM & cog-flex) | `:178` |
| `promptVersion` Int | active `EfConstructPrompt.version` | `:180, 234` |
| `provider` / `model` String | resolved provider/model | `:106-107, 232-233` |
| `latencyMs` Int? | `Date.now() − callStart` per call | `:168, 181, 235` |
| `rawJson` Json? | full parsed JSON | `:179, 231` |

> **Caveat:** on failure a row is still written with `label:'error'` and null metrics (`:184-209`) — **error rows are retained** and must be filtered before analysis.

---

## 3. Learning gain (pre/post)

### 3.1 The score-bearing path

`Attempt` (`schema.prisma:491`) → `GradingResult` (`:515`). The authoritative score is `GradingResult.score` (`gradedBy` auto/manual). `Attempt.assessmentId` links an attempt to an assessment **but there is NO Prisma relation** — it is a bare `String? @db.Uuid` (`:495`), so the join is by convention, not enforced.

### 3.2 Pre/post scaffolding that exists

Two seed scripts create **parallel-form assessments on the same course** ("CS 601: AI and Uncertainty Reasoning") explicitly for learning-gain comparison:
- **Pre:** `apps/api/prisma/scripts/seed-cs601-assessment.ts` → `"Pre-study Assessment — Version 4"`, `mode:'practice'`.
- **Post** (KianYu commit `48fd93a`): `apps/api/prisma/scripts/seed-cs601-post-assessment.ts` → `"Post-study Assessment"`, `mode:'practice'`. Docstring: *"Parallel form … identical topic list, identical per-topic structure … identical point weights and difficulty/Bloom's tags, so pre/post scores are directly comparable … All questions and numbers are new."*

### 3.3 Exact per-student pre/post score pair

```
pre_score(student)  = Σ GradingResult.score
   WHERE Attempt.assessmentId = <id of "Pre-study Assessment — Version 4">
     AND Attempt.studentId = student           -- join grading_results on attempt_id
post_score(student) = same, assessmentId = <id of "Post-study Assessment">
```
Assessment IDs resolved from `assessments` by title + courseId. Per-KC scores additionally via `GradingResult → KcEvidence` (`isCorrect, score, kcId`). Secondary (timestamped) mastery-change signals: `SessionSummary.masteryDeltas` (`[{kcId,kcName,deltaP_L}]`), `derived_learning_velocity` (`masteryStart/End/Delta` per session×KC), `UserMastery.probabilityKnown` (current-state only).

### 3.4 What is MISSING for a clean gain computation

1. **No pre/post marker** — nothing flags an assessment as "pre"/"post" except its free-text `title`; both are `mode:'practice'`, so mode can't discriminate. Pairing relies on hard-coded titles.
2. **No enforced Attempt→Assessment relation** (loose Uuid, nullable).
3. **No normalized-gain field** — no `⟨g⟩ = (post−pre)/(max−pre)`, no raw-gain column. Compute in analysis.
4. **No per-student pre/post pairing view** — self-join `attempts` twice; reconcile students who took only one.
5. **`UserMastery` is overwritten, not time-versioned** — the pre-study `probabilityKnown` is unrecoverable once updated; only `SessionSummary.masteryDeltas` / `derived_learning_velocity` preserve deltas.
6. **No stored max-score per assessment** — sum `AssessmentQuestion.points` or `Question.maxScore`.
7. **Retake handling undefined** — `mode:'practice'` allows multiple attempts; no "which attempt counts" flag, so pick first/best/last explicitly.

---

## 4. Insight inventory + 10 concrete analyses

### 4.1 Analyzable signals (by table)

`ef_detections` (per message×construct), `affective_state_windows` (30s/10s engagement/boredom/confusion/frustration + mean emotions), `emotion_frames` (per-frame 8 emotions, OpenFace3 5 fps), `pyfeat_au_results` (per-frame 18 AUs), `aligned_frames` (fused pupil+gaze+18 AUs+cursor+scroll+intervention+activity+score), `derived_engagement/cognitive_load/emotion_timeline/learning_velocity/at_risk_flags`, `learning_interventions` (+ `spaced_repetition_cards` SM-2 state), `attempts`+`grading_results`+`kc_evidence`, `user_mastery` (BKT slots), `activity_logs` (43 actions + metadata incl. self-report), `session_summaries`, `webgazer_logs`, `pupil_size_logs`, and AOI allocation (`aoi_session_allocation_score`).

### 4.2 Ten analyses ranked by (effort, value)

| # | Analysis | Effort | Value | Tables / joins | Chart |
|---|---|---|---|---|---|
| 1 | Intervention completion vs dismissal per strategy | Low | High | `learning_interventions` GROUP BY `type`,`status` (or ActivityLog COMPLETED/DISMISSED); `session_summaries.interventionBreakdown` | Stacked bar per `InterventionType` |
| 2 | Confusion→frustration transition frequency | Low | High | `affective_state_windows` ordered by `windowStartWallMs`; count `dominantState` adjacencies; cross-check `ef_detections` | Transition-matrix heatmap / Sankey |
| 3 | SM-2 rating calibration vs subsequent recall | Low-Med | High | `spaced_repetition_cards` (ease/repetitions/interval) ⋈ ActivityLog `SPACED_REP_CARD_RATED` (metadata.rating) ordered by time | Line: recall success vs prior ease/rating |
| 4 | Pre→post learning gain per student & per KC | Med | High | `attempts`(assessmentId∈{pre,post}) → `grading_results.score`; per-KC via `kc_evidence`; normalize in analysis | Slopegraph pre→post; ⟨g⟩ bar per KC |
| 5 | Cognitive-load index vs assessment performance | Med | High | `derived_cognitive_load.cognitiveLoadIndex` ⋈ ActivityLog `QUESTION_ANSWERED` / `aligned_frames.attemptScore` | Scatter load vs score |
| 6 | **Self-report vs system-detected affect (validation)** | Med | **Very High** | ActivityLog `EMOTION_SELF_REPORT` (metadata.emotion) ⋈ nearest `affective_state_windows` + `ef_detections` by `occurredAt` | Confusion matrix self-report × detected |
| 7 | AOI attention-allocation decay over session time | Med | Med | gaze `webgazer_logs`/`aligned_frames` binned by session minute vs AOI regions (recompute per-bin dwell; only session-level score stored) | Line allocation vs minute |
| 8 | Question-depth / Bloom vs assessment performance | Med | Med | `questions.bloomsLevel/difficulty` ⋈ `attempts.questionId` → `grading_results.score`; dialogue depth via `ef_detections` metacognition density | Bar mean score by Bloom |
| 9 | At-risk-flag precursors (multimodal) | Med-High | High | `derived_at_risk_flags` label ⋈ preceding-window `derived_engagement` + `derived_cognitive_load` + `ef_detections` | Risk-band timeline / feature importances |
| 10 | Learning velocity vs affective/EF load | High | High | `derived_learning_velocity.velocityScore` ⋈ session-aggregated `affective_state_windows` + `ef_detections` (confusion/frustration/WM) | Scatter velocity vs mean confusion/load |

Analyses **2, 6, 8, 10** exploit the DB's unique strength — EF text-mining + facial affect + gaze/pupil + mastery together.

---

## 5. Statistics-readiness check (proposal items 15–18)

**Linchpin: self-report ground truth EXISTS.** The Emotion Self-Report Survey (KianYu commits `1f58384`, `375befe`, `eed4b21`): blocking modal `EmotionSurveyModal.tsx` with **5 fixed options** `engaged | bored | confused | frustrated | neutral`; shown **every 15 min** for students (`SURVEY_INTERVAL_MS = 15*60*1000`, `Layout.tsx:11`), mandatory; on answer `track('EMOTION_SELF_REPORT', { metadata:{ emotion } })` → written to **`activity_logs`** (`action = EMOTION_SELF_REPORT`, migration `20260701000000`), label in **`ActivityLog.metadata.emotion`**.

> **⚠ Coverage caveat (from commit `eed4b21`):** *"current 54 sessions predate the emotion survey (added live 2026-07-01), so the survey row/CSV are empty until fresh bundles are imported."* Historic sessions have **no self-report**; only sessions after 2026-07-01 carry it — a real n/power risk.

| Item | Data that EXISTS today | What is MISSING |
|---|---|---|
| **15** — validate system-detected states vs self-report | Ground truth `activity_logs.metadata.emotion` (5-class). Machine states: `affective_state_windows` {engagement, boredom, confusion, frustration, dominantState} + `ef_detections` {confusion, frustration, engagement/off-task, boredom} — **label spaces overlap almost exactly** with the 5 survey options. Time-align by `occurredAt` ↔ window wall-ms. | Only post-2026-07-01 sessions have self-reports (54 legacy empty). Sparse (1 / 15 min) vs dense windows → each report maps to many windows. "neutral" has no clean machine analogue. No agreement metric (κ/accuracy) computed anywhere. |
| **16** — t-test / one-way ANOVA phase1 vs phase2 | Continuous DVs: `grading_results.score`, `derived_learning_velocity.velocityScore`, `derived_cognitive_load.cognitiveLoadIndex`, `ef_detections.confidence`, `affective_state_windows` scores. | **No phase1/phase2 marker exists anywhere** (grep negative for `phase`/`condition`/`arm`/`group`). Phase grouping must be derived externally (date cutoff, or pre-vs-post assessment as the two conditions). |
| **17** — Mann-Whitney if normality fails | Same DVs; all per-row numeric and exportable (`analysis/export_logs.py`). | Same grouping gap as item 16. Small n threatens power; nothing in-repo computes normality (Shapiro) or the test. |
| **18** — effect sizes | All raw numbers for Cohen's d / η² / rank-biserial present; `derived_learning_velocity.masteryDelta` gives per-KC change. | **No effect-size field stored** (no Cohen's d, no ⟨g⟩ column). No variance/CI columns. Compute entirely in analysis. |

**Phase-design verdict:** there is **no `phase`/`condition`/`arm`/`group` column or metadata key anywhere**. The only structural before/after contrast the data supports is **pre-study vs post-study assessment** (§3), distinguishable **only by assessment title**. Any phase1/phase2 ANOVA will need an externally-defined grouping (date cutoff, cohort list, or the pre/post split).

### Bottom line for the viva
- **EF text-mining** is production-complete: 9 constructs, all 8 validation fields populated with exact provenance, per-message trigger, teacher overrides. Filter `label:'error'` rows.
- **Learning gain** is computable but fragile: real parallel pre/post assessments exist, but pairing is by hard-coded title, no enforced Attempt→Assessment relation, both `mode:'practice'`, no normalized-gain field; `UserMastery` is overwritten (not versioned).
- **Stats readiness:** self-report ground truth for item 15 genuinely exists and its label space matches the machine affect states — the strongest asset. The critical gaps for 16–18 are the **absence of any phase/condition marker** and any computed effect-size/normalized-gain field, plus self-report only covering post-2026-07-01 sessions.
