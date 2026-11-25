# PLAN_B: Capture completeness (Prompt B)

Status: **draft for PI approval** (2026-11-25). No Prompt B code is written until this plan is approved.

Inputs: `CAPTURE_AUDIT.md` (gap register A9, plan A10, PI decisions), `action_catalogue.csv`, `STUDIO_ARCHITECTURE.md`, and Prompt B in `gals-pm-prompts/`.

Already done and live (B0, commits `faf2aef`, `efbbf61`, `8c3db5f`, deployed 2026-11-25): per-event batch validation, refused events kept in `ingest_issues` (with payload), 503 when the database is down, attempts export fixed, and consent taken from the study consent form (all text recorded).

---

## 1. Where the PI's decisions change the Prompt B rules

Prompt B's ground rules are followed except where the PI decided otherwise:

| Prompt B rule                                                    | PI decision                                                                           | What this plan does                                                                                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free text only with in-app text-capture consent                  | Consent is on the study consent form; record everything                               | All free text is recorded for everyone. `TEXT_CONSENT_IN_APP=true` restores the in-app gate. The "consent gating" acceptance test becomes a test that the switch works both ways. |
| Learner-visible affordances behind flags that are off by default | Build them and switch them on now                                                     | Each affordance has its own per-course flag, **on** for the study course and off for other courses.                                                                               |
| Don't change what M01 to M35 detect                              | Split M34 (decision 6); fix the rule issues most relevant to this study (decision 11) | Changes go into a new library version, **v2.1**. v2 stays runnable, so earlier results can be reproduced and compared. Every change is listed in §4 and `RULE_ISSUES.md`.         |
| Copy provenance behind a flag                                    | Switch it on                                                                          | Flag on for the study course. It stores the score and the matched turn id only, never the text.                                                                                   |
| Mode B scripted test                                             | Mode B is not in the study                                                            | CAP-20 and CAP-31 are deferred. The Mode B e2e test (B10.3) is dropped.                                                                                                           |
| Never deploy to lithium                                          | The PI deploys by saying "deploy"                                                     | Lithium is only touched after an explicit "deploy" (backup, tags, migrations, health checks), as for B0.                                                                          |

**Unchanged:** keystroke contents and clipboard contents are still never stored. Only counts, lengths and timings are kept (see question Q1).

---

## 2. Order of work

Each phase is a few small commits on `course-prompting-kt`, tested locally before the next phase starts. Phases 1 to 3 are prerequisites for the rest.

| Phase | Items                                                                                | Why this order                                               |
| ----- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| P1    | B2 envelope, B3 transport, B4 gaps and clock                                         | Everything else needs event ids, sequences and receive times |
| P2    | B5 sessions (30 min idle, close reasons, parse on every close, late events)          | Analysis units must be stable before rules are re-run        |
| P3    | B1 action catalogue and CI checks                                                    | New emitters in P5 are written against it                    |
| P4    | B7 learning-event provenance, library v2.1 (M34 split and rule fixes)                | Critical path for Prompt D (verdicts attach to stable keys)  |
| P5    | B6 emission gaps, intervention ledger, LLM-turn record, copy provenance, affordances | Uses the catalogue and envelope                              |
| P6    | B8 capture-health report                                                             | Reads everything above                                       |
| P7    | B9 bundle v2, plus the minimal GALS Studio importer change to accept it              | Carries all of the above to Studio                           |
| P8    | B10 scripted-learner tests and coverage result                                       | Proof of completeness                                        |

---

## 3. Work items

### P1. Envelope, transport, gaps (B2, B3, B4)

**Gaps closed:** CAP-03/43, CAP-41 to 47.

**Migration `…_activity_envelope` (additive).** New nullable columns on `activity_logs`:

- `client_event_id` (uuid)
- `client_ts`, `server_received_at`
- `client_seq` (int), `tab_id`
- `duration_ms`
- `source_channel`, `app_build`, `consent_scope`
- `quality_code`
- `slide_key`, `object_id`, `content_version`

