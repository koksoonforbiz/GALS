# EF assessment on GALS — implementation plan (Phase 1, for review)

Branch `course-prompting-ef` (from `094758b`). Spec: `GALS_EF_Battery_Build_Prompt.md`. Source of truth: `docs/EF_battery_v2/source/stimuli.json`, battery 2.0:

| File                                              | SHA-256                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `stimuli.json`                                    | `a705e66707fb0f67f7d73241957dc12b73a0c61eca0b204584d251a97e2dd832` |
| `allocation.csv` (60 slots, 10 blocks × 6 orders) | `46e10718541fbe9b0b2c6d3e659b5a926b5feab95062ac0d7eec8fcbdddc1cfb` |
| `ef.py`                                           | `b8ee0113…` (matches `meta.code_sha256`)                           |

**Status: plan only. No code has been written. §11 lists the decisions I need from you before Phase 2.**

---

## 0. Discovery findings that shape the design

1. **No gating exists anywhere.** Sequencing is only `orderIndex`. The student course page auto-opens `modules[0].items[0]` (Session 1).
2. **Content choke points.** A server-side gate must cover all of these:

   | #   | Route / code                                                                                                                                   | Enrollment check today                                                                                                        |
   | --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
   | A   | `GET /courses/:id` → `CoursesService.findOne`                                                                                                  | **None.** Returns every module and item (incl. PAGE `contentMdx`, PDF keys, `learningOutcomes`) to **any** authenticated user |
   | B   | `GET /items/:id/download-url`                                                                                                                  | **None**                                                                                                                      |
   | C   | `GET /interactive-lessons/items/:itemId` and `PUT …/slides/:slideKey/state` via `InteractiveLessonService.loadAuthorized`                      | The only real gate (ACTIVE enrollment)                                                                                        |
   | D   | Prompt Lab `authorizeStudent` (`run`, `saveVersion`, `addTestCase`, `mine`). `setTags`, `recordTestResult` and `rate` only check row ownership | Yes (`authorizeStudent`)                                                                                                      |
   | E   | Learning-interventions `chat` / `resolveInterventionContext` / `tryResolveFromModuleItem` (lesson text by `contentId`)                         | **None**                                                                                                                      |
   | F   | `POST /nudges/evaluate`                                                                                                                        | None (item exists + own session only)                                                                                         |

   A, B and E are existing holes, independent of EF. See decision **Q5**.

3. **ActivityAction** lives in four hand-kept lists: the Prisma enum, `apps/api/src/activity-log/activity-action.enum.ts`, the web union type, and `tools/gals-export` schema. The batch endpoint is Zod-whitelisted, so an unknown action makes the whole batch 400 and it retries forever.
4. **Learning-event engine** loads **every** activity row of a session; there is no action registry.
   - Every rule matches named actions, but **M20** uses "last action of any type", and **M20/M25** use the session's `visibility_logs`.
   - So EF rows and EF-time tab switches _in the same session_ could change M20/M25 output (§8).
5. **Sensing.** Without changing those hooks:
   - WebGazer, pupil and webcam recording run only inside `BiometricsWrapper` (the `studentBiometric()` routes) and have no pause API.
   - Replay snapshots and interaction logging run app-wide (`LoggingProvider`). Their hooks already accept `enabled`, but nothing passes it.
6. **Two-door tooling.**
   - `pnpm check:two-door` checks nginx against the controllers.
   - `scripts/two-door/check-student-bundle.mjs` greps `dist-student` for forbidden strings. I'll extend it for blinding.
7. **Exports** (`ResearchExportsService`) build CSV in memory, pseudonymise with `RESEARCH_EXPORT_SALT` (≥16 chars, **probably not set on lithium**) and filter by research consent.
8. **"EF" is already used** by the text-mining module (`EfDetection`, `ef.detection.*`). The new models use the prefix `Ef…Assessment` / table prefix `efa_` to avoid collisions.

---

## 1. Data model (one additive migration `2026102x_add_ef_assessment`; no existing table altered except enum additions)

