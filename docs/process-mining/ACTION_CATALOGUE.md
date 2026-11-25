# Action catalogue

_Generated from `packages/shared/src/action-catalogue.ts` by `pnpm --filter @ats/shared run gen:catalogue`. Do not edit by hand._

133 platform actions (125 with an emitter, 8 deprecated), plus 50 library v2 terms that are realised by other actions or not emitted.

Level: **ACT** learner action · **SYS** system · **QUALITY** capture health · **REF** reference outcome. Side: who writes it. Text fields hold free text (recorded; consent is on the study consent form). Required and optional metadata keys with their JSON type; other keys are allowed.

## A Interactive lesson

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `ATTEMPT_STARTED` | ACT | client | instant |  | `fieldKey`: string, `libraryVersion`: string, `msFromSlideEnter`: number, `seq`: number, `slideKey`: string, `slideType`: string |  |
| `BELIEF_COMMITTED` | ACT | client | instant | `text` |  | `chars`: number, `choice`: string, `item`: number, `libraryVersion`: string, `msOnSlide`: number, `seq`: number, `slideKey`: string, `slideType`: string, `text`: string |
| `BELIEF_REVISED` | ACT | client | instant |  |  | `changed`: string, `item`: number, `libraryVersion`: string, `seq`: number, `slideKey`: string, `slideType`: string |
| `CONFIDENCE_RATED` | ACT | client | instant |  |  | `item`: string, `libraryVersion`: string, `seq`: number, `slideKey`: string, `slideType`: string, `timing`: string, `value`: number |
| `CRITERION_SELF_SCORED` | ACT | client | instant |  | `criterion`: number, `libraryVersion`: string, `seq`: number, `slideKey`: string, `slideType`: string, `value`: number |  |
| `GAP_NOTED` | ACT | client | instant | `text` |  | `chars`: number, `item`: number, `libraryVersion`: string, `noGapStated`: boolean, `seq`: number, `slideKey`: string, `slideType`: string, `text`: string |
| `MCQ_ANSWERED` | ACT | client | instant |  |  |  |
| `PREDICTION_COMMITTED` | ACT | client | instant | `text` |  | `chars`: number, `kind`: string, `libraryVersion`: string, `msOnSlide`: number, `seq`: number, `slideKey`: string, `slideType`: string, `text`: string |
| `RATIONALE_SUBMITTED` | ACT | client | instant | `text` |  |  |
| `REFERENCE_REVEALED` | ACT | client | instant |  | `auto`: boolean, `libraryVersion`: string, `msSinceCommit`: number, `revealKind`: string, `seq`: number, `slideKey`: string, `slideType`: string | `item`: number |
| `REFLECTION_SUBMITTED` | ACT | client | instant | `parts`, `text` |  |  |
| `RESULTS_RECORDED` | ACT | client | instant | `text` |  | `chars`: number, `libraryVersion`: string, `msOnSlide`: number, `seq`: number, `slideKey`: string, `slideType`: string, `text`: string |
| `SELF_CHECK_SUBMITTED` | ACT | client | instant | `text` |  | `chars`: number, `item`: number, `libraryVersion`: string, `msOnSlide`: number, `seq`: number, `slideKey`: string, `slideType`: string, `text`: string |
| `SLIDE_ENTERED` | ACT | client | interval |  | `libraryVersion`: string, `seq`: number, `slideKey`: string, `slideType`: string, `visitNo`: number |  |
| `SLIDE_EXITED` | ACT | client | interval |  | `dwellMs`: number, `elapsedMs`: number, `exitReason`: string, `libraryVersion`: string, `maxVisiblePct`: number, `seq`: number, `slideKey`: string, `slideType`: string |  |
| `TRANSFER_TASK_SUBMITTED` | REF | client | instant | `text` |  |  |

## A Interactive lesson (any [data-field-key] field)

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `OUTPUT_PASTED` | ACT | client | instant |  |  |  |

