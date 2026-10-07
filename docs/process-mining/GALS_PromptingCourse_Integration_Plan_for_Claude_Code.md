# GALS × Prompting Course — Integration & Learning-Event Capture Plan for Claude Code (v1.0)

**Date:** 2026-10-07
**Read together with (put these in the repo under `docs/process-mining/` before starting):**

- `course_slides_v01.html` — the prompting course (8 sessions, ~190 slides; course data is a JSON object inside its `<script>`; its `logEvent()` emits 13 event types).
- `Process_Mining_Library_v2.xlsx` — the action library (83 action events), course crosswalk, 36 mapping rules (M01–M35 + M03b), 12 parameters, validation template. **This workbook is the source of truth for event names, payload fields and rule logic.**
- `Process_Mining_Pipeline_for_the_Working-Adult_ITS.md` — the pipeline design.
- `GALS Action Library Review (v2)` — the research rationale (sections 1–4).
- Existing GALS docs: `Platform_Archiecture_20260531`, `04_sensing_and_logging.md`, `01_functionality_inventory.md`, `03_learning_modes_and_interventions.md`, the Two-Door spec and execution plan.

**Goal:** run the prompting course _inside_ GALS so every learner action in it — including the prompting work that today happens in an external AI tool — is captured as a raw action, parsed into learning events, validated against think-aloud coding, analysable by process mining, and (only once validated) able to trigger interventions.

---

## 0. Rules of engagement (binding)

1. **The code wins over every document, including this one.** All file/line references below come from the GALS docs and may be stale. Verify each before acting. Never invent a file, table, enum value or endpoint you cannot find; if something is missing, say so and propose.
2. **Phase 0 is read-only and ends in a mandatory stop.** Present the discovery report and wait for approval before writing code.
3. **Additive only.** Do not change existing ActivityAction semantics, existing log tables, JWT/RBAC, or the biometrics pipeline. New enum values, new tables and new modules are fine.
4. **Do not break the dev profile** (Vite HMR 5173 + API 3000) or the Two-Door work. Every new route must be classified student/teacher per the Two-Door spec (method + path granularity).
5. **Respect the existing privacy posture** (`04_sensing_and_logging.md` §6): no raw keystrokes, no clipboard text. Where this plan needs text, it is _submitted_ text the learner deliberately saves (same status as `ChatbotMessage`), gated by consent (§Phase 6).
6. **Capture failure must never block the learner.** Same invariant as the replay recorder: triple try/catch, fire-and-forget, graceful drop on Postgres error, hex-escape sanitiser on JSON payloads.
7. Items marked **[VERIFY]** need checking in code; **[HUMAN DECISION]** need the user — propose a default, do not block on it unless stated.
8. Work in small PRs, one per phase step, each with tests. Migrations timestamp-prefixed as the repo already does.

---

## Phase 0 — Discovery (READ-ONLY; ends in a mandatory stop)

Produce `docs/process-mining/PHASE0_DISCOVERY.md` containing:

1. **Course model:** how `Course → Module → ModuleItem` is stored (`schema.prisma`), the `ModuleItem` type enum (expected `PAGE | PDF | LINK | ASSESSMENT`), how PAGE content is stored (`contentMdx` block JSON?) and rendered (TipTap read-only? MDX?). [VERIFY]
2. **Logging spine:** `ActivityAction` enum file and its Prisma counterpart (is it a Prisma enum or a string column?), `track()` signature in `lib/activity-log`, `POST /activity-log/batch` DTO validation, flush cadence (expected 30 s), metadata size limits.
3. **Existing raw streams you can reuse:** `visibility_logs`, `clipboard_logs` (length + `sourceElement`), `keystroke_logs` (per-field aggregates on blur), `scroll_logs`, `session_replay_snapshots` + `scrollHosts`, `data-replay-region` AOIs. Note exactly what each stores.
4. **The inner-scroll caveat:** confirm lesson content scrolls inside an inner `overflow-y-auto` container in the docked layout (so any IntersectionObserver must use that container as `root`, not the viewport).
5. **LLM access:** the `rag` LLM client, per-course API key / `llm-settings`, how `ChatbotMessage` stores model and token counts. Can a student-door route call the LLM client safely? Rate limiting? [VERIFY]
6. **Interventions:** confirm interventions are never auto-triggered today (only `student_initiated` / `pre_generated` trigger reasons).
7. **Researcher tooling:** `ReplayCode` / `ReplayAnnotation` (retrospective coding), CSV exporters (`exportReplayCsv.ts`, gals-studio cohort ZIP). These will be reused for validation.
8. **Course HTML:** extract the course data object from `course_slides_v01.html`; list slide types and counts (expected: theory 48, exercise 20, figure 19, stretch 9, and 8 each of objectives, think, predict, mcq, example, misconceptions, concept, check, task, selfscore, reflect) and the 13 `logEvent` types with payloads.
9. A table: **every action in `Process_Mining_Library_v2.xlsx` → "already captured by" (existing enum/table) / "new enum value" / "derived server-side" / "not applicable to this course"**.
10. Your proposed answers to the [HUMAN DECISION] items below.