```
enum EfaOccasionCode   { T0 T1 T2 }
enum EfaOccasionStatus { not_started questionnaire_done in_progress completed abandoned }
enum EfaTaskStatus     { pending in_progress completed interrupted skipped }
enum CourseGateKind    { EF_QUESTIONNAIRE EF_TESTS KNOWLEDGE_TEST }   -- KNOWLEDGE_TEST reserved
enum CourseGatePosition{ BEFORE_MODULE AFTER_MODULE }

efa_stimulus_sets   (id, battery_version '2.0', sha256 UNIQUE, data JSONB, seeded_at)
efa_allocation_slots(slot PK, block, order_code, t0, t1, t2, claimed_at?, claimed_by_student?, claimed_course?)
efa_course_configs  (course_id PK FK, enabled_occasions JSONB {T0,T1,T2},
                     enabled_tasks TEXT[] default w1..w7, show_diagnosis_item bool false,
                     adexi_at_t2 bool false, t2_min_minutes_after_previous int 0, updated_by, updated_at)
efa_occasions       (id, student_id, course_id, occasion, status, form CHAR(1), order_code, slot,
                     battery_version, stimuli_sha256, consent_version, consented_at,
                     device JSONB, fullscreen_accepted bool, sensing_paused bool,
                     gap_since_previous_activity_ms bigint, focus_lost_ms_total bigint,
                     started_at, questionnaire_done_at, completed_at, abandoned_at, scoring_version)
                     UNIQUE(student_id, course_id, occasion)
efa_answers         (id, occasion_id, item_code 'A1'..'A13'|'B1'..'B14'|'C1'..'C9'|'COLOUR1..3',
                     value JSONB, answered_at)  UNIQUE(occasion_id, item_code)
efa_task_runs       (id, occasion_id, task_code w1..w7, attempt_no, status, skip_reason?, flags JSONB,
                     started_at, completed_at, reset_reason?, reset_by?)  UNIQUE(occasion_id, task_code, attempt_no)
efa_trials          (id, task_run_id, phase practice|test, part, trial_index, stimulus JSONB,
                     response JSONB, onset_ms, first_input_ms, submit_ms, shown_ms JSONB,
                     corrections int, focus_lost_ms int, interrupted bool, client_ts timestamptz,
                     correct bool?)   -- correct is set server-side only
efa_task_scores     (id, task_run_id, scoring_version, scores JSONB, flags JSONB, computed_at)
                     UNIQUE(task_run_id, scoring_version)
efa_codes           (id, trial_id, entry_index, rater_id, code, category?, created_at)  -- W4/W5 rater codes
efa_final_codes     (trial_id, entry_index, code, category?, adjudicated_by?, source rater_agree|adjudicated)
efa_rater_assignments (course_id, task_code, rater_id)
course_gates        (id, course_id, kind, occasion?, position, module_id, sequence, required bool, config JSONB)
student_gate_completions (id, gate_id, student_id, completed_at, source auto|override,
                     override_by?, reason?)  UNIQUE(gate_id, student_id)
```

**Enum additions:**

- `ActivityAction`: `EF_OCCASION_STARTED`, `EF_OCCASION_COMPLETED`, `EF_TASK_STARTED`, `EF_TASK_COMPLETED`, `EF_TASK_INTERRUPTED`, `EF_QUESTIONNAIRE_SUBMITTED`, `GATE_UNLOCKED`.
- `SecurityEventType`: `GATE_OVERRIDE` (staff unlock) and `EF_TASK_RESET`.

**Stimulus seeding.** `apps/api/prisma/scripts/seed-ef-battery.ts` (`pnpm run seed:ef-battery`) reads `stimuli.json`, `allocation.csv` and the item text.

- It is idempotent, keyed by version + SHA-256.
- If a set for `2.0` already exists with a different hash, it **refuses** unless `--force`.
- Allocation rows are upserted by `slot`, and `--extend` lets staff append rows.

**Item texts.** Part A/C, the ADEXI instructions, the scale and the attribution, plus `ef.py`-only constants:

- Hayling practice items + coding anchors
- the fluency example letter N
- TMT labels, field 150×185 mm, circle Ø 8.5 mm
- Stroop RGB values

These go into a checked-in **`docs/EF_battery_v2/derived/battery-extras.json`**, generated once by a small script from `ef.py` and `questionnaires.tex` and **hash-pinned**, so the seed never parses LaTeX at runtime. A unit test diffs it against the source files.

**Allocation claim** is done in one transaction:

```sql
SELECT … FROM efa_allocation_slots
WHERE claimed_at IS NULL
ORDER BY slot
LIMIT 1
FOR UPDATE SKIP LOCKED;
```

then set `claimed_*`. This is concurrency-safe and is covered by a parallel-claims test.

Forms:

- T0 = `order[0]`, T1 = `order[1]`.
- T2 = `order[2]` (the third letter), whether or not T1 is enabled.

---

## 2. Routes and doors

Student routes use **neutral paths** (`/api/puzzles/…`); staff routes are `/api/efa-admin/…`, which never appears in the student bundle.