## A Interactive lesson (nudge accept); B Mode A / C Mode B strategies

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `INTERVENTION_COMPLETED` | ACT | client | interval |  | `completed`: boolean, `interventionType`: string, `totalDurationMs`: number | `averageAttemptsPerStep`: number, `cardsViewed`: number, `chatTurnCount`: number, `conceptsCovered`: number, `correctCount`: number, `depthRating`: string, `maxRepeatViews`: number, `percentCorrect`: number, `questionsAsked`: number, `score`: number, `stepsPassed`: number, `suggestionsUsed`: number, `totalAttempts`: number, `totalCards`: number, `totalQuestions`: number, `totalSteps`: number |

## A Interactive lesson (nudge)

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `INTERVENTION_DISMISSED` | ACT | client | instant |  |  |  |

## A Interactive lesson (nudge); B Mode A / C Mode B strategies

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `INTERVENTION_VIEWED` | ACT | client | interval |  | `contentTitle`: string, `hasSelection`: boolean, `interventionType`: string | `cardCount`: number, `coverageMode`: string, `keyConceptCount`: number, `mcqCount`: number, `questionCount`: number, `resumed`: boolean, `shortAnswerCount`: number, `suggestedQuestionCount`: number, `totalSteps`: number |

## A Interactive lesson (nudge); B Mode A / C Mode B strategy launch

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `INTERVENTION_TRIGGERED` | SYS | server | instant |  | `interventionType`: string, `triggerReason`: string | `config`: object, `summary`: string |

## A Interactive lesson; D every other surface (metadata.surface)

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `IDLE_ENDED` | ACT | client | interval |  |  | `idleMs`: number, `libraryVersion`: string, `slideKey`: string, `surface`: string |
| `IDLE_STARTED` | ACT | client | interval |  | `idleThresholdMs`: number | `libraryVersion`: string, `seq`: number, `slideKey`: string, `surface`: string |

## A Prompt Lab (exercise/task/stretch slides)

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `AI_OUTPUT_VIEWED` | ACT | client | interval |  |  | `dwellMs`: number, `libraryVersion`: string, `responseWords`: number, `runId`: string, `seq`: number, `slideKey`: string, `slideType`: string |
| `OUTPUT_COPIED` | ACT | client | instant |  |  |  |
| `OUTPUT_EDITED` | ACT | client | instant |  |  |  |
| `OUTPUT_RATED` | ACT | client | instant |  |  |  |
| `OUTPUT_REGENERATED` | ACT | client | instant |  |  |  |
| `OUTPUT_VERIFIED` | ACT | client | instant |  |  |  |
| `PROMPT_GOAL_DECLARED` | ACT | client | instant | `text` |  | `chars`: number, `libraryVersion`: string, `seq`: number, `slideKey`: string, `slideType`: string, `text`: string |
| `PROMPT_REVISION_TAGGED` | ACT | client | instant |  |  |  |
| `PROMPT_SUBMITTED` | ACT | client | instant |  |  | `declaredExperiment`: boolean, `libraryVersion`: string, `model`: string, `promptTokens`: number, `runId`: string, `sampleNo`: number, `seq`: number, `slideKey`: string, `slideType`: string, `testCaseKey`, `versionNo` |
| `PROMPT_VERSION_SAVED` | ACT | client | instant |  |  |  |
| `RUN_SETTINGS_RECORDED` | ACT | client | instant |  |  | `libraryVersion`: string, `model`: string, `seq`: number, `slideKey`: string, `slideType`: string, `temperature`, `toolsEnabled`: boolean |
| `TEST_CASE_RUN` | ACT | client | instant |  |  |  |
| `TEST_RESULT_RECORDED` | ACT | client | instant |  |  |  |
| `TOKEN_COUNT_CHECKED` | ACT | client | instant |  |  | `chars`: number, `learnerGuess`: number, `libraryVersion`: string, `seq`: number, `slideKey`: string, `slideType`: string, `tokens`: number |

## B assessments; A Checkpoint AI feedback

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `FEEDBACK_RECEIVED` | ACT | server | instant | `feedback` | `source`: string, `slideKey`: string, `status`: string, `latencyMs`: number | `verdict`: string, `model`: string, `feedback`: string, `answerChars`: number |

## B Learning Assistant

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `CHATBOT_MESSAGE_RECEIVED` | ACT | client | instant | `reply` |  | `contentTitle`: string, `reply`: string, `replyChars`: number, `suggestedStrategy` |

