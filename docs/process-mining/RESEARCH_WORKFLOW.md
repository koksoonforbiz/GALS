# Prompting course — research workflow (Phases 4–5)

How to get from raw learner actions to validated learning events and
process-mining files. All endpoints below are **teacher/admin only** (PRIVATE
door) and scoped to courses the caller teaches. Base path: `/api/learning-events`.

## 0. Configuration

| Variable                                                 | Needed for      | Notes                                                                                                                                                          |
| -------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESEARCH_EXPORT_SALT`                                   | all API exports | ≥ 16 characters. Student ids in exports are `sha256(salt:studentId)[:16]`. Never put the salt in an export or commit it; without it the exports refuse to run. |
| `PROMPT_CLASSIFIER_HUMAN_LLM_KAPPA_MIN`                  | M33 validation  | default 0.6 (decision #6)                                                                                                                                      |
| `PROMPT_CLASSIFIER_HUMAN_HUMAN_KAPPA_MIN`                | M33 validation  | default 0.7                                                                                                                                                    |
| `PROMPT_LAB_RUNS_PER_HOUR` / `PROMPT_LAB_TOKENS_PER_DAY` | Prompt Lab      | defaults 60 / 200 000 per student per course                                                                                                                   |

## 1. Learning events (Phase 4)

Learning events are computed **on the server** from raw actions. This happens when a
session closes, on demand, or from the backfill command:

```bash
pnpm --filter @ats/api run learning-events:backfill -- --course-id <courseId> [--parameter-set <v>]
```

- `GET  /sessions/:sessionId`: a session's learning events
- `POST /sessions/:sessionId/recompute`, `POST /courses/:courseId/recompute`
- `GET  /courses/:courseId/coverage`: per rule, sessions where it _could_ fire vs _did_ fire. `no_input` rules can't fire on this course and come with a reason; `zero_coverage` rules could fire but haven't yet.
- `GET  /library`: rules and parameters as generated from the workbook

**Parameters.** Version 1 is the workbook's Parameters sheet. Each recalibration adds a version that
overrides some keys and is never edited, and every learning-event row records the
version that produced it.

```
POST /parameter-sets  { "values": { "T_idle": 300000 }, "note": "sensitivity 300 s" }
POST /courses/:id/recompute?parameterSetVersion=2
```

Re-generating the library after a workbook edit:
`python analysis/process_mining/export_library.py` (needs `openpyxl`).

## 2. Think-aloud validation (Phase 5.1)

1. **Codebook.** Call `POST /validation/codes/seed` once per researcher. It creates the Bannert and AI-interaction
   codes (`apps/api/src/learning-events/validation/codebook.ts`) as your Replay codes.
   Each code label maps to the rule(s) it validates.
2. **Recording.** Record think-aloud audio _outside_ GALS (decision #5). At the start of the
   recording, add a point annotation with the code **Think-aloud sync**.
3. **Coding.** In the Replay tab, code each think-aloud segment as an annotation range with the
   matching code.
4. **Report.** Request `GET /courses/:id/validation?segmentSeconds=30&toleranceSeconds=5`
   (JSON), or `validation.csv` in the workbook's Validation sheet column order
   (Mapping ID … Specificity, plus a pooled row). Both use your annotations; pass
   `researcherId` to report on another researcher's annotations.
5. **Inter-rater agreement.** Request `GET /courses/:id/inter-rater?coderA=<id>&coderB=<id>` for κ per code
   on the sessions both researchers coded (target κ ≥ 0.70).
6. **Rule status.** A rule that reaches the agreed match rate is marked validated:
   `PATCH /rule-status/<ruleId> { "status": "validated", "note": "…", "evidence": {…} }`.
   Every change is logged (`learning_event_rule_status_changes`) and can be reversed by
   setting `candidate` again. Existing rows are restamped.

> ⚠ **Known limitation (existing behaviour, raised as a separate task):**
> `session_sync_anchors` is overwritten on every page load, and annotations can't
> have negative offsets. As a result, activity before a session's _last_ reload can't be annotated.
> Until that is fixed, run think-aloud sessions without mid-session reloads.

## 3. Prompt help-type classifier (Phase 5.1 #4, rule M33)

1. `POST /courses/:id/classifier/run` labels Prompt Lab prompts and chatbot
   messages with codebook `help-type-v1` through the course teacher's LLM.
2. `GET /courses/:id/classifier/sample.csv` returns a stratified sample of up to 200 prompts for double
   human coding. LLM labels are withheld, and emails, phone numbers and ids are redacted.
3. Each coder submits their labels: `POST /courses/:id/classifier/labels { "labels": [{ "itemId": "<item_id from the CSV>", "label": "executive" }] }`.
4. `GET /courses/:id/classifier/agreement` reports human–human and human–LLM κ.
5. Only when both thresholds are met:
   `PATCH /rule-status/M33 { "status": "validated", "courseId": "<id>" }`. Until then the
   API refuses and gives the reason.

## 4. Exports (Phase 5.2)

- `GET /courses/:id/export/event-log.csv?activity=learning_event|raw&case=item|session`
- `GET /courses/:id/export/outcomes.csv`: per learner: MCQ accuracy, calibration
  bias and absolute accuracy, self-scores, transfer score share, Prompt Lab runs and versions
- The gals-studio cohort ZIP (`/api/analysis/export.zip`) also contains
  `process-mining-eventlog.csv` and `outcomes.csv`, built from bundles that carry the
  `derived/learning_events.jsonl` stream. These use the studio's user labels, not the salted ids.

```r
library(bupaR)
el <- read.csv("event-log.csv")
el$timestamp_start <- as.POSIXct(el$timestamp_start, format = "%Y-%m-%dT%H:%M:%OSZ", tz = "UTC")
el$timestamp_end   <- as.POSIXct(el$timestamp_end,   format = "%Y-%m-%dT%H:%M:%OSZ", tz = "UTC")
al <- activitylog(el, case_id = "case_id", activity_id = "activity",
                  resource_id = "resource", timestamps = c("timestamp_start", "timestamp_end"))
process_map(al)
```

Report at least two algorithms (e.g. a first-order Markov model and Heuristics Miner),
per Saint et al. 2021.

## 5. Transfer tasks (Phase 5.3)

There is one unassisted prompt-writing task per session. **The course team must write the
scenarios and rubrics:**

1. Copy `transfer_tasks.template.json` to `transfer_tasks.json` and fill in `scenario` and
   `criteria` for each session.
2. Re-import:
   `pnpm --filter @ats/api run import:prompting-course -- --teacher-email … --transfer-tasks docs/process-mining/transfer_tasks.json`.
   Each task is appended as the session's last slide, so existing slide keys don't move.
3. Learners submit without the Prompt Lab. The submission is logged as `TRANSFER_TASK_SUBMITTED` (rule M35), and a paste
   from an AI output still shows as `OUTPUT_PASTED`.
4. To score, read `GET /courses/:id/transfer`, then submit
   `POST /courses/:id/transfer/scores { studentId, moduleItemId, slideKey, scores: [0|1|2, …] }`.
   Scores feed `outcomes.csv`.