**STOP. Wait for approval.**

---

## Phase 1 — Import the course as native GALS content

**Why:** the HTML stores logs in `localStorage` and a manual JSON download. Running it inside GALS gives server-side, session-anchored, replayable logs for free.

1. **Extraction script** `apps/api/prisma/scripts/import-prompting-course.ts`: parse the course JSON from the HTML → one `Course`, 8 `Module`s (one per session), one `ModuleItem` per session containing the ordered slide list. Idempotent (upsert by stable slide key, which the HTML already uses as `slide` ids). Keep stable `slideKey`s — every event depends on them.
2. **Item type. [HUMAN DECISION]** Default proposal: add a new `ModuleItem` type `INTERACTIVE_LESSON` whose content is the slide JSON (type, title, body, options, reference answers, criteria). Alternative: TipTap custom nodes inside `PAGE`. The default is preferred because the interactive slide types carry gated state (commit-before-reveal) that is awkward in a rich-text editor.
3. **Renderer** `components/interactive-lesson/` (student-only per Two-Door import rules): one React component per slide type, reproducing the HTML's behaviour exactly, including the gates (≥ 20 chars before a think/predict reveal; ≥ 8 chars for a misconception reason; reveal only after an answer is saved). Wrap the lesson in `data-replay-region="lesson"`; give each slide `data-slide-key` and `data-slide-type`.
4. **Learner state** (answers, reveals, self-scores) persisted server-side per student (new table `lesson_slide_state`, or reuse an existing per-item progress table if one exists [VERIFY]), so reloads don't lose work and analysis doesn't depend on localStorage.
5. Teacher side: the course appears in the course builder as read-only for v1 (editing interactive slides is out of scope). [HUMAN DECISION]

**Done when:** a student can complete Session 1 in GALS with identical behaviour to the HTML, and the replay tab shows it.

---

## Phase 2 — Step 1 of the plan: fix the logger (raw action layer)

Emit every course-native event through the existing `track()` spine, with new `ActivityAction` values. Reuse existing values where semantics match; never overload an existing value with new meaning.

### 2.1 Event catalogue for this course

Names follow the v2 library. `metadata` always includes `courseId, moduleId, moduleItemId, slideKey, slideType, libraryVersion: "v2"`; the activity-log row already carries session/user/time.