## B Learning Assistant (docked chatbot, also beside lessons)

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `CHATBOT_MESSAGE_SENT` | ACT | client | instant | `message` | `hasSelection`: boolean | `contentTitle`: string, `message`: string, `messageChars`: number, `pageType`: string, `selectionLength`: number |
| `STRATEGY_CHIP_CLICKED` | ACT | client | instant |  | `strategy`: string, `hasSelection`: boolean | `selectionLength`: number |

## B Learning Assistant strategies

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `PRACTICE_EXPLANATION_VIEWED` | ACT | client | instant |  | `questionIndex`: number | `correct`: boolean |
| `PRACTICE_NOTE_ADDED` | ACT | client | instant | `text` | `chars`: number | `text`: string, `questionIndex`: number |
| `PRACTICE_RESULTS_VIEWED` | ACT | client | instant |  | `score`: number | `totalQuestions`: number |
| `PRACTICE_RETRY_STARTED` | ACT | client | instant |  |  | `attemptNo`: number, `previousInterventionId`: string |
| `PRACTICE_SAVED_TO_REVIEWS` | ACT | client | instant |  |  | `reviewId`: string |
| `QUESTION_GRADED` | REF | server | instant |  | `interventionType`: string, `questionIndex`: number, `correct`: boolean, `graderType`: string | `questionType`: string, `answered`: boolean |
| `STEP_CHECK_FAIL` | REF | server | instant |  | `stepNumber`: number, `attempt`: number, `graderStatus`: string |  |
| `STEP_CHECK_PASS` | REF | server | instant |  | `stepNumber`: number, `attempt`: number, `graderStatus`: string |  |
| `STEP_FORCE_PASS` | SYS | server | instant |  | `stepNumber`: number, `attempt`: number |  |
| `STEP_HINT_VIEWED` | ACT | client | instant |  | `stepNumber`: number | `level`: number |

## B legacy assessments

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| ~~ASSESSMENT_GRADED~~ (deprecated) | REF | client | instant |  |  |  |

## B legacy assessments (quiz)

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `ASSESSMENT_STARTED` | REF | server | instant |  | `summary`: string |  |
| `ASSESSMENT_SUBMITTED` | REF | server | instant |  | `summary`: string |  |

## B Mode A / C Mode B practice testing

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `PRACTICE_TEST_CONFIGURED` | SYS | server | instant |  | `coverageFallback`, `coverageMode`: string, `interventionType`: string, `mcqCount`: number, `pageEnd`, `pageStart`, `shortAnswerCount`: number, `subtopic`, `usedDefaults`: boolean, `usedTeacherDefaults`: boolean |  |

## B Mode A / C Mode B strategies

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `QUESTION_ANSWERED` | ACT | client | instant | `answer` | `interventionType`: string | `action`: string, `answer`: string, `answerChanges`: number, `attempts`: number, `cardId`: string, `cardIndex`: number, `chatTurnCount`: number, `direction`: string, `editCount`: number, `flipped`: boolean, `hintShown`: boolean, `isCorrect`: boolean, `latencyMs`: number, `latencyMsToFirstKey`: number, `latencyMsToSubmit`: number, `peakChars`: number, `questionIndex`: number, `questionLength`: number, `questionType`: string, `seenCount`: number, `showAnswer`: boolean, `source`: string, `stepNumber`: number, `suggestionIndex`, `timeOnBackMs`: number, `timeOnFrontMs`: number, `totalCharsTyped`: number, `totalSteps`: number, `wordCount`: number, `wordsTyped`: number |

## B Mode A Coding Steps (DBox code decomposition)

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `CODE_DECOMP_MATCH_CHECKED` | ACT | server | instant |  | `implementedCount`: number, `matchCheckCount`: number, `nodeCount`: number |  |
| `CODE_DECOMP_NODE_HINT_VIEWED` | ACT | server | instant |  | `nodeId`: string, `stage`: string, `tier`: string |  |
| `CODE_DECOMP_NODE_REVEALED` | ACT | server | instant |  | `stage`: string | `mode`: string, `nodeId`: string |
| `CODE_DECOMP_STAGE_ADVANCED` | ACT | server | instant |  | `fromStage`: string, `nodeCount`: number, `toStage`: string |  |
| `CODE_DECOMP_TREE_CHECKED` | ACT | server | instant |  | `correctCount`: number, `formationCheckCount`: number, `nodeCount`: number |  |

