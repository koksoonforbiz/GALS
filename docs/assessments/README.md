# Knowledge tests

Pre/post-study and pre/post-session knowledge tests for the prompting course, from the item bank `docs/assessment/knowledge_tests_v2.json` (v2.0). Code: `apps/api/src/knowledge-tests/`, scoring in `packages/shared/src/knowledge-tests.ts`, student page `apps/web/src/pages/student/knowledge/`, staff page `apps/web/src/pages/teacher/knowledge/`.

In the code and the event log the feature is called **knowledge tests** (`/api/knowledge-tests`, `KnowledgeTest*` tables, `KNOWLEDGE_TEST_*` actions). The quiz feature already owns `/api/assessments`, the `Assessment` tables, the `ASSESSMENT_*` actions and the `/student/courses/:id/assessment/:id` page. Students see "Knowledge check …".

## Gate order

Enforced on the server with course gates (`course_gates`, kind `KNOWLEDGE_TEST`), in one strict sequence with the EF warm-up (`docs/EF_battery_v2/`):

```
pre-study warm-up (EF T0, gates 10/20 before Session 1)
→ pre-study test (30, before Session 1)
→ S1 pre-session test (40, before Session 1) → S1 lesson → S1 post-session test (800, after Session 1)
→ S2 pre … → S8 post (800, after Session 8)
→ post-study test (900, after Session 8)
→ post-study warm-up (EF T2, after the last module)
```

- A test is available only when its gate is next. A pre-session gate sits before its session's module, so the lesson (and everything else in that module) stays locked until the test is submitted.
- A post-session test also needs that session's lesson finished: the student has saved its reflect slide (or its last slide, if it has none).
- Every refusal is a 403 with a reason code (`PREVIOUS_STEP`, `LESSON_NOT_FINISHED`, `ALREADY_SUBMITTED`, `NOT_CONFIGURED`) and is logged as `KNOWLEDGE_TEST_GATE_BLOCKED`.
- On the course page only what is open shows: locked sessions are hidden, and the checklist shows the next step and how many are done.

## Import

```sh
pnpm --filter @ats/api run import:knowledge-tests -- --course-id <uuid> --dry-run
pnpm --filter @ats/api run import:knowledge-tests -- --course-id <uuid>
```

- It creates 19 definitions: Sessions 1–8 × forms A/B (8 items, 9 marks) and study forms A/B/C (24 items, 29 marks). Items are stored verbatim.
- It refuses a bank that breaks the design: slots, one key per MCQ, three of five per SATA, rubrics, and max marks computed from the items.
- It is idempotent. It refuses a changed definition unless `--force`, and never changes a definition that has attempts.
- On a production image, bind-mount `apps/api/src` and the JSON, and use `npx --no-install ts-node` (see `docs/EF_battery_v2/DEPLOYMENT_LITHIUM.md`).
- **Bank note:** the study forms have 18 MCQ + 4 SATA + 2 open items (4 + 3 marks). The build prompt said 20 MCQ + 2 SATA; the total of 29 is the same. The bank is used as is.

Turn the tests on in **Course → Settings → Knowledge tests → Setup → Turn on**. That places the 18 gates on the modules titled "Session 1…" to "Session 8…". Turning off removes the gates nobody passed and keeps the rest as not required.

## Counterbalancing

Assignments are created on the student's first status request (or `POST …/assign-me`) and stored: 18 rows per student.

- **Study:** one of the six orders of A, B, C for (baseline, post-study, delayed follow-up). It comes from an RNG seeded on (studentId, courseId), so it is deterministic and idempotent. The third form is stored for the delayed test, which is not built yet.
- **Sessions:** the order alternates A-before/B-after and B-before/A-after by enrolment order. It also alternates across sessions, so a student doesn't always meet the same form first: `(rank + sessionNo) % 2`.
- **Condition:** there is no experimental-condition field yet, so nothing is stratified (TODO in `assignment.ts`).

## Scoring

- **MCQ:** 1 for the keyed option, else 0. A blank counts as 0 and as omitted.
- **SATA** (three keyed of five): `max(0, (correct − incorrect) / 3)`. All five selected = 1/3. This is the only rule.
- **Open:** not auto-scored. One 0/1 mark per rubric dimension, given by raters.
- **Auto total** = MCQ + SATA, computed at submit. Students never receive scores or keys.
- **Written total** is counted once two rater rows agree on the total, or an adjudication row exists (the adjudicator's total wins).
- **Data-quality flags** (computed at export): `fastCompletion` (duration < ⅓ of the running median of earlier attempts on the same form, after at least three), `omitted:<n>`, and `autosaveOnly` (the final submit changed nothing since the last autosave).

Attempts are append-only: after submit the responses cannot change, and the page shows only "Submitted — thank you". Open answers are always stored (decision 2026-10-22: test answers are assessment data, not lesson text). The activity log never contains answer text: option ids, or a character count for open answers.

## Blinded written scoring

**Knowledge tests → Written scoring** shows one open answer at a time, in a random order for each rater, with only an opaque attempt id and slot. Student, condition, form and time point are not shown. The rater ticks one box per mark.

- Two raters per answer. The course owner and admins can rate, and so can staff named as raters for the course (EF Raters tab).
- A rater cannot score the same answer twice.
- When the two totals differ, the answer appears under **Waiting for adjudication**. A third person who owns the course (or an admin) gives the final score (`role: ADJUDICATOR`).
- An attempt becomes `SCORED` when every open answer is resolved.

## Exports (pseudonymised)

**Knowledge tests → Exports & agreement** offers three CSVs, using the same salted pseudonym as the other research exports (`RESEARCH_EXPORT_SALT`):

| File                             | One row per           | Columns                                                                                                                                                             |
| -------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --------------------------------------- |
| `knowledge_test_assignments.csv` | student × test        | pid, kind, session_no, form, order                                                                                                                                  |
| `knowledge_test_attempts.csv`    | submitted attempt     | pid, attempt_id, kind, session_no, form, order, started_at, submitted_at, duration_ms, omitted_count, auto_total, auto_max, written_total, max_marks, status, flags |
| `knowledge_test_responses.csv`   | attempt × item (long) | attempt_id, slot, type, response (option id, `A                                                                                                                     | C   | D`, or text), auto_score, written_score |

**Inter-rater** reports, per open item, the raw agreement and Cohen's κ for each rubric dimension. On the totals it reports κ, quadratic-weighted for the 4-mark item.

## Event log

| Action                         | Written by | Metadata                                                              |
| ------------------------------ | ---------- | --------------------------------------------------------------------- |
| `KNOWLEDGE_TEST_OPENED`        | browser    | kind, sessionNo, form, order, attemptId                               |
| `KNOWLEDGE_TEST_ITEM_VIEWED`   | browser    | slot, type, msFromOpen                                                |
| `KNOWLEDGE_TEST_ITEM_ANSWERED` | browser    | slot, type, changed, attemptNo, option(s) — or chars for open answers |
| `KNOWLEDGE_TEST_ITEM_SKIPPED`  | browser    | slot                                                                  |
| `KNOWLEDGE_TEST_SUBMITTED`     | server     | attemptId, kind, sessionNo, form, durationMs, omitted                 |
| `KNOWLEDGE_TEST_GATE_BLOCKED`  | server     | kind, sessionNo, reason                                               |

- The batch endpoint refuses the two server-written actions from browsers.
- These are measurement, not learning process: no M-rule takes them as input, so they don't change learning events or the coverage report.
- They appear in the raw event-log export under their own activity names.