| HTML `logEvent` (today)                                                         | ActivityAction (new unless noted)                                           | Extra metadata                                                                           |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `slide_viewed`                                                                  | `SLIDE_ENTERED`                                                             | `visitNo` (1 = first read, ≥2 = revisit)                                                 |
| — (new)                                                                         | `SLIDE_EXITED`                                                              | `dwellMs`, `maxVisiblePct`                                                               |
| `think_submitted`, `predict_submitted`                                          | `PREDICTION_COMMITTED`                                                      | `chars`, `text`, `msOnSlide`, `confidence?`                                              |
| `predict_revealed`, `check_revealed`, `expect_revealed`, `misconception_opened` | `REFERENCE_REVEALED`                                                        | `revealKind` (`predict`/`check`/`expect`/`misconception`), `item?`, `msSinceCommit`      |
| `check_missed_noted`                                                            | `GAP_NOTED`                                                                 | `item`, `chars`, `text` (log `chars:0` explicitly as "no gap stated")                    |
| `misconception_committed`                                                       | `BELIEF_COMMITTED`                                                          | `item`, `choice`, `chars`, `text`                                                        |
| `misconception_changed`                                                         | `BELIEF_REVISED`                                                            | `item`, `changed`                                                                        |
| `mcq_answered`                                                                  | `QUESTION_ANSWERED` **(existing — verify semantics)** or new `MCQ_ANSWERED` | `option`, `correct`, `attemptNo`, `misconceptionId` (from distractor tag), `confidence?` |
| `mcq_rationale`                                                                 | `RATIONALE_SUBMITTED`                                                       | `chars`, `text`                                                                          |
| `check_answered`                                                                | `SELF_CHECK_SUBMITTED`                                                      | `item`, `chars`, `text`                                                                  |
| `results_submitted`                                                             | `RESULTS_RECORDED`                                                          | `chars`, `text` (replaced by the structured lab form in Phase 3)                         |
| `selfscore_set`                                                                 | `CRITERION_SELF_SCORED`                                                     | `criterion`, `value`                                                                     |
| `reflect_submitted`                                                             | `REFLECTION_SUBMITTED`                                                      | `parts: {whatWorked, whatToChange, nextRealTask}`, `chars`                               |
| — (new)                                                                         | `CONFIDENCE_RATED`                                                          | `item`, `value` (1–5), `timing` (`before`/`after`)                                       |
| — (new)                                                                         | `ATTEMPT_STARTED`                                                           | `fieldKey`, `msFromSlideEnter` (first input in a textarea)                               |
| — (new)                                                                         | `IDLE_STARTED` / `IDLE_ENDED`                                               | `idleMs` (threshold from config, default 120 s)                                          |
| — existing                                                                      | `SESSION_START` / `SESSION_END` / `MODULE_ITEM_VIEWED`                      | reuse                                                                                    |
| — existing stream                                                               | `visibility_logs`                                                           | reuse for FOCUS_LOST/RETURNED — do **not** duplicate as activity events                  |

### 2.2 Implementation notes

1. **Dwell:** `useSlideDwell` hook using IntersectionObserver with `root` = the lesson's inner scroll container (see Phase 0 item 4). A slide is "entered" at ≥ 50% visible, "exited" when it drops below; pause the dwell clock while `document.hidden` or idle. Emit `SLIDE_EXITED` on exit, route change and `pagehide` (`keepalive`).
2. **Text capture:** only on deliberate save (the same moment the HTML logs `*_submitted`). Cap at 4,000 chars, run the existing hex-escape sanitiser, and respect the consent flag (Phase 6); without consent, send `chars` only.
3. **Confidence ratings:** add a 1–5 control to the 8 MCQ slides (before answering) and the 8 Predict slides (after committing). Small, optional, one tap.
4. **Distractor tags:** add `misconceptionId` to each MCQ option in the imported JSON. [HUMAN DECISION] on the mapping — propose one from the session's Misconceptions slide and list it for review.
5. **Self-score criteria visible early:** show each session's self-score criteria on its Objectives slide so `REQUIREMENTS_VIEWED` becomes observable (the slide's `SLIDE_EXITED.dwellMs` is the measurement).
6. **Enum migration:** add values in one migration; update the CSV exporter's curated-actions list so new actions appear as rows rather than in `activity_other`.
7. **Tests:** unit tests per slide component asserting the exact event sequence and metadata for a scripted interaction; one Playwright test completing a slide of each type.

**Done when:** a scripted run through Session 1 produces the expected ordered event log in `activity_logs`, with dwell and no `localStorage` dependence.

---

## Phase 3 — Step 2: bring exercises and labs on-platform (AI-interaction layer)

28 slides (20 `exercise`, 8 `task`) currently send learners to an external AI tool. Replace that with an in-GALS **Prompt Lab** so prompting behaviour becomes observable.

### 3.1 Backend module `apps/api/src/prompt-lab/` (student door: PUBLIC; reads for teachers: PRIVATE)