## B Mode A course page

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `MODULE_OPENED` | ACT | client | instant |  | `courseTitle`: string, `mode`: string, `moduleCount`: number |  |

## B Mode A course page; D Cross-cutting (every route change)

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `MODULE_ITEM_VIEWED` | ACT | client | instant |  |  | `itemTitle`: string, `itemType`: string, `path`: string, `pdfFilename`: string, `search`: string, `summary`: string |

## B Mode A distributed practice; B review queue

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `SPACED_REP_CARD_VIEWED` | ACT | client | instant |  | `cardId`: string | `cardCount`: number, `cardIndex`: number, `interventionType`: string, `seenCount`: number, `summary`: string |

## B Mode A practice testing / stepwise; B legacy assessment

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `QUESTION_VIEWED` | ACT | client | interval |  |  | `interventionType`: string, `questionIndex`: number, `questionType`: string, `stepNumber`: number, `summary`: string, `totalSteps`: number |

## B review queue

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `SPACED_REP_CARD_RATED` | ACT | server | instant |  | `cardId`: string, `summary`: string | `nextReviewAt`: string, `quality`: string, `rating`: number |

## C Mode B "Studio" tab

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| ~~STUDIO_OUTPUT_VIEWED~~ (deprecated) | ACT | client | instant |  |  |  |

## C Mode B "Studio" tab (study tools)

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `STUDIO_OUTPUT_REQUESTED` | ACT | client | instant |  |  | `summary`: string, `type`: string |

## C Mode B dialogue

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `DIALOGUE_MESSAGE_RECEIVED` | ACT | server | instant | `messageText` | `messageText`: string, `role`: string, `summary`: string |  |
| `DIALOGUE_MESSAGE_SENT` | ACT | both | instant | `messageText` | `role`: string, `summary`: string | `messageText`: string |
| `DIALOGUE_SESSION_ENDED` | ACT | client | interval |  |  | `reason`: string |
| `DIALOGUE_SESSION_STARTED` | ACT | both | interval |  | `summary`: string |  |

## C Mode B Guide tab

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| ~~STUDY_GUIDE_GENERATED~~ (deprecated) | ACT | client | instant |  |  |  |

## C Mode B sources

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `STUDY_MATERIAL_UPLOADED` | ACT | client | instant |  | `documentId`: string, `fileName`: string, `summary`: string |  |

## C Review queue

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `CARD_VIEWED` | ACT | client | instant |  | `cardId`: string | `flipped`: boolean |
| `REVIEW_QUEUE_OPENED` | ACT | client | instant |  | `dueCards`: number |  |

## D Course pages (Mode A)

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `ITEM_EXITED` | ACT | client | interval |  | `dwellMs`: number, `activeMs`: number, `reason`: string |  |
| `PDF_PAGE_VIEWED` | ACT | client | interval |  | `page`: number, `activeMs`: number | `pageCount`: number |
| `TEXT_SELECTED` | ACT | client | instant | `text` | `chars`: number, `source`: string | `page`: number, `text`: string |

## D Cross-cutting

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `EMOTION_SELF_REPORT` | REF | client | instant |  | `emotion`: string |  |
| `PAGE_LEFT` | SYS | client | instant |  | `path`: string |  |
| `SESSION_END` | SYS | server | instant |  | `durationSecs`: number | `reason`: string |
| ~~SESSION_HEARTBEAT~~ (deprecated) | SYS | client | instant |  |  |  |
| `SESSION_START` | SYS | server | instant |  | `ipAddress`: string, `userAgent`: string |  |

## D Cross-cutting (announcements)

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `ANNOUNCEMENT_ACKNOWLEDGED` | ACT | client | instant |  | `announcementId`: string, `kind`: string |  |
| `ANNOUNCEMENT_VIEWED` | SYS | client | instant |  | `announcementId`: string, `kind`: string |  |