Partial unique index on `(session_id, client_event_id)` where `client_event_id` is not null. Old rows stay null, and `quality_code` is `legacy` for rows read through the new API.

**Ingest (API).**

- Idempotent: duplicates by `(sessionId, clientEventId)` are skipped and counted.
- The server stamps `server_received_at` and `app_build`.
- Records `QUALITY.GAP` (expected and missing seq), out-of-order and duplicate counts per session × tab.
- Clock offset per session from `session_sync_anchors`, stored on `student_sessions` as `clock_offset_ms`.

`ingest_issues` already covers rejected events, so it serves as Prompt B's `rejected_activity_events` (no second table).

**Client (`ActivityLogContext.tsx`, `useInteractionLogger.ts`, replay recorder).**

- Each event gets a `clientEventId`, `clientSeq` (per session × tab) and `tabId`, and so does each interaction-log batch.
- **Persistent buffer** in IndexedDB, falling back to localStorage, so events survive reloads and offline periods. Overflow is capped and logged as a quality event.
- Exponential backoff, also for the cursor, click, scroll, visibility and clipboard streams (today they are never retried, CAP-47).
- Flush on `visibilitychange → hidden` and on `pagehide` with `fetch(keepalive)`.
- Replay snapshots no longer ride the keepalive limit (CAP-46). They go in their own request.

**Beacon auth.** `fetch(keepalive)` can carry the Bearer header, so security isn't weakened. The batch route stays on the public door, already in the allowlist.

**Throttle.** Check the limit on `/activity-log/batch`. Large batches are already chunked at 500.

**Events before the session id or after logout** (CAP-42) are kept in the persistent buffer and sent with the session they belong to, instead of being wiped.

**Tests:**

- Unit tests for dedupe, gap detection, out-of-order and the overflow quality event.
- An integration test that posts the same batch twice and gets one stored copy.

### P2. Sessions (B5)

**Gaps closed:** CAP-52, CAP-53, CAP-82 (parse state).

**Parameters.**

- `T2` = 30 min replaces the hard-coded 2 h in `session-timeout.sweeper.ts`.
- It is stored as a versioned session parameter, next to the existing learning-event parameter sets: `T_idle` 120 s as now in lessons, `T1` 5 min, `T2` 30 min.
- The sweeper closes with reason `idle_timeout`. The end time is the last event, not the sweep time.

**Close reasons.**

- `tab_closed`: the `pagehide` keepalive call to the close endpoint.
- `logout`, `explicit`, `idle_timeout`, `server_restart_recovery`.
- New nullable column `student_sessions.close_reason`.

**Parse on every close path.** `computeSession` runs for every close reason. A `session_parse_runs` table records each run: library version, parameter set, started/finished, detection count, error. That makes "never parsed" different from "parsed, zero detections" (CAP-82).

**Late events.** Events that arrive for a closed session are stored and trigger a debounced re-parse (5 min).

**Return after 30 min = new session (decision 7).** Coming back after 30 idle minutes opens a new session. Each session carries the keys needed to regroup in analysis:

- `episode_key`: same learner, same course, same module item, contiguous days.
- `previous_session_id`.
- Course, module item and first/last slide.

A second tab joins the current session as a segment (`tab_id`) and does not open its own.

**Admin script** `close-and-recompute-sessions.ts`: closes unclosed sessions by last event time and re-parses them. Run locally first. On lithium it runs only after you say "deploy", as a listed step.

**Tests:** integration tests for each close reason, the late-event re-parse, and the new session after 30 min with time mocked.

### P3. Action catalogue (B1)

- **Source of truth:** `packages/shared/src/action-catalogue.ts`. Each action has its name, family, level (ACT/SYS/QUALITY/REF), instant or interval, a Zod payload schema, text fields, emitting surfaces, and `deprecated`. It is seeded from `action_catalogue.csv` (175 rows).
- **Generated doc:** `scripts/gen-action-catalogue.ts` writes `docs/process-mining/ACTION_CATALOGUE.md`.
- **CI tests (jest):**
  - (a) every `track('…')`/`record({action})` in code is in the catalogue (AST scan);
  - (b) every catalogue action has an emitter or is deprecated;
  - (c) every action named in `library.v2.json`/`v2.1` is in the catalogue;
  - (d) payloads emitted in the P8 e2e tests pass their schema.