| Method   | Path                                                                                              | Roles          | Door    | Purpose                                                                             |
| -------- | ------------------------------------------------------------------------------------------------- | -------------- | ------- | ----------------------------------------------------------------------------------- |
| GET      | `/api/puzzles/courses/:courseId/status`                                                           | student        | PUBLIC  | Checklist: gates, occasion state, next step (no construct names)                    |
| POST     | `/api/puzzles/courses/:courseId/occasions/:code/start`                                            | student        | PUBLIC  | Consent + device record; allocate form (T0); 409 if not due                         |
| GET/PUT  | `/api/puzzles/occasions/:id/answers`                                                              | student        | PUBLIC  | Questionnaire: items to show (text, options) + autosave per item                    |
| POST     | `/api/puzzles/occasions/:id/answers/submit`                                                       | student        | PUBLIC  | Validate required items; status → `questionnaire_done`                              |
| POST     | `/api/puzzles/occasions/:id/tasks/:task/begin`                                                    | student        | PUBLIC  | Start a run (or 409 if done / interrupted); returns instructions + practice stimuli |
| POST     | `/api/puzzles/runs/:runId/next`                                                                   | student        | PUBLIC  | Next block of stimuli (no keys); server applies discontinue rules                   |
| POST     | `/api/puzzles/runs/:runId/trials`                                                                 | student        | PUBLIC  | Batch of raw trial records; practice → feedback only                                |
| POST     | `/api/puzzles/runs/:runId/finish`                                                                 | student        | PUBLIC  | Close run, trigger scoring (scores not returned)                                    |
| POST     | `/api/puzzles/runs/:runId/focus`                                                                  | student        | PUBLIC  | Focus-loss intervals (beacon-friendly)                                              |
| GET/PUT  | `/api/efa-admin/courses/:courseId/config`                                                         | teacher, admin | PRIVATE | EF settings + gate positions                                                        |
| GET      | `/api/efa-admin/courses/:courseId/progress`                                                       | teacher, admin | PRIVATE | Dashboard                                                                           |
| POST     | `/api/efa-admin/gates/:gateId/students/:studentId/unlock`                                         | teacher, admin | PRIVATE | Override + audit                                                                    |
| POST     | `/api/efa-admin/runs/:runId/reset`                                                                | teacher, admin | PRIVATE | Reset one task with reason + audit                                                  |
| GET/POST | `/api/efa-admin/courses/:courseId/coding/…`                                                       | teacher, admin | PRIVATE | Rater queue, codes, disagreements, κ, adjudication                                  |
| POST     | `/api/efa-admin/courses/:courseId/rescore`                                                        | teacher, admin | PRIVATE | Recompute all scores from raw data                                                  |
| GET      | `/api/efa-admin/courses/:courseId/export/{trials,task-scores,questionnaire,occasions,coding}.csv` | teacher, admin | PRIVATE | Exports                                                                             |

- **Gate status in course detail.** `GET /courses/:id` gains a `locked` flag per module for students (see §5); it stays PUBLIC.
- **nginx.** Add `location ^~ /api/puzzles/ { include …/proxy-api.conf; }` to the public allowlist. `/api/efa-admin/` falls into the default deny (404) and gets an explicit deny line for clarity.
- **Classification.** `api-classification.md` gets two new controller sections and an updated derived allowlist block. `pnpm check:two-door` must pass.

---

## 3. Student UI flow (route `/student/courses/:courseId/puzzles[/:occasion]`)

The runner is wrapped with **`student()`**, not `studentBiometric()`. This means WebGazer, pupil tracking and webcam recording are **not mounted** at all during the puzzles. No pause API is needed, and on return to the course page they resume under the course's normal policy.

Replay snapshots and interaction logging are paused with a new tiny `SensingPauseContext`, which passes `enabled={!paused}` to the existing hooks. `sensing_paused=true` is recorded on the occasion. Visibility/focus logging continues.

**Course page changes:**

- A "**Before you start**" checklist card lists the gates in order with ✓ / ▶ Start.
- Locked modules show a lock icon, and their items are not clickable.
- The page no longer auto-opens `modules[0].items[0]` when that module is locked.

**Occasion flow:**

1. Intro + consent `ef-assessment-notice-v1` (full text, explicit "I agree").
2. Device check. Block (with an explanation screen) if any of these fail:
   - viewport ≥ 1024×700;
   - `matchMedia('(pointer:fine)')`;
   - not `(hover:none)`;
   - a "I am using a physical keyboard" confirmation.

   Then the full-screen prompt (accepted/declined recorded), the close-tabs / silence-notifications prompt, and recording of `{userAgent, screen, viewport, devicePixelRatio, pointer, fullscreen}`.

3. Questionnaire, "About you and how you feel today", with **autosave per item**:
   - C1–C7 every occasion.
   - At T0 only: A1–A12, plus A13 only if `show_diagnosis_item`.
   - B1–B14 ("How you usually are", small-print attribution) at T0, and at T2 if `adexi_at_t2`.

   Every item is required except "other" free text.

