# Prompting course — Phase 7 verification (2026-10-07)

Plan: `GALS_PromptingCourse_Integration_Plan_for_Claude_Code.md`, Phase 7.
Branch `course-prompting`. Local stack: API on 3100, web on 5174, dev Postgres,
fixture accounts from `seed-prompting-course-local.ts` (`--reset-state` before the run).

## How to re-run

| What                                    | Command                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| API checks (#2 data, #4–#10), test DB   | `pnpm --filter @ats/api exec dotenv -e .env.test -- jest --runInBand src/learning-events/phase7`         |
| Client checks (event mapping, CSV rows) | `pnpm exec playwright test e2e/interactive-lesson.unit.spec.ts`                                          |
| bupaR load (#8), needs R + bupaR        | export `event-log.csv?format=eventlog`, then `Rscript docs/process-mining/load_eventlog.R event-log.csv` |
| Browser click-through (#1, #3)          | `e2e/interactive-lesson.e2e.spec.ts` (needs `playwright install chromium`) or by hand as below           |

`phase7.integration.spec.ts` drives the real HTTP routes. It registers a teacher and a
student, logs a scripted Session 1 run through `/activity-log/batch`, closes the session,
then checks the parser output against a **hand-written expected list** of 17 learning
events. It is part of `pnpm test`.

## Results

| #   | Check                                                                                                                            | Result | How                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Session 1 as a student: every slide type works and gates as in the HTML                                                          | Pass   | Browser: all 26 slides render (title, objectives, theory, figure, think, predict, mcq, example, misconceptions, concept, check, exercise, task, stretch, selfscore, reflect). Too-short answers are refused with “at least a sentence first”, and options, reveal and “Show answer” stay locked until a valid save. The DB shows one commit per slide, with the reveal only after it. |
| 2   | Replay tab shows the new actions; CSV export has them as named rows                                                              | Pass\* | Timeline tab lists every new action by name. The Replay CSV has one row per action (`slide_entered` … `output_edited`). A unit test proves the cells fill with slide key and counts, without free text. \*See caveat 1.                                                                                                                                                               |
| 3   | Lab 1C (“Lab 1.7”) in the Prompt Lab: runs, 3+ versions with tags and token counts, test results, rating, verification           | Pass   | Browser on `s1-21`: plan, token check, run, v4 saved with tag `compression` (34 tokens; v1–v3 from the Phase 3 demo), Question 1 pass and Question 2 fail (ambiguity) on v4, output rated, claim verified (`supported`). All rows are in `prompt_lab_*` and the matching actions are logged.                                                                                          |
| 4   | Copy an AI output and paste it into an answer: `OUTPUT_COPIED`, `OUTPUT_PASTED (matchesAiOutput=true)`; no clipboard text stored | Pass   | Browser: copy on Lab 1C → paste into the `s1-18` and `s1-25` fields. Both actions carry `chars` only. No `activity_logs` row contains the output text or a clipboard key. The API test checks the same on the test DB.                                                                                                                                                                |
| 5   | Parser output matches a hand-written list for the scripted session                                                               | Pass   | `phase7.integration.spec.ts`: the 17 expected `(rule, outcome, slide)` rows match exactly, and M01/M25 intervals match to the millisecond.                                                                                                                                                                                                                                            |
| 6   | Change `T_rapid` and re-run: M24 rows change                                                                                     | Pass   | New parameter set `T_rapid` = 3 s: M24 disappears and the 5 s prediction becomes M05. Back to the base set, M24 returns.                                                                                                                                                                                                                                                              |
| 7   | Two ReplayAnnotations → validation report computes                                                                               | Pass   | “Orientation” and “First reading” ranges: M01 and M03 rows have TP ≥ 1, sensitivity 1, and numeric match rate and specificity.                                                                                                                                                                                                                                                        |
| 8   | Process-mining CSV loads with `bupaR::eventlog()`                                                                                | Pass\* | New `format=eventlog` (start/complete lifecycle rows). The API test applies the checks `eventlog()` makes (mapped columns present and non-empty, ISO timestamps, known lifecycles, one case and activity per instance, start ≤ complete). \*R is not installed here, so `load_eventlog.R` has not been run.                                                                           |
| 9   | Policies disabled → no nudge; enable one in a test course and trigger it                                                         | Pass   | API test, plus the browser in Phase 6. Enabling an unvalidated rule is refused without `requiresValidated: false`. M24 fired once, was capped on repeat, and its dismiss was logged.                                                                                                                                                                                                  |
| 10  | Revoke text consent → later events carry `chars` only                                                                            | Pass   | API test, plus the browser in Phase 6.                                                                                                                                                                                                                                                                                                                                                |

## Fixed during Phase 7

- **Event-log format for `bupaR::eventlog()`** (#8): the export was activity-log shaped
  (start/end per row). `format=eventlog` adds the lifecycle form; the default is unchanged.
- **Paste attribution** (#4): with identical outputs from several runs, a paste was
  credited to the oldest run, because the Prompt Lab remembered runs oldest-first after
  each load. It now remembers newest-first, and copying an output moves that run to the
  front. Unit test added.

## Caveats

1. **Replay window after a reload — fixed 2026-10-08.** The Replay tab and its CSV start
   at the session's sync anchor, which every page load used to overwrite, so after a
   mid-session reload the replay only covered time after the reload (14 s in this run).
   The earliest anchor is now kept (`LogsService.upsertSyncAnchor`, test
   `sync-anchor.integration.spec.ts`). Sessions recorded before the fix keep their last
   anchor. A real session with continuous screen recording should still be checked once
   before the pilot.
2. **Browser automation.** The click-through ran in the desktop app's browser pane, with a
   stand-in camera/screen stream to pass the capture gate. Typing into fields went through
   React's value setter; real keyboard typing was not exercised. Install Playwright Chromium
   to run `interactive-lesson.e2e.spec.ts` unattended.
3. **LLM.** Prompt Lab runs used the local model fallback, not Bedrock.