- The web bundle takes only types from `@ats/shared` (CommonJS), so payload schemas are checked on the API side and in tests, not imported as values into the web bundle.

### P4. Learning-event provenance and library v2.1 (B7, decisions 6, 8, 11)

**Gaps closed:** CAP-60 to 68, CAP-71, CAP-76, CAP-01 (with P5).

**Migration `…_learning_event_provenance` (additive).** On `learning_events`:

- `detection_key` (unique with the version scope)
- `library_hash`, `engine_version`, `parameter_set_id`
- `source_event_ids` (complete)
- `evidence_start`/`evidence_end` on the replay time base
- `computed_values` (json), `alternatives`, `evidence_class`, `not_applicable`

New table `parameter_set_snapshots`: the values themselves, hashed, so a set can't change under a stored result.

**Stable key.** `detection_key = sha256(sessionId, ruleId, parameterSetId, libraryHash, evidenceStartMs, sorted sourceEventIds)`.

**Recompute keeps earlier versions (decision 8).** Recompute only deletes rows for the same library hash and parameter set. Earlier versions stay.

**Source ids are deterministic.** De-duplication is ordered by `occurredAt` then `id` (CAP-72).

**computedValues for every rule.** Each rule returns its measured quantities and the thresholds it compared them with. The detection logic itself is unchanged in v2.

**Residual outputs** `NO_PATTERN`/`UNRESOLVED` and per-session coverage records (active time classified vs not) are additional outputs that don't change any other rule's output.

**Library v2.1** (new file `library.v2_1.json`; v2 kept):

1. **M34 split (decision 6).** M34 counts only `initiator = system` suggestions. A new rule, **M34L**, reports uptake of learner-launched strategies.
2. **Fixes relevant to this study** (predefined course with the chatbot), proposed:
   - M30 requires a prior view of the AI output.
   - M31/M32 consider all edits after a paste, not just the first.
   - M20/M25 precedence, so one visibility gap isn't labelled twice (CAP-71).
   - M05/M24 cover the low-effort "think" prediction that falls between them.
   - M14, M16, M28, M03b and M21 parameters are written into the library at their current values, so behaviour doesn't change.
   - M02/M13 use `W_plan`/`W_mon` as the library says.
3. **Recorded only, in `RULE_ISSUES.md`** (less relevant to this study or needing research input): M08 executive-request candidate, M21 revision tied to revisited content, M23 ±0.25, M33 help-type label.

**Tests:** one fixture per rule asserting the stored provenance and computed values, plus v2 vs v2.1 tests showing exactly which detections change.

### P5. Emission gaps (B6)

**Gaps closed:** CAP-01, 02/21, 04, 06/25, 07/22/24, 09/26, 23, 27, 28, 29.

- **Double emitters** (CAP-02/21): one writer per action. The browser copy is kept only where the server can't see the event.
- **Last slide exit** (CAP-04): `SLIDE_EXITED` on `pagehide` or close. A runtime check first confirms the cause.
- **Item-level fields** on every graded submission:
  - `problemId`, `stepId`, `attemptNo`, `outcome`, `errorType`, `helpLevel`, `kcIds[]`.
  - Practice answers get correctness (CAP-07).
  - A stepwise grader error is recorded as `STEP_GRADER_ERROR`, not an incorrect attempt, and no longer counts toward force-pass (CAP-24).
- **Stepwise:** `STEP_CHECK_PASS`/`STEP_CHECK_FAIL`, `STEP_FORCE_PASS`, `STEP_HINT_VIEWED` (level).
- **Elaboration:** question asked with `source ∈ {suggested, own}`.
- **Practice test:** configure, generate, answer, results viewed, note added, save to reviews, try again, done.
- **SM-2:** card viewed, card rated, review queue opened.
- **Mode A grounding:**
  - Selection sent to the chatbot (`selectionSource`, `selectionLen`, page) and strategy chip clicked.
  - PDF page changes and reading bounds (CAP-28).
  - Idle and active time outside lessons (CAP-29, same `T_idle`).