4. Colour check (three patches, randomised order, fixed labels). If wrong, W6 gets `skipped / colour_check_failed`.
5. W1 → W7 (only those enabled):
   - Each has an instruction screen, practice with feedback, then the scored part.
   - Optional untimed break screen between tasks.
   - "Puzzle n of N" progress.
   - Full-screen view without app chrome.
6. C8–C9, then a neutral thank-you screen. Scores are never shown.

**Interruptions:**

- If the browser loads a run that is `in_progress` (reload or close), the server marks it `interrupted` and the client continues at the next task.
- Focus loss and hidden time are logged per trial (`focus_lost_ms`) and summed on the occasion.
- Occasions idle > 24 h become `abandoned`. This is evaluated lazily on any read (status / dashboard), because there is no scheduler. → **Q12**

---

## 4. Timing approach

- All client timing uses `performance.now()`.
- **Stimulus onset** = the timestamp from the first `requestAnimationFrame` callback after the element is committed, i.e. a double-rAF after the DOM write. **Offset** = the same, after removal. `shown_ms` stores the measured on-screen duration per element.
- **W1/W2 sequences** are scheduled with a rAF loop against target times: 800 ms on, 200 ms blank. Drift is not accumulated, because each target is computed from the sequence start.
- Only the current item is in the DOM. Later trials are never pre-rendered, and the client receives the stimuli for the **current** trial or list only.
- **Time base.** Trial records carry monotonic `onset_ms`, `first_input_ms`, `submit_ms` (relative to the run start) plus a wall-clock anchor per run, so server-side ordering and gap calculations are possible.
- **Acceptance.** A headless-Chromium test records W1 `shown_ms` and asserts 800 ± 20 ms, reporting the distribution.

---

## 5. Gating design (generic)

**`CourseGateService.moduleAccess(studentId, courseId, moduleId)`** returns `{ open: boolean, blockingGate? }`:

- A module is **locked** if any `required` gate with `position=BEFORE_MODULE` on it, or on any module before it in `orderIndex`, lacks a `student_gate_completions` row.
- `AFTER_MODULE` gates lock **later** modules and the course end. T2 sits `AFTER_MODULE` on the last session.
- Gates with the same position are ordered by `sequence`.

**Default sequences:**

- 10 = T0 questionnaire, 20 = T0 tests (BEFORE Session 1)
- 30 = reserved: pre-study knowledge test
- 110/120 = optional T1 (BEFORE Session 5)
- 900 = reserved: post-study knowledge test
- 910/920 = T2 (AFTER the last session)

Each EF gate completes automatically when its occasion reaches `questionnaire_done` (questionnaire gate) or `completed` (tests gate). Staff override inserts `source=override` with a reason, records `GATE_OVERRIDE` in `security_events`, and logs `GATE_UNLOCKED` in `activity_logs`.

**Enforcement (server-side; students only — teachers and admins are unaffected):**