## D Cross-cutting (course gates, staff override)

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `GATE_UNLOCKED` | SYS | server | instant |  | `by`: string, `gateId`: string, `occasion`: string |  |

## D Cross-cutting (sensing)

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `PUPIL_SIZE_BATCH_SUBMITTED` | SYS | server | instant |  | `readingCount`: number |  |
| `PUPIL_SIZE_TRACKING_STARTED` | SYS | client | interval |  |  |  |
| `PUPIL_SIZE_TRACKING_STOPPED` | SYS | client | interval |  |  |  |
| ~~PYFEAT_JOB_COMPLETED~~ (deprecated) | SYS | client | instant |  |  |  |
| `PYFEAT_JOB_ENQUEUED` | SYS | server | instant |  | `jobId`: string, `sourceMinioKey`: string |  |
| ~~PYFEAT_JOB_FAILED~~ (deprecated) | QUALITY | client | instant |  |  |  |
| ~~RECORDING_RESUMED~~ (deprecated) | SYS | client | instant |  |  |  |
| `RECORDING_SEGMENT_UPLOADED` | SYS | server | interval |  | `durationMs`: number, `fileSizeBytes`: number, `segmentId`: string |  |
| `RECORDING_STARTED` | SYS | client | interval |  | `wallClockOffset`: number |  |
| `RECORDING_STOPPED` | SYS | client | interval |  |  |  |
| `RECORDING_UPLOAD_FAILED` | QUALITY | server | instant |  | `error`: string, `segmentId`: string |  |
| `WEBGAZER_BATCH_SUBMITTED` | SYS | server | instant |  | `readingCount`: number |  |
| `WEBGAZER_CALIBRATION_COMPLETED` | SYS | server | instant |  |  | `accuracy`: number, `triggeredBy`: string |
| `WEBGAZER_CALIBRATION_SKIPPED` | SYS | client | instant |  |  |  |
| `WEBGAZER_CALIBRATION_STARTED` | SYS | server | instant |  | `triggeredBy`: string |  |
| ~~WEBGAZER_RECALIBRATION_PROMPTED~~ (deprecated) | SYS | client | instant |  |  |  |
| `WEBGAZER_TRACKING_STARTED` | SYS | client | interval |  |  |  |
| `WEBGAZER_TRACKING_STOPPED` | SYS | client | interval |  |  |  |

## D Cross-cutting (webcam)

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `CAMERA_BLOCKED` | QUALITY | client | interval |  |  | `reason`: string |
| `CAMERA_RESTORED` | QUALITY | client | interval |  |  | `blockedMs`: number, `reason`: string |

## E EF puzzles (/student/courses/:id/puzzles/:occasion)

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `EF_OCCASION_COMPLETED` | REF | server | interval |  | `durationMs`: number, `occasion`: string |  |
| `EF_OCCASION_STARTED` | REF | server | interval |  | `occasion`: string |  |
| `EF_QUESTIONNAIRE_SUBMITTED` | REF | server | instant |  | `items`: number, `occasion`: string |  |
| `EF_TASK_COMPLETED` | REF | server | interval |  | `attempt`: number, `durationMs`: number, `occasion`: string, `task`: string |  |
| `EF_TASK_INTERRUPTED` | QUALITY | server | instant |  | `attempt`: number, `occasion`: string, `task`: string |  |
| `EF_TASK_STARTED` | REF | server | interval |  | `attempt`: number, `occasion`: string, `of`: number, `task`: string |  |

## E Learner prompts (WP5 G1, G2, G9)

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `AFFORDANCE_DISMISSED` | ACT | client | instant |  | `affordance`: string | `msShown`: number |
| `AFFORDANCE_SHOWN` | SYS | client | instant |  | `affordance`: string |  |
| `ANSWER_CONFIDENCE_RATED` | ACT | client | instant |  | `value`: number, `target`: string | `questionIndex`: number, `interventionId`: string |
| `GOAL_SET` | ACT | client | instant | `goal` | `goal`: string, `source`: string | `chars`: number |
| `INTENTION_TAGGED` | ACT | client | instant |  | `intention`: string, `target`: string |  |
| `PROGRESS_CHECKED` | ACT | client | instant |  | `status`: string | `activeMinutes`: number |
| `RESUME_ANSWERED` | ACT | client | instant |  | `choice`: string, `awayMs`: number |  |
| `SESSION_REFLECTION_SUBMITTED` | ACT | client | instant | `learned`, `unclear` | `learnedChars`: number, `unclearChars`: number | `learned`: string, `unclear`: string |