- **Checkpoint AI feedback events** (CAP-27).
- **LLM-turn record** (CAP-06/25), new table `llm_turns`: one row per chatbot request and response with:
  - channel, selection source and length, resolved context source;
  - `attemptBefore`, `timeSinceLastErrorS`, follow-up flag (within 120 s, same problem);
  - model id, latency, response role, guardrail flags.

  The prompt and reply text are kept (study consent form). Intent fields stay null until a classifier is accepted.

- **Intervention ledger** (CAP-01, CAP-23):
  - New table `intervention_ledger`: one row per learner-launched strategy and per system suggestion or nudge evaluation, including `NO_ACTION`.
  - `initiator ∈ {learner, system}` on every intervention row and activity event. The enum is not renamed.
  - The nudge engine stays off: its evaluations are logged, nothing new is shown.
- **Copy provenance (on):**
  - Every displayed AI output (chatbot, Prompt Lab, checkpoint feedback) is registered with channel and turn id.
  - The last 3 AI outputs are hashed in sessionStorage.
  - On paste: 5-gram Jaccard similarity, matched turn id, source channel, paste target field.
  - Copies from AI regions log `OUTPUT_COPIED`.
  - Score and ids only, computed in the browser.
- **Affordances (WP5 G1, G2, G9), on for the study course:**
  - interrupted/back button, intention tag, goal card, progress check, confidence slider, reflection prompt.
  - Each is shown, answered or dismissed as a logged action.
  - Each has its own flag in the new per-course `course_feature_flags` table (additive migration).
  - Teachers can switch each one off per course.
  - Student-facing wording is listed in §5 for the PI to read before release. No em dashes.

### P6. Capture-health report (B8)

- `GET /api/learning-events/sessions/:id/capture-health` and `…/courses/:id/capture-health`, plus a CSV variant.
- Private door, teacher/admin. Classified in `docs/two-door/api-classification.md` and kept out of `public-api-allowlist.conf`.
- **Contents:**
  - counts per action and the missing-required-field rate (catalogue schemas);
  - gaps, duplicates, out-of-order arrivals;
  - `ingest_issues` by reason;
  - close reason, parse runs, clock offset;
  - sensing-channel coverage (webcam, eye tracking, replay);
  - catalogue actions expected for the surfaces visited but never seen.
- A panel goes in the teacher student-logs view only if a learning-events panel is already there.

### P7. Bundle v2 (B9)

**Contents**, written by `tools/gals-export`, with `bundleVersion` 2:

- `activity_logs` with ids and the full envelope; `ingest_issues`; quality gaps; capture health;
- learning events with provenance and detection keys; coverage records; parse runs;
- the parameter snapshot and library snapshot (content + hash);
- the intervention ledger; `llm_turns`; copy-provenance scores;
- assessments, attempts and grading; practice, stepwise, elaboration and SM-2 data;
- `lesson_slide_states`, Prompt Lab runs/versions/tests/ratings, study notes;
- **knowledge tests and the EF battery** (CAP-86);
- consent source (study form), sync anchors and clock offset;
- a reproducibility stamp: bundle id, app build, library and parameter hashes.

**Docs:** `docs/process-mining/BUNDLE_SCHEMA.md`.

**Studio compatibility.** The current Studio importer only accepts `bundleVersion` 1 (STU-27). This phase includes a minimal Studio change: accept 1 and 2, ignore unknown files, and map missing fields to null. The full Studio model is Prompt C. An import test runs on both a v1 bundle and a new v2 bundle.

### P8. Scripted-learner tests and coverage (B10)

Playwright against the local stack, using the existing e2e helpers:

1. **Interactive lesson:** every slide type in one module, every gate, and the Prompt Lab end to end (run, regenerate, version, tag, test cases, rate, verify, copy, paste, edit). The affordances are shown and used.
2. **Mode A PDF lesson:** highlight to the chatbot, the four strategies from the chips, a full practice test, and the review queue.
3. **Resilience:** offline for 60 s mid-session; two tabs; tab closed without logout; idle past `T2` (time mocked).

Each test asserts:

- the expected actions appear with schema-valid payloads;
- there are no unexplained `clientSeq` gaps;
- the session closed with the right reason and was parsed;
- learning events carry provenance;
- the v2 bundle exports and validates.

The tests write `docs/process-mining/audit/CAPTURE_COVERAGE_RESULT.md`, the observed-vs-expected matrix.

---

## 4. Migrations (all additive)

1. `activity_envelope`: new columns and the partial unique index on `activity_logs`; `student_sessions.clock_offset_ms`, `close_reason`, `episode_key`, `previous_session_id`.
2. `session_parse_runs`.
3. `learning_event_provenance` and `parameter_set_snapshots`.
4. `llm_turns`, `intervention_ledger`.
5. `course_feature_flags`.
6. New `ActivityAction` enum values only (`ADD VALUE IF NOT EXISTS`), for example the `STEP_*` actions, the affordance actions and `OUTPUT_COPIED`.

No drops, no renames, no rewrites of old rows.

---

## 5. Learner-visible changes for the PI to read

These are on by default for the study course. Draft wording, plain and short, no em dashes:

| Affordance                     | Where                                              | Draft text                                                                                |
| ------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Goal card (G1)                 | Start of each session                              | "What do you want to get done in this session?" (pick one or write your own)              |
| Intention tag (G1)             | Before opening the chatbot or a strategy           | "What do you need right now? Explain / Check my answer / Give me a hint / Something else" |
| Progress check (G2)            | Every 10 min of active time, at most 3 per session | "Quick check: how is it going? On track / Stuck / Not sure"                               |
| Confidence slider (G2)         | After each graded answer                           | "How sure are you about this answer?" (0 to 100)                                          |
| Interrupted / back button (G9) | When returning after more than 5 min               | "Welcome back. Pick up where you left off?"                                               |
| Reflection prompt (G9)         | End of each session                                | "One thing you learned today, and one thing still unclear."                               |

---

## 6. Questions before I start

- **Q1. Keystroke and clipboard contents.** "Record everything" could also mean storing what students type key by key, and what they copy and paste. My recommendation is to keep the current rule: counts, lengths and timings only, not the contents. Answers they submit and chat they send are already kept in full. Storing raw keystrokes or clipboard contents is unusual in an ethics application and adds little for process mining.
- **Q2. Affordance timing.** Switching these on changes what students see in the middle of data collection. Should they start for all current students now, or only for students who start the course from now on? Either way, the switch-on time is logged so analysis can split before and after.
- **Q3. Rule fixes in v2.1.** Are the fixes in §3 P4 item 2 the right set? Anything you don't want changed stays recorded only, in `RULE_ISSUES.md`.
- **Q4. Affordance wording.** Is the wording in §5 OK, or will you send your own?

---

## 7. Acceptance (from Prompt B, adjusted for the PI's decisions)

- [ ] This plan is approved. Every Blocker and High CAP gap is closed or deferred with the PI's agreement. Deferred: CAP-20 and CAP-31 (Mode B not in the study).
- [ ] The catalogue CI checks pass.
- [ ] The scripted-learner tests pass, with no unexpected ❌ in the coverage matrix.
- [ ] Zero silent drops: every rejection, overflow and gap is visible in capture health.
- [ ] Every close path parses the session, including tab close and 30 min idle.
- [ ] Every learning event has source ids, evidence start/end, computed values, versions and a stable key. v2 and v2.1 are both reproducible.
- [ ] The bundle is v2, documented, and imports into Studio.
- [ ] Two-door classification is updated. A test covers both consent modes: study form (all text kept) and in-app (gated).