New tables (Prisma):

- `PromptLabRun` — `id, studentId, sessionId, moduleItemId, slideKey, versionNo, promptText, systemText?, model, modelVersion, temperature, topP?, maxTokens, toolsEnabled, promptTokens, completionTokens, responseText, responseId, latencyMs, createdAt, parentRunId?` (`parentRunId` links a regenerate or revision to its source).
- `PromptLabVersion` — `id, studentId, slideKey, versionNo, promptText, tokenCount, revisionTags[]` (`context|constraint|example|format|role|compression|reasoning|other`), `diffFromPrev` (char-level stats only), `createdAt`.
- `PromptLabTestResult` — `id, versionId, runId?, testCaseKey, pass (bool), failureReason` (`missing_fact|ambiguity|instruction_dropped|format|other`), `note?`.
- `PromptLabOutputRating` — `id, runId, criteria (JSON), verifiedClaim?, verifyVerdict?` (`supported|unsupported|unsure`).

Endpoints: `POST /prompt-lab/run` (calls the existing LLM client — **do not add a new provider**), `POST /prompt-lab/versions`, `POST /prompt-lab/test-results`, `POST /prompt-lab/ratings`, `GET /prompt-lab/me?slideKey=` (student), `GET /prompt-lab/students/:id` (teacher, PRIVATE door).
Guardrails: per-student rate limit and daily token budget per course (config, defaults [HUMAN DECISION]: 60 runs/hour, 200k tokens/day); model allow-list from `llm-settings`; log token usage like `ChatbotMessage`.

### 3.2 Frontend `components/prompt-lab/` (student-only)

Replace the external-tool instruction and free-text results box on each exercise/task slide with a panel that mirrors the course's own lab steps:

1. **Plan:** goal / audience / output-format line + run settings (model, temperature, tools) prefilled from the slide's instructions.
2. **Prompt:** editor with live token count (reuse the course's token-counter logic), "Run", "Run N samples" (declared experiment), "Save as version" with revision-tag chips.
3. **Inspect:** response panel tagged `data-replay-region="ai-output"` and `data-gals-ai-output="<responseId>"` (for dwell and copy detection).
4. **Judge:** a test-case table generated from the slide (e.g. Lab 1.7's two questions) with pass/fail + failure-reason dropdown; a 3–5-criterion rating of the output.
5. **Verify:** one "check this claim against the course pack" field on at least one exercise per session.
6. **Results:** the structured data above _is_ the result; keep a short free-text "what I learned" box (`RESULTS_RECORDED`).

### 3.3 AI-interaction events (new ActivityAction values)

| Action                                   | Fires when                                           | Metadata                                                                                                                                                                          |
| ---------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUN_SETTINGS_RECORDED`                  | settings saved before first run                      | `model, temperature, toolsEnabled`                                                                                                                                                |
| `PROMPT_GOAL_DECLARED`                   | plan line saved                                      | `chars` (+ text if consented)                                                                                                                                                     |
| `PROMPT_SUBMITTED`                       | Run pressed                                          | `runId, versionNo, promptTokens`                                                                                                                                                  |
| `OUTPUT_REGENERATED`                     | rerun of an unchanged prompt                         | `runId, parentRunId, declaredExperiment`                                                                                                                                          |
| `AI_OUTPUT_VIEWED`                       | response panel exits view or the next action happens | `runId, dwellMs, responseWords`                                                                                                                                                   |
| `PROMPT_VERSION_SAVED`                   | Save as version                                      | `versionId, versionNo, tokenCount, editRatioFromPrev`                                                                                                                             |
| `PROMPT_REVISION_TAGGED`                 | tags set on a version                                | `versionId, tags[]`                                                                                                                                                               |
| `TOKEN_COUNT_CHECKED`                    | token counter used                                   | `chars, tokens, learnerGuess?`                                                                                                                                                    |
| `TEST_CASE_RUN` / `TEST_RESULT_RECORDED` | test row run / judged                                | `versionId, testCaseKey, pass, failureReason`                                                                                                                                     |
| `OUTPUT_RATED`                           | rubric rating saved                                  | `runId, criteria`                                                                                                                                                                 |
| `OUTPUT_VERIFIED`                        | claim check saved                                    | `runId, verdict`                                                                                                                                                                  |
| `OUTPUT_COPIED`                          | `copy` inside `[data-gals-ai-output]`                | `runId, chars` — **no text**                                                                                                                                                      |
| `OUTPUT_PASTED`                          | `paste` into any GALS answer field                   | `targetField, chars, matchesAiOutput, runId?` — compute the match **client-side** against the last N responses in memory (normalised exact/near match); never send clipboard text |
| `OUTPUT_EDITED`                          | on save of a field that received an AI paste         | `editRatio` (changed chars ÷ pasted chars)                                                                                                                                        |

Also **classify learner prompts** (`AI_HELP_PROMPT_CLASSIFIED`, system event): async job labelling each `PromptLabRun.promptText` and each chatbot USER message as `instrumental | executive | conceptual | verification | off_topic | task_prompt` using the existing LLM client with a versioned codebook prompt. Store `label, classifierVersion, model`. Mark unvalidated until Phase 5 reports human–LLM κ.

**Done when:** Lab 1.7 can be completed entirely in GALS and its event log shows plan → runs → versions with tags → test results → rating, with no external tool.

---

## Phase 4 — Process layer (derived learning events)

Learning events are **computed server-side from raw actions, never decided in the browser**, so rules can be re-run when parameters or the library change.

1. **Config:** generate `apps/api/src/learning-events/config/library.v2.json` from the workbook (a script reading `Process_Mining_Library_v2.xlsx`: Action Events, Mapping, Parameters). The Parameters sheet's values become defaults in a `learning_event_parameters` table (editable by researchers, versioned).
2. **Table `learning_events`:** `id, studentId, sessionId, moduleItemId, slideKey?, ruleId (M01…), eventFamily, startAt, endAt, sourceActionIds[], confidence ('candidate'|'validated'), libraryVersion, parameterSetVersion, computedAt`.
3. **Parser service `learning-events/`:** per session, order raw actions (activity_logs + prompt-lab tables + visibility_logs) by wall clock using the existing sync-anchor time base, then apply rules as windowed sequence matchers. Implement as small pure functions, one per rule, each unit-tested with fixtures. Run on `SESSION_END` (queue job) plus a backfill command.
4. **Rules to implement first** (from the Mapping sheet; parameters in brackets):
   - M03 / M03b information access vs re-reading (`visitNo`, [T_read]).
   - M05 forethought: `PREDICTION_COMMITTED` before the related theory slide.
   - M13 monitoring: `CONFIDENCE_RATED`.
   - M14 evaluation: `CRITERION_SELF_SCORED`, `SELF_CHECK_SUBMITTED`.
   - M15 reference comparison: commit → `REFERENCE_REVEALED` → `GAP_NOTED` (chars > 0) within [W_seq]; without `GAP_NOTED` = "reference exposure".
   - M16 belief revision: `BELIEF_COMMITTED` → `REFERENCE_REVEALED` → `BELIEF_REVISED` (three outcomes per the sheet).
   - M22 self-appraisal + forward planning from `REFLECTION_SUBMITTED.parts.nextRealTask`.
   - M23 calibration: confidence vs `correct`; self-score vs external score where available.
   - M24 low-effort commit: chars ≤ min + [ε_chars] and `msOnSlide` < [T_rapid], then reveal.
   - M25 off-task: visibility hidden or idle > [T_idle]; excluded from time-on-task.
   - M26–M33 AI interaction: planning, evaluation-driven revision [T_out], unreflective regeneration (exclude `declaredExperiment`), systematic testing, verification, passive reliance, active use [E_edit], help type.
   - Then the remaining rules on the sheet that this course can fire. Rules whose inputs this course never emits (hints, notes, peer help) are registered but report "no input".
5. **Note on M10 (answer dependence):** reveals in this course are gated behind the learner's own attempt — map them to M15, never M10.
6. **Coverage report:** for each rule, the share of sessions where it could fire and did fire. Rules with zero coverage are flagged, not silently dropped.

**Done when:** running the parser on a scripted session yields the expected `learning_events` rows, and changing a parameter and re-running changes them predictably.

---

## Phase 5 — Step 3 and Step 4: validation and analysis tooling

### 5.1 Validation (think-aloud) — reuse replay coding

1. Seed a researcher `ReplayCode` set: Bannert codes (orientation, planning, goal specification, monitoring, evaluation, first reading, re-reading, elaboration/organisation) + AI codes (prompt planning, evaluation-driven revision, unreflective regeneration, verification, passive use, active use, executive request, instrumental request).
2. Think-aloud sessions (10–15 working adults, two labs each) are recorded with the existing pipeline (audio is off by design — think-aloud audio is recorded **outside GALS** under the study's ethics protocol and aligned by wall-clock; [HUMAN DECISION]). Researchers code segments as `ReplayAnnotation` ranges on the session timeline.
3. **Validation report endpoint** (teacher/PRIVATE): for each rule, align `learning_events` with annotations on the shared time base (tolerance window configurable) and compute TP/FP/FN/TN → match rate, sensitivity, specificity — the same formulas as the workbook's Validation sheet. Export as CSV in that sheet's column order. Also export inter-rater agreement where two researchers coded the same session.
4. **Classifier check:** export a stratified sample of 200 classified prompts for double human coding; compute human–human and human–LLM κ. Only flip `AI_HELP_PROMPT_CLASSIFIED` to "validated" if human–LLM κ ≥ 0.6 [HUMAN DECISION on threshold].
5. Rules reaching the agreed threshold get `confidence = 'validated'` via a researcher action (logged, reversible).

### 5.2 Analysis exports (Step 4)

1. **Event-log export** for process mining: one CSV per cohort with `case_id` (student × module item or student × session), `activity` (raw action or learning-event family — selectable), `timestamp_start`, `timestamp_end`, `resource`, plus `libraryVersion` and `parameterSetVersion`. Column names compatible with `bupaR::eventlog()` and pMineR. Pseudonymised `case_id` by default.
2. **Outcome table** per student: transfer-task score, delayed-test score, self-scores, MCQ accuracy, calibration bias.
3. Add both to the gals-studio cohort ZIP **[VERIFY]** where its exporters live; keep the replay CSV unchanged apart from new action rows.
4. No in-app process-mining visualisation in v1 — analysis runs in R/Python on the export. [HUMAN DECISION]

### 5.3 Transfer task

Add one unassisted transfer prompt-writing task per module (`ASSESSMENT` item or Prompt Lab in "no-run" mode — the learner writes a prompt for a new scenario without running it). Graded with the same rubric; emits `TRANSFER_TASK_SUBMITTED`. This is the outcome used to judge whether any process matters.

---

## Phase 6 — Step 5 and Step 6: interventions and governance

### 6.1 Interventions (feature-flagged OFF by default)

This is the first **rule-triggered** intervention path in GALS (today only `student_initiated` and `pre_generated` exist). Build it so nothing fires until a researcher enables a validated rule.

1. `intervention_policies` table: `ruleId, enabled (default false), requiresValidated (default true), message template, maxPerActivity (default 1), cooldownMinutes, abArm?`.
2. Trigger evaluation runs **online** for a small set of fast rules in the browser-to-API path, reading recent actions for the current item; all firing decisions are logged with the new trigger reason `rule_triggered` and existing `INTERVENTION_TRIGGERED / VIEWED / COMPLETED / DISMISSED`.
3. Starter policies (all disabled until validated):

| Rule                          | Nudge                                                                  |
| ----------------------------- | ---------------------------------------------------------------------- |
| M31 passive reliance          | "Before using this, check one claim and name one change."              |
| M28 unreflective regeneration | Show the rubric; ask what is wrong before resending.                   |
| M15 reveal without gap noted  | "Name one thing your answer missed or would change."                   |
| M16 persistent misconception  | Offer to reopen the related theory slide.                              |
| M24 low-effort commit         | "Add a sentence on why — it makes the reveal more useful." No penalty. |
| M25 long idle on return       | Resume card with a 2-minute recap question.                            |

4. Every nudge explains why it appeared, can be dismissed, and respects `maxPerActivity`. Support A/B arms per policy so effects are measured on transfer scores, not completion.
5. **Practice tutor guardrail:** the Prompt Lab's AI is a tool, not a tutor. If a "help" chat is added to exercises, use a hint-giving system prompt (no finished prompts), per Bastani et al. 2025. [HUMAN DECISION]

### 6.2 Governance

1. **Consent:** add a per-course `TextCaptureConsent` modelled on `RecordingConsent`, covering (a) storing submitted answer text, (b) storing prompts and AI outputs, (c) research use. Without (a)/(b), log `chars` only and do not store prompt text beyond the session's working copy [HUMAN DECISION on retention].
2. **Learner notice:** a short plain-language panel on the course landing page: what is logged, why, how it is used for feedback, how to opt out of research use.
3. **Redaction:** before any export or LLM classification, run a PII/confidential-content scrub on text fields (emails, phone numbers, names list, configurable org terms). Working adults may paste workplace material.
4. **Pseudonymisation:** exports use a salted hash of `studentId`; the salt lives in env config, never in exports.
5. **Purge behaviour:** decide and document whether `PromptLab*` rows cascade with `StudentSession` (recommend: cascade with the student, like `ChatbotMessage`, not the session). Write it into `04_sensing_and_logging.md`.
6. **Two-Door:** add `prompt-lab` student routes to the PUBLIC set and teacher reads, validation, policies and exports to the PRIVATE set; add them to the door-guard tests.

---

## Phase 7 — Verification checklist (what the user clicks through)

1. Complete Session 1 as a student: every slide type works and gates exactly as in the HTML.
2. Teacher Replay tab for that session shows the new actions on the timeline; CSV export contains them as named rows.
3. Complete Lab 1.7 fully in the Prompt Lab: runs, three saved versions with tags and token counts, test results, a rating, a verification.
4. Copy an AI output and paste it into an answer field: `OUTPUT_COPIED` and `OUTPUT_PASTED (matchesAiOutput=true)` appear; no clipboard text is stored anywhere (check the DB).
5. Run the parser: `learning_events` rows match a hand-written expected list for the scripted session.
6. Change `T_rapid` and re-run: M24 rows change accordingly.
7. Add two ReplayAnnotations and open the validation report: match rate, sensitivity and specificity compute.
8. Export the process-mining CSV and load it with `bupaR::eventlog()` without errors.
9. With all intervention policies disabled, no nudge ever appears; enable one in a test course and trigger it.
10. Revoke text-capture consent: subsequent events carry `chars` only.

---

## Phase order and stops

| Phase                        | Plan step       | Stop after?                                                                                           |
| ---------------------------- | --------------- | ----------------------------------------------------------------------------------------------------- |
| 0 Discovery                  | —               | **Yes — mandatory**                                                                                   |
| 1 Course import              | prerequisite    | Yes — demo Session 1                                                                                  |
| 2 Logger                     | Step 1          | No                                                                                                    |
| 3 Prompt Lab                 | Step 2          | Yes — demo Lab 1.7                                                                                    |
| 4 Process layer              | Step 4 (parser) | No                                                                                                    |
| 5 Validation + exports       | Steps 3–4       | Yes — before any pilot                                                                                |
| 6 Interventions + governance | Steps 5–6       | Governance must ship **before** the pilot; interventions stay disabled until validation results exist |
| 7 Verification               | —               | Final                                                                                                 |

## Open [HUMAN DECISION] items (collected)

1. `INTERACTIVE_LESSON` item type vs TipTap nodes (default: new item type).
2. Teacher editing of interactive slides in v1 (default: read-only).
3. Distractor → misconception mapping for the 8 MCQs (Claude Code proposes; you approve).
4. Prompt Lab rate limits and token budget (default 60 runs/hour, 200k tokens/day per student per course).
5. Think-aloud audio capture and alignment outside GALS.
6. Human–LLM κ threshold for the prompt classifier (default 0.6).
7. In-app process-mining views (default: none in v1; export only).
8. Help chat inside exercises and its hint-only system prompt.
9. Text retention period and purge behaviour for prompt/answer text.