- **C**: `loadAuthorized` → after the enrollment check, `moduleAccess`. Locked returns **403 `MODULE_LOCKED`**.
- **D**: `authorizeStudent` (+ `setTags` / `recordTestResult` / `rate` via the run's item).
- **A**: `findOne` keeps titles and order for locked modules but **strips their items' content** (`contentMdx`, `pdfBlobKey`, `url`, `learningOutcomes`; item ids stay so the UI can render a locked list) and adds `locked: true`.
- **B**: `download-url` checks enrollment + module access.
- **E**: `tryResolveFromModuleItem` / `resolveInterventionContext` treat a locked item as no content.
- **F**: `nudges/evaluate` checks module access.

A, B and E also gain the **missing enrollment check**. → **Q5**

The web `apiFetch` maps 403 `MODULE_LOCKED` to a friendly "Complete the steps above first" state.

---

## 6. Task implementation summary

The specs follow the build prompt §4. Implementation notes:

| Task   | What the client receives                                                                                                         | Server-side scoring                                                                                                                                                                                                             |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W1** | Sequence for one trial at a time                                                                                                 | Correctness (fwd = same order; bwd = reversed). Discontinue after both trials of a length fail (the server returns `partDone`). Fwd 0–16, bwd 0–14, longest span                                                                |
| **W2** | One trial at a time                                                                                                              | `lnsAnswer()` port. Input normalised (case-insensitive; separators and spaces stripped). Total 0–12, longest length passed (W1 analogue → **Q9**)                                                                               |
| **W3** | One whole list at the list start (30 numbers + the op schedule, needed for "next item immediately"). Practice from `pm.practice` | Per-item correctness, list time = first onset → last Enter, errors, switch cost, >3-error flag                                                                                                                                  |
| **W4** | Prompt only                                                                                                                      | Raw entries with timestamps. Pre-scoring with an **in-house** lower-case/dedupe/simple-stemmer/initial-letter/proper-noun heuristic (no npm dependency; small bundled name list). Final scores come from the coding UI          |
| **W5** | One sentence at a time; **expected word never sent**                                                                             | RT to first key and to submit, sentence length; 15 s "Any word" prompt flag. Part A mean RT; Part B mean RT + error score from final codes (pre-fill A on exact match, needs confirmation)                                      |
| **W6** | The page grid. On-screen colour = the key, so correctness is visible by design                                                   | Keypress log: W/C/CW items completed, Golden IG, per-item RT, corrected errors. Wrong key flashes and requires the correct key, with the clock running; restart from top. Keys **F = red, J = green, K = blue** shown on screen |
| **W7** | Coordinates + labels                                                                                                             | Click log: time, errors, discontinue at 300 s (circles reached). Scale `px_per_mm` recorded; y-axis flipped                                                                                                                     |

**Answer keys never leave the server.** That covers W1/W2 expected sequences, W3 answers, W5 expected words and ADEXI keys.

For W3/W6/W7, the "answer" is derivable from the visible stimulus by design: n ± 3, the ink colour, the next label. This is inherent to the task, not a leak. The client therefore only does the _mechanics_ the spec requires (W6 wrong-key flash, W7 wrong-click flash) and the **server re-scores everything from the raw log**.

**Scoring library** `apps/api/src/efa/scoring/*.ts`: pure functions, `SCORING_VERSION = 'efa-1.0.0'`, with unit tests including:

- the Golden worked example: W100 / C80 / CW40 → −4.44; CW50 → +5.56;
- LNS and PM keys recomputed from `stimuli.json` vs. `scoring_key.tex` tables (parsed in the test);
- discontinue rules;
- ADEXI WM/INH and the 12-item variant (excluding items 1 and 14).

---

## 7. Staff side, coding, exports

- **EF settings page** (`/teacher/courses/:courseId/efa`, admin bundle only), linked from CourseBuilder Settings:
  - occasions and their positions (module pickers);
  - enabled tasks;
  - diagnosis-item flag;
  - T2 ADEXI;
  - `t2_min_minutes_after_previous`.
- **Progress dashboard:** per student, the occasions, status, form/order, task statuses and flags (colour check, interrupted, focus lost, discontinued, >3 errors), plus actions **Unlock gate** and **Reset task** (each needs a reason).
- **Coding UI** (W4 entries, W5 Part B responses):
  - Items are blind to identity and occasion, in random order.
  - Two raters per item, configurable via `efa_rater_assignments`.
  - Codes: W4 valid / repeat / rule break / intrusion (+ category for switching); W5 A / B / 0 with the expected word and the `HAYLING_CODING_EXAMPLES` anchors shown.
  - Disagreement queue → adjudication → `efa_final_codes`. Cohen's κ per task.
- **Administration log.** Auto-filled from the occasion: device, full-screen, `sensing_paused`, start/end, gap since previous course activity (last `activity_logs` row of that student and course before start; T2 checks `t2_min_minutes_after_previous`), focus-loss totals.
- **Exports** (pseudonymised with the existing `pseudonym()` + `RESEARCH_EXPORT_SALT`):
  - `ef_trials.csv`
  - `ef_task_scores.csv`
  - `ef_questionnaire.csv`
  - `ef_occasions.csv` (form, order, device, gaps, scoringVersion, stimuli hash)
  - `ef_coding.csv`

  No z-scores or composites. → **Q10** (consent filter)

- **Re-score endpoint.** Recomputes all `efa_task_scores` for a new `scoring_version` from raw trials and final codes; older versions are kept.

---

## 8. Logging integration and M-rule isolation

**EF\_\* and GATE_UNLOCKED are emitted by the server** (in the EF services) on state transitions. They are not sent from the browser, so the action names never enter the student bundle.

- Metadata: task code, occasion, status, durations only. No stimuli or answers, and **no `libraryVersion`**, so the text-consent stripping and the raw research export ignore them.
- They are written into the student's current activity session (`X-Session-Id`).

**Guaranteeing that no M-rule fires on them:**

1. `LearningEventsService.computeSession` and `NudgeService` drop `EF_*` / `GATE_UNLOCKED` rows before `prepareActions`.
2. **EF time windows** (`efa_occasions.started_at` → completed/abandoned) are **excluded from the off-task intervals** fed to M20/M25, because tab switches during puzzles aren't course behaviour. → **Q6**
3. **Test:** `runRules` output is identical with and without EF rows and EF-window visibility gaps interleaved into the Phase 7 scripted session.

---

## 9. Blinding and integrity checks

- **Student bundle grep.** Extend `check-student-bundle.mjs` FORBIDDEN with: `inhibition`, `working memory`, `executive`, `ADEXI`, `Stroop`, `Hayling`, `Golden`, `trail making`, `efa-admin`, `EF_`, `/api/efa`, `switch cost`, `fluency`. Note: "fluency" also appears in innocent words, so it is matched in a case-sensitive form with word boundaries.
- **Public-door responses.** An integration test calls every `/api/puzzles` route and asserts that no response body contains a forbidden term or any answer key.
- **Student-facing text.** "Attention and memory puzzles", "About you and how you feel today", "How you usually are", "Puzzle 3 of 7". Page titles and URLs are neutral.

---

## 10. Test plan (by phase)

- **Unit:**
  - scoring;
  - keys vs. `scoring_key.tex`;
  - discontinue;
  - ADEXI;
  - allocation concurrency (20 parallel claims → 20 distinct slots);
  - gate resolution (sequences, AFTER positions, override);
  - M-rule isolation;
  - stemmer / pre-scoring.
- **Integrity:** seed hash, `battery-extras.json` vs. sources, bundle grep, public-response grep.
- **Integration** (test DB, `x-gals-door: public` set to exercise DoorGuard):
  - full occasion via HTTP;
  - locked-module 403 on every choke point A–F;
  - staff routes 404/403 on the public door;
  - exports have the expected rows.
- **Playwright:**
  - T0 end-to-end with scripted responses (Session 1 locked until both gates pass);
  - reload mid-W3 → W3 interrupted, resumes at W4;
  - colour-check failure skips W6;
  - staff unlock audited;
  - W1 timing distribution.
- **Note:** the local Docker DB is needed for integration and e2e. The laptop dev stack must be started for those runs and **stopped afterwards**, because it shadows the lithium tunnel ports.

---

## 11. Open questions (I need decisions on these)

1. **Showing spoken stimuli on screen.** Paper constraint #1 says the participant never sees the W1/W2 sequences, W5 sentences or fluency letters. The build prompt deliberately shows them (visual digits, sentence text). I'll implement per the prompt and record it in `ONLINE_ADAPTATION.md`. Confirm?
2. **Questionnaire position.** The paper script gives Background (A) + ADEXI (B) **after** the puzzles at T0; the prompt puts the questionnaire **before** (gate sequence 1).
   - **Proposal:** C1–C7 before; A + B after C8–C9, still within the questionnaire gate.
   - Or keep the prompt's order exactly. Which?
3. **W5 cloze norming** (changelog: required before use, ≥80% dominant completion, n ≥ 30) hasn't been done. Run the pilot with W5 as-is and flag it in exports?
4. **ADEXI wording** is still marked "verify against the official chexi.se PDF". I'll use `ef.py`/`questionnaires.tex` verbatim. Please confirm the wording has been checked.
5. **Existing enrollment holes A, B, E** (any logged-in user can read any course's module content, PDF links and lesson text through the chat). Fixing them is a behaviour change to existing routes.
   - **Recommendation: fix them together with the gate checks.**
   - Teachers and admins keep today's behaviour.
6. **M20/M25 during puzzles.** Exclude EF time windows from off-task intervals (recommended), or leave M20/M25 untouched and only filter EF actions?
7. **Text consent.** W4/W5 typed responses are stored under the separate `ef-assessment-notice-v1`, regardless of the course text toggle, as the prompt says. If a student **declines** that notice, are they blocked from the course? Or do they skip W4/W5? Or skip the whole assessment, and the gate is completed with a flag?
8. **Practice feedback text, and on-screen instruction wording** adapted from the facilitator scripts (e.g. "type the numbers" instead of "say them back"). I'll draft them verbatim-where-possible in `ONLINE_ADAPTATION.md` for your review before Phase 5.
9. **W2 "longest length passed"** isn't defined in the scoring key. Use the W1 definition (longest length with ≥1 correct trial)?
10. **Exports and research consent.** Existing research exports include only students who gave `researchUse` consent. Should the EF exports follow the course research-use consent, or the EF notice (which is itself research consent)?
11. **Allocation exhaustion** after 60 starts: refuse to start (staff must extend), or wrap around to slot 1?
12. **Abandon after 24 h** is evaluated lazily, with no scheduler. OK, or do you want a periodic job (Nest `@Cron`, a new module, no new dependency because `@nestjs/schedule` may already be installed — to be checked)?
13. **Staff "reset task".** The reset re-runs the **same form's items**, so the student sees them twice. Allow it with a flag on the run, or use a reserve form (there isn't one)?
14. **Device check strictness.** Touch-only devices and small screens are blocked. Laptops with a trackpad are allowed (`pointer:fine`). There's also a physical-keyboard self-confirmation. OK?
15. **Server env on lithium.** `RESEARCH_EXPORT_SALT` must be set (≥16 random chars) for any export to work. I'll add it in the Phase 8 deployment notes.

---

## 12. Phase plan (each phase: tests → commit on `course-prompting-ef` → summary; no push)

| Phase | Deliverable                                                                                                                                                                                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2     | Migration, Prisma models, `battery-extras.json` + checker, seed script, allocation service + concurrency test                                                                                                                                                  |
| 3     | `CourseGateService`, enforcement at A–F, course-page checklist + locked modules, override endpoint + audit                                                                                                                                                     |
| 4     | `/api/puzzles` occasion/questionnaire/consent/device APIs; web intro, consent, device check, questionnaire, colour check                                                                                                                                       |
| 5     | Task runner shell (full screen, timing, focus, interruption) + W3, W1, W2, then W6, W7, W4, W5                                                                                                                                                                 |
| 6     | Scoring library, re-score, coding UI + κ, the five CSV exports                                                                                                                                                                                                 |
| 7     | Staff settings page, progress dashboard, reset/unlock, admin log                                                                                                                                                                                               |
| 8     | Full test pass, bundle and two-door checks, `ONLINE_ADAPTATION.md`, consent text, lithium deployment notes (laptop build → `docker save \| gzip \| ssh … docker load` → one-off `prisma migrate deploy` → one-off seed with `docs/EF_battery_v2` bind-mounted) |

**New npm dependencies:** none planned. If Phase 6 needs `@nestjs/schedule` for Q12, I'll ask first.

---

## 13. Decisions (2026-10-22)

| Q   | Decision                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | **Confirmed**: spoken stimuli are shown on screen; documented in `ONLINE_ADAPTATION.md`.                                                                                                                                                                                                                                                                |
| Q2  | **Questionnaire before the tests**, as in the build prompt: C1–C7 + A + B, then W1–W7, then C8–C9.                                                                                                                                                                                                                                                      |
| Q3  | **Yes**: run W5 without cloze norming; exports carry a `w5_unnormed` flag.                                                                                                                                                                                                                                                                              |
| Q4  | Default: ADEXI verbatim from the source; the wording check against chexi.se stays open on the researcher's side.                                                                                                                                                                                                                                        |
| Q5  | **Yes**: fix the enrollment holes at A, B and E together with the gate checks. Teachers and admins are unchanged.                                                                                                                                                                                                                                       |
| Q6  | Default: exclude EF time windows from M20/M25 off-task intervals, and filter EF actions.                                                                                                                                                                                                                                                                |
| Q7  | **The assessment must be finished.** Accepting `ef-assessment-notice-v1` is required to proceed; there is no skip path. A student who declines stays at the gate and Session 1 stays locked.                                                                                                                                                            |
| Q8  | Default: on-screen wording drafted in `ONLINE_ADAPTATION.md` for review before Phase 5.                                                                                                                                                                                                                                                                 |
| Q9  | Default: W2 longest length passed = longest length with ≥1 correct trial.                                                                                                                                                                                                                                                                               |
| Q10 | Default: EF exports are governed by the EF notice (its acceptance is the research consent for EF data), not by the course `researchUse` toggle.                                                                                                                                                                                                         |
| Q11 | Default: refuse a new T0 start when no allocation slot is free (the student sees a "not available yet, please contact your instructor" screen; staff extend the table).                                                                                                                                                                                 |
| Q12 | Default: abandonment evaluated lazily.                                                                                                                                                                                                                                                                                                                  |
| Q13 | **Yes**: staff reset is allowed with a reason. The new attempt re-uses the same form, and the run is flagged `items_reexposed`.                                                                                                                                                                                                                         |
| Q14 | Default: device check as proposed.                                                                                                                                                                                                                                                                                                                      |
| Q15 | Default: `RESEARCH_EXPORT_SALT` goes into the Phase 8 deployment notes.                                                                                                                                                                                                                                                                                 |
| Q16 | (2026-10-22) `CONSENT_NOTICE.md` and `ONLINE_ADAPTATION.md` approved as drafted, including the five open points as proposed: ADEXI "circle" wording kept verbatim; W4 keep-going nudge after 15 s without an entry, before the 30 s mark; W5 RT from sentence onset with sentence length recorded; W6 keys F/J/K; practice feedback wording as drafted. |

## 14. Phase notes

### Phase 5 browser check (2026-10-22)

A full T0 occasion runs in Chromium against the built student bundle (`e2e/puzzles.e2e.spec.ts`, local fixture `pnpm --filter @ats/api run seed:efa-e2e-local -- --reset`). What it found and what changed:

- **Rate limit.** The global 30 requests/min refused questionnaire autosaves (33 items) and puzzle steps. `/api/puzzles` now allows 600/min per route, and the autosave retries transient failures (429, 5xx, network) with backoff.
- **W1/W2 presentation time.** Items were on screen ~833 ms (two frames late). Show/hide is now committed synchronously in the frame callback; measured 800 ms.
- **Double submission.** A second Enter while an answer was being saved sent the step twice (refused by the server as out of step). The runner now accepts one result per step.
- **Mood pop-up.** The existing 15-minute "How are you feeling right now?" pop-up could open over a timed puzzle. It is now deferred while the puzzles page is open and shown when the student leaves it (the logout survey is unchanged).

### Phase 6: scoring, coding, exports

- **Scores** are written to `efa_task_scores` (`efa-1.0.0`) when a run completes or is interrupted, from raw trials plus final codes; scoring failures never block the student (logged; repaired by re-score). `POST /api/efa-admin/courses/:id/rescore` recomputes every finished run for the current version; rows of other versions are kept.
- **ADEXI** WM/INH (and the 12-item variant) are computed at export time into `ef_questionnaire.csv` (`kind=score`), so no new table is needed.
- **Coding** (`/teacher/courses/:courseId/efa/coding`, linked from Course → Settings): the unit is one W4 list or one W5 Part B sentence, coded per entry. Items carry no student/occasion/run id and come in a per-rater random order. Raters for a puzzle are the users in `efa_rater_assignments`; without assignments, the course owner and admins. An assigned rater who does not own the course can use the queue but not disagreements, adjudication, re-score or exports. Two agreeing codes become final (`rater_agree`); disagreements are adjudicated by the owner/admin (`adjudicated`), which re-scores the run. κ per task is computed over entries with two codes (code + category as one label). W4 shows the automatic pre-scoring as hints (no pre-fill); W5 pre-fills **A** when the response is the expected word, and saving confirms it.
- **Exports** `GET /api/efa-admin/courses/:id/export/{trials,task-scores,questionnaire,occasions,coding}.csv`: pseudonymised with the same salted hash as the other research exports (`RESEARCH_EXPORT_SALT`, ≥16 chars, required), raters too. Only occasions whose notice was accepted (Q10). Task scores are long format (one row per measure); `?version=` selects another scoring version.
- **Two-door:** `/api/efa-admin/` is denied on the public door (nginx) and classified PRIVATE; `efa-admin` is a forbidden string in the student bundle.

### Phase 7: staff settings, progress, reset, raters

Page `/teacher/courses/:courseId/efa` (Course → Settings → "EF assessment"), tabs Progress / Settings / Raters, plus the coding page.

- **Settings** (`GET/PUT /api/efa-admin/courses/:id/settings`): occasions with their session, enabled puzzles, diagnosis item, ADEXI at T2, T2 minimum gap. Saving creates or moves the two gates per enabled occasion (T0 before / T1 before / T2 after the chosen session; sequences 10/20, 110/120, 910/920). Defaults before the first save: T0 before the first session, T1 before Session 5, T2 after the last. Disabling an occasion deletes its gates, unless a student already passed one; then it is kept as not required so the completion stays on record.
- **Progress** (`GET …/progress`): per enrolled student, every gate (✓, or ✓ unlocked with the reason on hover), each occasion's status, form/order/slot, and per-puzzle status with flags (interrupted, discontinued, items re-exposed, colour check skipped). Expanding a student shows the **administration log** (start, questionnaire done, end, expiry, gap since course activity, full screen, sensing paused, focus lost, device, scoring version).
- **Actions, each with a required reason and audited:** Unlock gate (existing `POST /api/course-gates/:gateId/students/:studentId/unlock`, `GATE_OVERRIDE`); Reset puzzle (`POST /api/efa-admin/runs/:runId/reset`, latest attempt of an open occasion only; next attempt same form, `items_reexposed`; `EF_TASK_RESET`); Reopen an expired occasion (`POST /api/efa-admin/occasions/:id/reopen`; `EF_TASK_RESET` with `scope: occasion`, no new enum value).
- **Raters** (`GET/PUT …/raters`): teacher/admin accounts per W4/W5.
- Tests: `efa-staff.integration.spec.ts` (9); browser smoke `e2e/efa-staff.e2e.spec.ts`.