## F Knowledge tests (/knowledge-check)

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `KNOWLEDGE_TEST_GATE_BLOCKED` | SYS | server | instant |  | `kind`: string, `reason`: string, `sessionNo` |  |
| `KNOWLEDGE_TEST_ITEM_ANSWERED` | REF | client | instant |  | `attemptNo`: number, `changed`: boolean, `slot`: number, `type`: string | `chars`: number, `option`: string, `options`: array |
| `KNOWLEDGE_TEST_ITEM_SKIPPED` | REF | client | instant |  | `slot`: number |  |
| `KNOWLEDGE_TEST_ITEM_VIEWED` | REF | client | instant |  | `msFromOpen`: number, `slot`: number, `type`: string |  |
| `KNOWLEDGE_TEST_OPENED` | REF | client | interval |  | `attemptId`: string, `form`: string, `kind`: string, `order`: string | `sessionNo`: number |
| `KNOWLEDGE_TEST_SUBMITTED` | REF | server | interval |  | `attemptId`: string, `durationMs`: number, `form`: string, `kind`: string, `omitted`: number, `sessionNo` |  |

## G Course Notes tab / page highlights (study_notes)

| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |
| --- | --- | --- | --- | --- | --- | --- |
| `HIGHLIGHT_CREATED` | ACT | client | instant |  | `color`: string, `libraryVersion`: string, `noteId`: string, `quoteChars`: number, `slideKey`: string, `source`: string |  |
| `HIGHLIGHT_DELETED` | ACT | client | instant |  |  |  |
| `NOTE_CREATED` | ACT | client | instant |  | `anchored`: boolean, `chars`: number, `color`, `libraryVersion`: string, `noteId`: string, `quoteChars`: number, `slideKey`: string, `source`: string |  |
| `NOTE_DELETED` | ACT | client | instant |  |  |  |
| `NOTE_EDITED` | ACT | client | instant |  |  |  |
| `NOTES_VIEWED` | ACT | client | instant |  | `libraryVersion`: string, `noteCount`: number |  |

## Library v2 terms not emitted under their own name

