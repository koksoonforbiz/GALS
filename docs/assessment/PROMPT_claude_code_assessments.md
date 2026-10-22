# Prompt for Claude Code — Knowledge assessments in GALS

Paste the following into Claude Code at the root of the GALS monorepo (branch `course-prompting`). Attach or place these files first:

- `docs/process-mining/knowledge_tests_v2.json` — the item bank (sessionTests s1–s8 × forms A/B; studyTests forms A/B/C)
- `docs/process-mining/knowledge_tests_v2.pdf` — human-readable reference with keys, rubrics and the design/scoring rules (§1)
- `docs/process-mining/GALS_context_brief_2026-10-22.md` — the platform brief

---

```
You are working in the GALS monorepo (pnpm + Turborepo, NestJS + Prisma 6 API in apps/api, React 18 + Vite web in apps/web, shared Zod schemas in packages/shared). Read docs/process-mining/GALS_context_brief_2026-10-22.md first: it describes the two-door deployment, the DoorGuard route classification, the activity-log event spine, the interactive-lesson module and the course import pipeline. Follow the conventions you find there and in the existing code — in particular every new API route must be classified in docs/two-door/api-classification.md and, if the student door calls it, added to deploy/nginx/snippets/public-api-allowlist.conf.

GOAL
Add a knowledge-assessment feature to the prompting course ("Advanced Prompt Engineering and AI Collaboration — Study Edition", course id 60e2d976-9fdd-4213-86a4-a56fab51c6d6 in production) consisting of:
  1. a pre-study test and a post-study test (study-level, three alternate forms A/B/C, 24 units each), and
  2. a pre-session test and a post-session test for each of Sessions 1–8 (two alternate forms A/B per session, 8 units each).
All items come from docs/process-mining/knowledge_tests_v2.json. Do not author, reword, reorder options or re-key any item; the bank was built and audited to a table of specifications and option order and key positions are deliberate. If something in the bank looks wrong, stop and tell me rather than fixing it.

The feature must integrate with an executive-function ("cognitive warm-up") battery that exists as a separate module item type (if it does not exist yet in the codebase, stub a `CognitiveWarmup` gate interface with a `completedAt` check and tell me — do not build the battery). The ordering rules are:
  - PRE-STUDY: the learner must complete the pre-study cognitive warm-up BEFORE the pre-study test is available. The pre-study test must be completed before Session 1's module is unlocked. Enforce this server-side, not only in the UI.
  - POST-STUDY: the post-study test is available only after Session 8 is completed, and the post-study cognitive warm-up becomes available only after the post-study test is submitted. Enforce server-side.
  - PRE-SESSION: available when the session's module is unlocked; must be submitted before the first slide of the session's INTERACTIVE_LESSON opens (the lesson route 403s / redirects until then).
  - POST-SESSION: available only after the session's lesson reaches its final slide (reflect slide saved); must be submitted before the next session's module unlocks.
Read the "Design, administration and scoring" section of the PDF (§1) and implement exactly those rules; the ones that matter for code are listed below.

PART 1 — Data model (Prisma, apps/api/prisma)
Add, with a migration:
  AssessmentDefinition(id, courseId, kind enum {PRE_STUDY, POST_STUDY, PRE_SESSION, POST_SESSION}, sessionNo int? (1–8 for session kinds, null for study kinds), form enum {A, B, C}, version string "2.0", items Json (the array from the bank, verbatim), maxMarks int, createdAt)
  AssessmentAssignment(id, studentId, courseId, kind, sessionNo?, form, order string, createdAt)
    — one row per (student, kind, sessionNo). `order` records the counterbalancing scheme the student is in (see Part 3).
  AssessmentAttempt(id, assignmentId, definitionId, studentSessionId (FK to StudentSession — reuse the existing session anchor so attempts join to activity_logs), startedAt, submittedAt?, durationMs?, responses Json, autoScore Json, status enum {IN_PROGRESS, SUBMITTED, SCORED})
  AssessmentWrittenScore(id, attemptId, slot int, raterId, dimensionScores Json, total int, blindedAt, createdAt) — for the constructed-response items; two raters per response plus an adjudicator.
Index (studentId, kind, sessionNo). Attempts are append-only; never overwrite responses after submission.

PART 2 — Import (apps/api/prisma/scripts/import-knowledge-tests.ts)
Idempotent, keyed by (courseId, kind, sessionNo, form, version). Reads knowledge_tests_v2.json and creates one AssessmentDefinition per form:
  - sessionTests.s<N>.forms.A → kind PRE_SESSION|POST_SESSION are NOT distinct definitions; store form A and form B once per session and let the assignment decide which is pre and which is post (Part 3).
  - studyTests.A/B/C → likewise one definition per form.
  - maxMarks: session form = 9 (6 mcq × 1 + 1 sata × 1 + 1 open × 2); study form = 29 (20 mcq + 2 sata + open 4 + open 3). Compute from the items and assert.
Run it the same way as import-prompting-course.ts (bind-mounted src on the prod image). Refuse to overwrite an existing definition of the same key unless --force is passed, and never alter a definition that has attempts.

PART 3 — Assignment and counterbalancing (service in apps/api/src/assessments/)
On first enrolment-time access (or a `POST /api/assessments/courses/:courseId/assign-me`), create the student's assignments deterministically from a seeded RNG keyed on (studentId, courseId) so re-running is idempotent:
  - Study: assign one of the six permutations of A,B,C to (baseline, post-study, delayed-follow-up). Baseline and post-study use the first two; the third is reserved (store it) for a delayed test that is not built now. Stratify by the student's experimental condition if the enrollment carries one (look for an existing condition field; if none exists, stratify on nothing and leave a TODO).
  - Each session: assign A-before/B-after or B-before/A-after, balanced across students (alternate by enrolment order within condition).
  - Expose the assignment read-only to teachers/admin (`GET /api/assessments/courses/:courseId/assignments.csv`).

PART 4 — API (apps/api/src/assessments/, Zod schemas in packages/shared)
Student door (@PublicDoor, enrolment-checked, rate-limited like other student routes):
  GET  /api/assessments/courses/:courseId/status
       → for the student: which assessments exist, which are available now, which are locked and WHY (e.g. "complete pre-study cognitive warm-up"), which are submitted. The web client renders purely from this; no gating logic in the client.
  POST /api/assessments/attempts            {kind, sessionNo?}  → creates an IN_PROGRESS attempt if the gate allows; 403 with a machine-readable reason code otherwise. Returns the definition's items WITHOUT `correct` flags, `rubric` or `objective` (strip them server-side; add a unit test that proves the student payload never contains these fields).
  PATCH /api/assessments/attempts/:id       {responses} → autosave partial responses (≤32 KB, same size discipline as lesson_slide_states).
  POST /api/assessments/attempts/:id/submit → final; computes autoScore for mcq/sata; locks the attempt; emits the activity-log events below; returns only {submitted: true}. Never return scores or keys to students.
Private door (@PrivateDoor, teacher/admin):
  GET  /api/assessments/courses/:courseId/definitions
  GET  /api/assessments/courses/:courseId/attempts.csv       (one row per attempt: studentId, kind, sessionNo, form, order, startedAt, submittedAt, durationMs, omittedCount, autoTotal, writtenTotal?, flags)
  GET  /api/assessments/courses/:courseId/responses.csv      (long format: attemptId, slot, type, response, autoScore)
  GET  /api/assessments/attempts/:id/written                 → the open-response texts for blinded scoring, with studentId, condition, form and time-point REMOVED from the payload; include only an opaque attemptId and slot.
  POST /api/assessments/attempts/:id/written/:slot/score     {dimensionScores} → one row per rater; a rater cannot score the same slot twice; adjudication is a third row with role ADJUDICATOR.
  GET  /api/assessments/courses/:courseId/inter-rater        → per-dimension raw agreement and Cohen's κ (quadratic-weighted for the 4-mark item) across double-scored responses.
Classify every route in docs/two-door/api-classification.md and add the student-door ones to the nginx allowlist.

PART 5 — Scoring (pure functions in packages/shared, with unit tests)
  mcq: 1 if the selected option id is the keyed one, else 0; blank = 0 and counted as omitted.
  sata: exactly three keyed options of five. score = max(0, (correctSelections − incorrectSelections) / 3). Selecting all five = 1/3. This is the only rule; do not implement exact-match as an option.
  open: not auto-scored; maxMarks from the bank; scored per rubric dimension (0/1 each) by raters via Part 4.
  Attempt autoTotal = sum of mcq + sata. Written total is added only when ≥2 rater rows exist and either agree or an adjudication row exists.
  Data-quality flags on the attempt: `fastCompletion` if durationMs < one-third of the running median for that definition (compute at export time, do not exclude), `omitted` count, `autosaveOnly` if submitted with no change since the last autosave.

PART 6 — Web (apps/web/src, student bundle only for taking; admin bundle for review)
  Student:
  - A route per assessment reached from the course page: /courses/:courseId/assessment/:kind[/:sessionNo]. One item per screen, scroll-snap style consistent with the InteractiveLesson component; "Next" does not require an answer (guessing is encouraged but skipping is allowed and recorded as omitted); a final review screen lists unanswered items before submit; submit requires explicit confirmation; once submitted the route shows only "Submitted — thank you" and never the items again.
  - MCQ: single select. SATA: checkboxes with the instruction "Select all that apply". Open: textarea, no minimum length, 2,000-char cap, char counter.
  - Timer: show elapsed time, no time limit; record durationMs.
  - Gating UI: the course page shows each assessment as a card with the status from /status; locked cards display the server's reason text. The pre-study card is the only thing visible on the course page until the cognitive warm-up is complete; Session 1 appears only after the pre-study test is submitted; later sessions appear only after the previous session's post-session test is submitted.
  - Autosave every 10 s and on blur, through PATCH.
  - No copy of items, keys or scores is persisted in the client beyond the in-progress responses.
  Admin:
  - Assessments tab on the course page: definitions, assignment CSV, attempts CSV, responses CSV, inter-rater summary, and a blinded written-scoring queue (shows one response at a time, no identifying fields, rubric dimensions as checkboxes, records the rater).

PART 7 — Activity-log events (extend the ActivityAction enum and lessonEvents.ts; follow the existing batching through /api/activity-log/batch)
  ASSESSMENT_OPENED {kind, sessionNo, form, order}
  ASSESSMENT_ITEM_VIEWED {slot, type, msFromOpen}
  ASSESSMENT_ITEM_ANSWERED {slot, type, changed: bool, attemptNo}     — never the answer text; for mcq/sata record the option ids only; for open record chars only (text lives in responses, subject to the existing text-capture consent in the same way as lesson text: with consent the response text is stored; without it, store chars and a one-way hash)
  ASSESSMENT_ITEM_SKIPPED {slot}
  ASSESSMENT_SUBMITTED {kind, sessionNo, form, durationMs, omitted}
  ASSESSMENT_GATE_BLOCKED {kind, sessionNo, reason}                    — emitted server-side when a 403 is returned, so attempts to skip ahead are visible in the event log
These should flow through the learning-events coverage report as notApplicable for the M-rules (they are measurement, not learning process) and appear in the bupaR event-log export as their own activity names.

PART 8 — Tests and verification
  - Unit: scoring functions (incl. the sata edge cases 3/3, 3+2, 2+0, 0+5, blank); payload-stripping test; gate logic for all four kinds in every state; assignment determinism and balance.
  - E2E (Playwright, existing setup): a student cannot reach the pre-study test before the warm-up, cannot open Session 1 before submitting the pre-study test, cannot open Session 2 before Session 1's post-session test, cannot open the post-study warm-up before the post-study test; a submitted attempt is immutable; the student payload contains no keys.
  - Importer: dry run prints the definitions and maxMarks; run it against a local DB and confirm 16 session definitions (8 sessions × A/B) + 3 study definitions.
  - Door classification: lint/test that every new route is listed in api-classification.md.

DELIVERABLES
  A single PR on branch course-prompting with: migration, importer, assessments module, shared schemas + scoring, web routes (both bundles), route classification + nginx allowlist, tests, and a short docs/assessments/README.md covering: how to import, how counterbalancing is assigned, the scoring rules, how to run blinded scoring, how to export for analysis, and the exact gate order (pre-study warm-up → pre-study test → S1 pre → S1 lesson → S1 post → S2 pre → … → S8 post → post-study test → post-study warm-up). Do not deploy; I will build the image on the laptop and ship it to lithium per the runbook.

CONSTRAINTS
  - Keep the course import untouched; assessments are separate from lessonJson and from slide keys.
  - Never expose keys, rubrics, objectives or scores on the student door; never log answer text to activity_logs.
  - Respect the existing text-capture consent and retainText behaviour for open responses.
  - No new external dependencies on the student bundle.
  - Ask me before changing anything in auth, DoorGuard or the activity-log batch contract.
```