| Library term | Status | Realised as / note |
| --- | --- | --- |
| `TASK_OPENED` | renamed | MODULE_ITEM_VIEWED / MODULE_OPENED (no rule reads them) |
| `INSTRUCTIONS_VIEWED` | renamed | SLIDE_EXITED slideType=objectives, dwell >= T_orient (M01, rules.ts:162) |
| `REQUIREMENTS_VIEWED` | renamed | SLIDE_EXITED slideType=objectives (M01, rules.ts:162) |
| `RUBRIC_VIEWED` | renamed | SLIDE_EXITED slideType=selfscore before (M01) or after (M14) first ATTEMPT_STARTED |
| `GOAL_ENTERED` | not emitted | only PROMPT_GOAL_DECLARED inside the Prompt Lab |
| `PLAN_CREATED` | not emitted | no emitter or substitute in code |
| `PLAN_EDITED` | not emitted | no emitter or substitute in code |
| `RESOURCE_SELECTED` | not emitted | no emitter or substitute in code |
| `CONTENT_OPENED` | renamed | SLIDE_ENTERED |
| `CONTENT_VIEWED` | renamed | SLIDE_EXITED dwellMs >= T_read on title/theory/figure/example/concept (rules.ts:65,195) |
| `CONTENT_REVISITED` | renamed | derived visitNo from SLIDE_ENTERED incl. prior sessions (rules.ts:121) |
| `SEARCH_SUBMITTED` | not emitted | notes search and PDF search not logged |
| `EXAMPLE_OPENED` | renamed | SLIDE_EXITED slideType=example inside M03 (rules.ts:65) |
| `EXPLANATION_REQUESTED` | not emitted | chatbot turns are not typed as explanation requests |
| `EXPLANATION_VIEWED` | not emitted | no emitter |
| `PROBLEM_OPENED` | renamed | SLIDE_ENTERED on mcq/check/exercise (no rule reads it) |
| `STEP_SUBMITTED` | not emitted | not mapped although stepwise QUESTION_ANSWERED carries stepNumber/isCorrect/attempts |
| `ANSWER_SUBMITTED` | renamed | MCQ_ANSWERED / SELF_CHECK_SUBMITTED / RESULTS_RECORDED (M06, M15, M24) |
| `CORRECT_RECORDED` | renamed | MCQ_ANSWERED.correct=true (M07, M23) |
| `INCORRECT_RECORDED` | renamed | MCQ_ANSWERED.correct!=true (M07) |
| `ERROR_TYPE_RECORDED` | renamed | MCQ_ANSWERED.misconceptionId (M07 detail) |
| `ANSWER_REVISED` | renamed | derived: re-save of a committed slide/item (revisions(), rules.ts:135) for M21 |
| `HINT_REQUESTED` | not emitted | not mapped although CODE_DECOMP_NODE_HINT_VIEWED exists |
| `HINT_OPENED` | not emitted | not mapped although CODE_DECOMP_NODE_HINT_VIEWED and stepwise QUESTION_ANSWERED.hintShown exist |
| `FEEDBACK_OPENED` | not emitted | Checkpoint AI feedback and practice-test results are shown but never logged |
| `ERROR_REVIEWED` | not emitted | no emitter or substitute in code |
| `SOLUTION_REQUESTED` | not emitted | not mapped although CODE_DECOMP_NODE_REVEALED and stepwise showAnswer exist |
| `TUTOR_MESSAGE_SENT` | renamed | CHATBOT_MESSAGE_SENT (M08) |
| `PEER_HELP_REQUESTED` | not emitted | no emitter or substitute in code |
| `HELP_DISMISSED` | not emitted | listed as M12 input (rules.ts:895); no emitter |
| `PROGRESS_VIEWED` | not emitted | course progress on the home page (bdf6ecd) is not logged |
| `SCORE_VIEWED` | not emitted | no emitter or substitute in code |
| `RUBRIC_COMPARED` | not emitted | no emitter or substitute in code |
| `ANSWER_COMPARED` | not emitted | no emitter or substitute in code |
| `RETRY_STARTED` | not emitted | no emitter or substitute in code |
| `RETURN_TO_CONTENT` | not emitted | derivable from backward SLIDE_ENTERED but no deriver |
| `RESOURCE_CHANGED` | not emitted | no emitter or substitute in code |
| `TASK_ABANDONED` | renamed | derived inside M20 (open off-task interval, rules.ts:551) |
| `TASK_RESUMED` | renamed | derived inside M20 interruption_resumed (rules.ts:561) |
| `FOCUS_LOST` | renamed | visibility_logs visibleState hidden\|blurred (M20, M25 rules.ts:504) |
| `FOCUS_RETURNED` | renamed | visibility_logs visibleState visible (M20, M25) |
| `SESSION_STARTED` | renamed | SESSION_START |
| `SESSION_ENDED` | renamed | SESSION_END |
| `AI_HELP_PROMPT_CLASSIFIED` | renamed | ai_prompt_classifications rows (M33, M08 label); not an activity_logs action |
| `RAPID_RESPONSE_FLAGGED` | renamed | derived inside M24 isLowEffort (rules.ts:110) |
| `NEXT_ITEM_OPENED` | not emitted | derivable from MODULE_ITEM_VIEWED / SLIDE_ENTERED but no deriver |
| `INTERVENTION_DISPLAYED` | renamed | INTERVENTION_TRIGGERED (shown flag, nudges only) / INTERVENTION_VIEWED; but code also feeds learner-launched strategies into M34 |
| `INTERVENTION_ACCEPTED` | renamed | INTERVENTION_COMPLETED (nudge accept, InteractiveLesson.tsx:163) (M34) |
| `DELAYED_TEST_SUBMITTED` | not emitted | KNOWLEDGE_TEST_SUBMITTED kind=POST_STUDY could serve |
| `WORK_ARTIFACT_SUBMITTED` | not emitted | no emitter or substitute in code |
