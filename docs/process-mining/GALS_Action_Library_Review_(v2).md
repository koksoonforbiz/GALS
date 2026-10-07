# GALS Action Library Review: Mapping Learner Logs to Learning Events (v2)

Oct 6, 2026 · @Jasper

## Summary

The library's theory is sound, but it describes a generic ITS rather than the prompting course: the course emits 13 event types, few of which appear in the library, and none of the course's 28 AI exercises and labs leave any trace of prompting behaviour.

This v2 replaces the first version of the report, which audited a hypothetical library because the research step could not open the uploaded files. Everything below is now checked against the actual spreadsheet (45 action events, 20 mapping rows), the pipeline document and the course HTML (8 sessions, about 190 slides, its logEvent code). The companion workbook Process_Mining_Library_v2.xlsx implements every change.

- **What v1 gets right:** sequence-based rules (hint → retry → correct), cautious "candidate, not diagnosis" wording, intervention-uptake tracking and independent outcome validators. This already matches the strongest literature (FLoRA, Aleven, Winne).
- **Mismatch with the course:** most events marked GALS = 1 (hints, notes, tutor messages, solution requests) are not emitted by this course. The course's own events (predictions, misconception commits, "what I missed" notes, self-scores) have no names in the library, yet they are its best metacognitive evidence.
- **Invisible prompting:** 20 exercises and 8 labs run in an external AI tool and return only free text. Prompt versions, test results, verification and copy/paste are not captured, and the library has no AI-interaction events.
- **Mapping defects:** seven rules over-read single actions or put one action in two families; two actions are unmapped; seven events used in rules are never defined; no rule has a time window or dwell threshold.
- **What v2 adds:** 38 action events, a course crosswalk, 36 mapping rules (19 revised, 17 new), 12 calibratable parameters and a think-aloud validation template.

## 1. Evaluation of the action library and mapping

### 1.1 What the course actually logs

The course logs 13 event types to the browser's localStorage, with a manual JSON download. It records character counts but not the text, slide dwell, focus or idle time. So any rule that needs reading time, interruption or answer content cannot run on today's data.

| Course event                                                            | Closest v1 action                            | What it evidences                                                 | v2 action                              |
| ----------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------- |
| slide_viewed                                                            | CONTENT_OPENED                               | Information access; no dwell, so CONTENT_VIEWED can't be computed | CONTENT_OPENED + new SLIDE_EXITED      |
| think_submitted, predict_submitted                                      | none                                         | Forethought: a committed prediction                               | PREDICTION_COMMITTED                   |
| predict_revealed, check_revealed, expect_revealed, misconception_opened | SOLUTION_REQUESTED (wrongly)                 | Reference shown after the learner's own attempt                   | REFERENCE_REVEALED                     |
| check_missed_noted                                                      | none                                         | Self-identified gap after comparison                              | GAP_NOTED                              |
| misconception_committed → misconception_changed                         | none                                         | Belief commitment then revision                                   | BELIEF_COMMITTED, BELIEF_REVISED       |
| mcq_answered (option, correct)                                          | ANSWER_SUBMITTED, CORRECT/INCORRECT_RECORDED | Performance                                                       | unchanged; add confidence              |
| mcq_rationale                                                           | none                                         | Self-explanation                                                  | RATIONALE_SUBMITTED                    |
| check_answered                                                          | SELF_CHECK_SUBMITTED                         | Self-testing                                                      | unchanged                              |
| results_submitted                                                       | ANSWER_SUBMITTED                             | Lab output, as free text                                          | RESULTS_RECORDED → structured lab form |
| selfscore_set                                                           | RUBRIC_COMPARED                              | Evaluation against criteria                                       | CRITERION_SELF_SCORED                  |
| reflect_submitted                                                       | REFLECTION_SUBMITTED (marked GALS = 0)       | Appraisal + implementation intention                              | GALS = 1; also forward planning        |

The commit-before-reveal design is the course's strongest asset. Reveals unlock only after the learner writes at least 20 characters (8 for a misconception reason). Prediction, then reveal, then "what I missed" is a near-textbook trace of evaluation, which most ITS logs cannot produce.

### 1.2 Prompting behaviour is invisible

Of about 190 slides, 20 are exercises and 8 are labs. All are done in an external AI tool. Lab 1.7, for example, asks learners to save each compression pass with its token count, test each version on two questions, and record where and why it fails. None of those steps is logged; only the final free-text summary returns via results_submitted.

The pipeline document itself asks whether the learner "requested help, accepted it, compared alternatives, or verified it". The v1 library has no event that could answer that for AI use.

### 1.3 Mapping defects

| v1 rule                                                    | Problem                                                  | v2 fix                                                                                        |
| ---------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| TASK_OPENED → Orientation                                  | Opening a task is navigation                             | Orientation needs instructions/criteria viewed with dwell ≥ T_orient before the first attempt |
| RESOURCE_SELECTED → Planning                               | Selection without a goal is information access           | Planning only if a goal/plan came within W_plan before                                        |
| EXPLANATION_REQUESTED / VIEWED → Knowledge building        | Contradicts v1's own "produce, not view" rule            | Requested → help-seeking; viewed → information access                                         |
| RUBRIC_VIEWED in Evaluation and in the Monitoring sequence | One action, two families                                 | Timing: before attempt = orientation, after = evaluation                                      |
| PROGRESS_VIEWED / SCORE_VIEWED → Monitoring                | The course's progress counter is always visible          | Monitoring only if a changed action follows within W_mon                                      |
| TUTOR_MESSAGE_SENT → Help-seeking                          | Untyped; can't separate hint-seeking from answer-seeking | Requires a help-type label (instrumental, executive, conceptual, verification)                |
| RESOURCE_CHANGED → Strategy adaptation                     | Switching alone is navigation                            | Needs a following RETRY_STARTED                                                               |

Also fixed: HELP_DISMISSED and ERROR_REVIEWED were in no rule. NEXT_ITEM, INTERVENTION_DISPLAYED/ACCEPTED, TARGET_ACTION, DELAYED_TEST, TRANSFER_TASK and WORK_ARTIFACT_SUBMITTED were used in rules but never defined. TASK_ABANDONED relied on focus data the library didn't log.

One course-specific correction matters for interpretation: a reveal here is gated behind the learner's attempt, so INCORRECT → reveal → next slide is reference comparison (rule M15), not answer dependence (M10).

## 2. What the research covers (questions 1–4)

The field maps logs to learning events in two layers (raw actions, then action sequences in context) and finds that even validated mappings agree with think-aloud coding only about 55% of the time.

| Study                                                                                                                                                                                           | Learning events (Q1)                                                                   | How captured (Q2)                                                                     | Setup (Q3)                                    | Implications (Q4)                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [Bannert, Reimann & Sonnenberg 2014](https://eric.ed.gov/?id=EJ1037161)                                                                                                                         | Metacognitive (orientation, planning, monitoring, evaluation) and cognitive SRL events | Think-aloud coded with Bannert's scheme; Fuzzy Miner                                  | University students, one hypermedia session   | Successful learners did more metacognition, in a more coherent order                      |
| [Fan et al. 2022](https://link.springer.com/article/10.1007/s11409-022-09291-1)                                                                                                                 | Same categories, from traces                                                           | FLoRA action + process libraries vs think-aloud; match rate, sensitivity, specificity | 44 learners, 45-min lab task                  | Theory-only mapping matched 35–39%; think-aloud-informed revision \~55%                   |
| [FLoRA engine](https://arxiv.org/html/2412.09763v1)                                                                                                                                             | Real-time SRL detection and scaffolds                                                  | Instrumentation tools (planner, timer, annotation); OFF_TASK threshold                | Platform for students and professionals       | Reference architecture: instrument → parse → scaffold                                     |
| [Siadaty et al. 2016](https://www.researchgate.net/publication/284283521_Associations_between_technological_scaffolding_and_micro-level_processes_of_self-regulated_learning_A_workplace_study) | Micro-level SRL at work                                                                | Learn-B traces; transition graphs                                                     | Workplace learners                            | Scaffolds linked to micro-level SRL; a rare adult precedent                               |
| [Saint et al. 2021](https://www.researchgate.net/publication/350667539_Using_process_mining_to_analyse_self-regulated_learning_a_systematic_analysis_of_four_algorithms)                        | SRL processes in LMS logs                                                              | Four algorithms incl. Heuristics Miner, pMineR Markov                                 | Undergraduate flipped course                  | Algorithms give complementary pictures; report more than one                              |
| [Jovanović et al. 2017](https://www.researchgate.net/publication/313865198_Learning_analytics_to_unveil_learning_strategies_in_a_flipped_classroom)                                             | Learning strategies and tactics                                                        | Sequence analysis + clustering                                                        | Flipped engineering course                    | Strategies associated with performance                                                    |
| [Taub & Azevedo 2019](https://link.springer.com/article/10.1007/s40593-018-0165-4) (MetaTutor)                                                                                                  | Judgements of learning, feeling of knowing, content evaluation                         | SRL-palette clicks + eye tracking; sequence mining                                    | N = 194 college students (30 eye-tracked)     | Explicit SRL buttons make metacognition loggable                                          |
| [Kinnebrew et al. 2013](https://files.eric.ed.gov/fulltext/EJ1115377.pdf) (Betty's Brain)                                                                                                       | Productive vs unproductive SRL                                                         | Action abstraction + differential sequence mining                                     | Middle-school classrooms                      | Patterns, not counts, separate productive learners                                        |
| [Aleven et al. 2006](https://www.researchgate.net/publication/220049859_Toward_Meta-cognitive_Tutoring_A_Model_of_Help_Seeking_with_a_Cognitive_Tutor)                                          | Help-seeking, help abuse, help avoidance                                               | Production rules over tutor logs                                                      | Geometry Cognitive Tutor                      | Help-seeking errors are common and detectable                                             |
| [Baker et al. 2008](https://link.springer.com/article/10.1007/s11257-007-9045-6)                                                                                                                | Gaming the system, off-task                                                            | Detectors trained on field observations                                               | Cognitive Tutor classrooms                    | Gaming is the off-task behaviour that hurts learning                                      |
| [Kovanović et al. 2015](https://eric.ed.gov/?id=EJ1127004)                                                                                                                                      | Time-on-task                                                                           | Comparison of estimation strategies                                                   | Several LMS courses                           | The estimation choice changes conclusions                                                 |
| [Fan et al. 2025](https://research.monash.edu/en/publications/beware-of-metacognitive-laziness-effects-of-generative-artificial/)                                                               | SRL with ChatGPT vs human vs checklist                                                 | FLoRA traces + parser; pre/post tests                                                 | 117 students, randomised                      | ChatGPT raised essay scores but not knowledge gain or transfer ("metacognitive laziness") |
| [Chen et al. 2025](https://www.sciencedirect.com/science/article/pii/S0360131524002124)                                                                                                         | Help-seeking with ChatGPT vs human                                                     | Traces + eye tracking + chat coded instrumental / executive / avoidant                | 38 students                                   | AI help-seeking skipped evaluation and leaned executive                                   |
| [Jin et al. 2026](https://arxiv.org/pdf/2602.16251) (RelianceScope)                                                                                                                             | Reliance: help-seeking × response use (ICAP)                                           | Chat, edit and copy-paste logs; human + LLM coders                                    | 79 analysed students, 20-min programming task | Passive-passive was most common (44%); links to outcomes weak                             |
| [McNichols et al. 2026](https://arxiv.org/pdf/2503.07928) (StudyChat)                                                                                                                           | Dialogue acts incl. verification                                                       | 16,851 messages, GPT-4.1 labels vs humans                                             | 203 students, one semester                    | Conceptual questions predicted exam scores; verification rare                             |
| [Lai et al. 2025](https://files.eric.ed.gov/fulltext/EJ1465625.pdf)                                                                                                                             | SRL acts in Socratic chatbot dialogue                                                  | 3 coders; process maps + ordered networks                                             | 34 students, 3 weeks                          | High scorers reflected more; low scorers answer-hunted                                    |
| [Sun et al. 2024](https://www.nature.com/articles/s41599-024-03991-6)                                                                                                                           | Programming with ChatGPT, guided vs not                                                | Screen logs; lag sequential analysis                                                  | 30 students                                   | Guided learners debugged pasted code                                                      |
| [Choi et al. 2025](https://journals.sagepub.com/doi/10.1177/21582440251381680)                                                                                                                  | Prompt features, critical re-prompting                                                 | Prompt logs coded for context, persona, format, refinement                            | Undergraduate prompting contest               | Context and more prompts predicted performance                                            |
| [Lee et al. 2025](https://www.microsoft.com/en-us/research/blog/the-future-of-ai-in-knowledge-work-tools-for-thought-at-chi-2025/)                                                              | Critical thinking in AI-assisted knowledge work                                        | Survey, 936 examples                                                                  | 319 knowledge workers                         | Trust in AI → less critical thinking; effort shifts to verification                       |
| [Bastani et al. 2025](https://ui.adsabs.harvard.edu/abs/2025PNAS..12222633B/abstract)                                                                                                           | Learning with and without AI guardrails                                                | Field RCT                                                                             | \~1,000 high-school students                  | Unrestricted GPT hurt later grades; hint-only tutor largely avoided it                    |
| [Kosmyna et al. 2025](https://arxiv.org/abs/2506.08872) (preprint)                                                                                                                              | Neural engagement in AI-assisted writing                                               | EEG + essay NLP + recall                                                              | 54 participants                               | LLM users had lowest recall and ownership; small sample                                   |

Across the table: SRL studies target the plan–perform–appraise cycle; ITS studies target help-seeking quality and gaming; GenAI studies target reliance, help type and skipped evaluation. Most use short university lab tasks; working adults appear only in Siadaty and Lee.

### 2.1 Study-by-study detail

The studies build ground truth in six ways, and the choice decides how far a mapping can be trusted:

| Ground-truth type             | What counts as "true"                                         | Used by                                                            | Strength for GALS                                              |
| ----------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| Think-aloud coding            | Trained raters code what learners say while working           | Bannert 2014; Fan 2022, 2025                                       | Strongest for SRL processes; costly, so pilot-scale only       |
| Field observation             | Observers code behaviour live in the classroom                | Baker 2004, 2008                                                   | Strong for gaming and off-task; not feasible for remote adults |
| Normative model               | Behaviour is judged against a theory-built rule set           | Aleven 2006                                                        | Explicit and testable; only as good as the model               |
| Human coding of text or video | Raters code chat messages, prompts or screen recordings       | Chen 2025; RelianceScope; StudyChat; Lai 2025; Sun 2024; Choi 2025 | Best fit for prompts and AI replies; needs κ reported          |
| Outcome-defined groups        | High vs low performers on a test define "productive" patterns | Bannert 2014; Kinnebrew 2013; Jovanović 2017; Taub 2019            | Shows what predicts outcomes, not what the process is          |
| Self-report or none           | Survey answers, or no external check (method comparison)      | Lee 2025; Siadaty 2016; Saint 2021; Kovanović 2015                 | Weakest for process validity; useful for context               |

Each entry below gives the theory, the ground truth, what was captured and the findings. Exact figures are given only where I am confident of them; check the paper before citing a number.

#### Stream A: Trace-based measurement of self-regulated learning

**[Bannert, Reimann & Sonnenberg 2014](https://eric.ed.gov/?id=EJ1037161)**

- **Theory:** Zimmerman's cyclical SRL model and Winne & Hadwin's COPES, operationalised in Bannert's think-aloud coding scheme.
- **Ground truth:** Think-aloud protocols from university students learning in a hypermedia environment, coded by trained raters. Learners were split into more and less successful groups by learning outcome.
- **Actions captured:** Utterances rather than clicks, segmented and coded.
- **Learning events:** Metacognitive: orientation, goal specification, planning, monitoring, evaluation. Cognitive: reading, repeating, elaboration, organisation. Plus motivational utterances.
- **Findings:** Successful learners showed more metacognitive activity and, more importantly, a more structured process: preparation and monitoring wrapped around reading and elaboration. Less successful learners' process models were looser. This paper established that order matters, not just frequency, and introduced process mining (Fuzzy Miner) to SRL research.

**[Fan et al. 2022](https://link.springer.com/article/10.1007/s11409-022-09291-1)**

- **Theory:** COPES and Bannert's framework. The trace-parsing approach builds on Siadaty's trace-based protocol.
- **Ground truth:** Think-aloud, recorded at the same time as the traces. Raters coded utterances with a Bannert-based scheme. The authors tested three ways of aligning the two timelines.
- **Actions captured:** In FLoRA: page navigation (relevant vs irrelevant reading), highlighting, note-taking and editing notes, search, planner and timer use, essay writing, viewing the task and rubric.
- **Learning events:** Orientation, planning, monitoring, evaluation; first reading, re-reading; elaboration/organisation.
- **Findings:** With 44 learners on a 45-minute reading-writing task, theory-only rules matched think-aloud 35–39% of the time; revising rules using the think-aloud data lifted this to about 55%. Reading processes were easiest to detect from traces; metacognitive processes such as monitoring and evaluation were harder because they often leave no click. This is the main reason GALS needs explicit instrumentation tools.

**[FLoRA engine (Li, Fan et al. 2024)](https://arxiv.org/html/2412.09763v1)**

- **Theory:** COPES and Bannert, inherited from Fan 2022.
- **Ground truth:** None new; the parser rules are those validated against think-aloud in earlier FLoRA studies.
- **Actions captured:** An action library of 17 actions (e.g. relevant reading, writing the essay, editing an annotation). An OFF_TASK action fires when inactivity passes a configurable threshold.
- **Learning events:** A process library maps action patterns to the Bannert categories in real time.
- **Findings:** A systems paper. It shows the instrument → parse → scaffold loop running live, with tools (planner, timer, annotation, checklists, AI chat) that both help learners and generate traces. It is the closest existing architecture to GALS.

**[Siadaty, Gašević & Hatala 2016](https://www.researchgate.net/publication/284283521_Associations_between_technological_scaffolding_and_micro-level_processes_of_self-regulated_learning_A_workplace_study)**

- **Theory:** Zimmerman's forethought, performance and self-reflection phases, and Winne & Hadwin.
- **Ground truth:** No think-aloud. Mappings from platform actions to SRL processes were derived from theory and the design of each scaffold.
- **Actions captured:** In the Learn-B workplace environment: setting and editing learning goals, building plans, choosing resources, viewing organisational and colleague competence information, rating and reflecting.
- **Learning events:** Micro-level SRL processes such as task analysis (goal setting, planning), self-observation and self-evaluation.
- **Findings:** Certain scaffolds, notably information about colleagues and the organisation, were associated with more frequent micro-level SRL processes. It is one of very few studies with employed adults, and it shows workplace learners regulate with reference to their job.

**[Saint et al. 2021](https://www.researchgate.net/publication/350667539_Using_process_mining_to_analyse_self-regulated_learning_a_systematic_analysis_of_four_algorithms)** (and the Trace-SRL framework, 2020)

- **Theory:** Zimmerman, Winne & Hadwin and Bannert, combined into the Trace-SRL scheme.
- **Ground truth:** None external. The study compares process-mining algorithms on the same coded data.
- **Actions captured:** LMS actions in a flipped course: watching videos, reading content, formative and summative assessments, viewing the dashboard.
- **Learning events:** Theory-coded SRL processes from those actions, such as orientation, planning, enactment and evaluation.
- **Findings:** Four algorithms (including Heuristics Miner, Fuzzy Miner and pMineR's first-order Markov model) produced noticeably different models of the same data. The authors recommend reporting more than one.

**[Jovanović et al. 2017](https://www.researchgate.net/publication/313865198_Learning_analytics_to_unveil_learning_strategies_in_a_flipped_classroom)**

- **Theory:** SRL and the literature on learning tactics and strategies.
- **Ground truth:** Exam performance, used to test whether the discovered strategies matter. There is no process-level ground truth.
- **Actions captured:** Pre-class LMS activity in a first-year engineering flipped course: videos, readings, formative and summative questions, dashboard use.
- **Learning events:** Learning tactics (recurring action sequences) and strategies (how learners combine tactics), found by sequence analysis and clustering.
- **Findings:** Distinct strategy groups emerged, from intensive to highly selective, and they differed significantly in exam performance.

**For GALS:** Fan 2022 is the template for your validation sheet. Siadaty is the closest precedent for working adults. Saint argues for two algorithms, not one.

#### Stream B: Intelligent tutoring systems, help-seeking and disengagement

**[Taub & Azevedo 2019](https://link.springer.com/article/10.1007/s40593-018-0165-4) (MetaTutor)**

- **Theory:** Winne & Hadwin's information-processing model of SRL, and Azevedo's work on SRL with hypermedia.
- **Ground truth:** Learners declare SRL processes themselves by clicking an SRL palette, and pedagogical agents prompt some processes. Prior-knowledge pretests split learners into high and low groups. Eye tracking adds what they looked at.
- **Actions captured:** Palette clicks, setting subgoals, page navigation, note-taking and summarising, quizzes, plus eye fixations on text and diagram areas.
- **Learning events:** Metacognitive: judgements of learning, feeling of knowing, content evaluation, monitoring progress toward goals. Cognitive: summarising, note-taking, re-reading, coordinating information sources.
- **Findings:** With N = 194 college students (30 with eye tracking) learning about the circulatory system, prior knowledge shaped both fixation patterns and the sequences of metacognitive and cognitive processes. The method lesson matters more for GALS: explicit buttons for metacognition make it loggable, which is why your confidence rating and "what I missed" field are worth keeping.

**[Kinnebrew, Loretz & Biswas 2013](https://files.eric.ed.gov/fulltext/EJ1115377.pdf) (Betty's Brain)**

- **Theory:** SRL and learning-by-teaching. Students teach a virtual agent by building a causal map.
- **Ground truth:** Learning and map-quality outcomes define high and low performers. Patterns that differ between the groups are treated as productive or unproductive.
- **Actions captured:** Reading resources, adding and removing map links, querying the agent, asking it to explain, quizzing it, consulting a mentor agent.
- **Learning events:** Actions were abstracted with context, for example a map edit is "supported" if relevant reading came just before. Patterns were then read as information seeking, knowledge construction and monitoring (such as using quizzes to check the map).
- **Findings:** High performers showed more read-then-supported-edit and quiz-to-check patterns. Low performers showed more unsupported, trial-and-error editing. Productivity also shifted over the session, found by segmenting each learner's timeline. The key idea for GALS is context-labelling an action by what came just before it.

**[Aleven et al. 2006](https://www.researchgate.net/publication/220049859_Toward_Meta-cognitive_Tutoring_A_Model_of_Help_Seeking_with_a_Cognitive_Tutor)** and Roll et al. 2011

- **Theory:** Help-seeking theory (Nelson-Le Gall; Karabenick & Newman), turned into a normative model of when a learner should try, ask for a hint or look in the glossary.
- **Ground truth:** The model itself, written as production rules, judges each action. It was validated by checking that deviations relate to poorer learning.
- **Actions captured:** In the Geometry Cognitive Tutor: attempts, hint requests and hint levels, glossary use, time between actions, and the tutor's estimate of skill mastery.
- **Learning events:** Adaptive help-seeking, help abuse (asking too fast or clicking to the bottom-out hint), try-step abuse (quick guessing) and help avoidance (not asking when struggling).
- **Findings:** Deviations from the model were common and were negatively associated with learning. In the follow-up Help Tutor study (Roll et al. 2011), feedback on help-seeking improved help-seeking behaviour, and this carried into later units, but did not by itself raise domain learning.

**[Baker et al. 2004; 2008](https://link.springer.com/article/10.1007/s11257-007-9045-6)**

- **Theory:** Engagement and motivation; "gaming the system" means exploiting the tutor's help or feedback to advance without learning.
- **Ground truth:** Human observers coded each student's behaviour live in class (on-task, off-task conversation, off-task solitary, gaming). Those labels trained machine-learned detectors.
- **Actions captured:** Tutor logs: response times, hint use, errors, repeated attempts on the same step.
- **Learning events:** Gaming, off-task behaviour, and later affect (boredom, confusion, frustration).
- **Findings:** In the 2004 CHI study, gaming was the off-task behaviour significantly correlated with lower post-test scores (r = −0.38). The 2008 detector transferred reasonably across students and less well across lessons. For GALS, field observation isn't feasible for remote adults, so rapid-commit rules (M24) need checking against think-aloud or screen recordings instead.

**[Kovanović et al. 2015](https://eric.ed.gov/?id=EJ1127004)**

- **Theory:** Validity in learning analytics. Time-on-task is an assumption, not a measurement.
- **Ground truth:** None. The study compares many ways of estimating time-on-task on the same LMS data.
- **Actions captured:** Timestamped LMS events in online and blended courses.
- **Learning events:** Time-on-task and engagement as predictors of performance.
- **Findings:** The estimation choice (cut-offs for long gaps, how the last action is timed) changed regression results, including which variables were significant. For GALS, report T_idle and run a sensitivity analysis at two or three values.

**For GALS:** Aleven's categories should type your help events, Kinnebrew's context labelling should shape your process layer, and Kovanović is why T_idle sits on the Parameters sheet.

#### Stream C: Learning with generative AI

**[Fan et al. 2025](https://research.monash.edu/en/publications/beware-of-metacognitive-laziness-effects-of-generative-artificial/) (metacognitive laziness)**

- **Theory:** SRL (Bannert, Winne) and hybrid human–AI regulation: who does the regulating when an AI is available.
- **Ground truth:** The think-aloud-informed FLoRA parser from Fan 2022 identifies SRL processes. Learning is measured by essay scores, knowledge tests, a transfer task and a motivation survey.
- **Actions captured:** FLoRA actions (reading, annotating, writing, planner/timer) plus interaction with the support agent in each condition.
- **Learning events:** Orientation, planning, monitoring, evaluation, reading, elaboration; intrinsic motivation; knowledge gain and transfer.
- **Findings:** 117 university students were randomised to ChatGPT, a human expert, a writing-analytics checklist, or no support during a reading-writing-revising task. The ChatGPT group improved their essays most, but gained no more knowledge, transfer or motivation than the others. Their process traces showed reliance on the AI in place of their own evaluation and re-engagement with the text: "metacognitive laziness".

**[Chen et al. 2025](https://www.sciencedirect.com/science/article/pii/S0360131524002124)**

- **Theory:** Help-seeking process models (Nelson-Le Gall; Karabenick & Newman): notice the need, decide to ask, choose a helper, formulate the request, obtain help, evaluate and use it.
- **Ground truth:** Human coding of a multimodal record: traces, Tobii eye tracking and the chat text, aligned in time.
- **Actions captured:** Typing, sending, deleting and rewriting questions; reading replies (eye tracking); returning to the essay.
- **Learning events:** Help-seeking stages and request types: instrumental (help to learn), executive (help to finish), clarifying, and avoidant (typed but never sent).
- **Findings:** With 38 students revising essays, help-seeking with ChatGPT was non-linear and often skipped the evaluation stage, leaning toward executive requests. With a human expert it was more linear and more metacognitive. ChatGPT users tended to delete and rewrite a question rather than refine it.

**[Jin et al. 2026](https://arxiv.org/pdf/2602.16251) (RelianceScope)**

- **Theory:** ICAP (Chi & Wylie): passive, active, constructive and interactive engagement, applied to both how learners ask and how they use AI answers.
- **Ground truth:** Three human coders labelled each segment (80.7–83.6% agreement; 71.6% for response use). LLM coders were then compared with them.
- **Actions captured:** Chat messages to a restricted gpt-4o-mini tutor, code edits, and copy-paste between chat and editor, segmented by knowledge component.
- **Learning events:** Help-seeking mode × response-use mode (for example, passive asking then copying the answer unchanged).
- **Findings:** In a 20-minute programming task (79 of 91 undergraduates analysed), "passive asking, passive use" was the most common pattern (44% of segments). Passive asking followed by constructive use predicted the post-test positively; active asking then passive use, negatively. The authors stress these links are weak. The best LLM coder reached F1 ≈ 0.76–0.81 for the Passive label.

**[McNichols, Ikram & Lan 2026](https://arxiv.org/pdf/2503.07928) (StudyChat)**

- **Theory:** Dialogue-act taxonomies adapted to student–LLM conversations.
- **Ground truth:** Human coders on a sample (κ up to 0.91 for broad categories), then GPT-4.1 labelled the full set (human–LLM κ ≈ 0.58 for broad categories).
- **Actions captured:** All messages students sent to an unrestricted gpt-4o-mini over a semester.
- **Learning events:** Writing requests, editing requests, contextual questions, conceptual questions, verification, off-topic.
- **Findings:** 16,851 messages from 203 students across 7 assignments. Conceptual questions and editing requests predicted exam scores in one semester. Verification was rare (647 messages). An LLM can label prompts at scale, but agreement with humans was moderate, so GALS should check it on its own data.

**[Lai et al. 2025](https://files.eric.ed.gov/fulltext/EJ1465625.pdf) (Socratic chatbot)**

- **Theory:** SRL phases, applied to dialogue with a tutor that asks questions instead of giving answers.
- **Ground truth:** Three annotators coded 6,689 conversation lines (Krippendorff's α = 0.693).
- **Actions captured:** Learner turns in a GPT-4 Socratic tutor over a 3-week statistics pilot.
- **Learning events:** SRL process-actions in dialogue, such as defining the problem, seeking information, engaging with the tutor's question and reflecting or self-evaluating.
- **Findings:** Among 34 undergraduates, higher scorers showed more reflection and self-evaluation in process maps and ordered networks. Lower scorers spent more turns hunting for the answer.

**[Sun et al. 2024](https://www.nature.com/articles/s41599-024-03991-6)**

- **Theory:** Prompt-based (guided) learning versus unguided use, in programming education.
- **Ground truth:** Human coding of screen recordings.
- **Actions captured:** Writing code, prompting ChatGPT, copying its code, running and debugging.
- **Learning events:** Programming behaviour sequences and interaction quality.
- **Findings:** In 30 college students learning Python, learners given guided prompts tended to debug code after pasting it (copy → debug, Yule's Q = 0.74). Unguided learners interacted more superficially. Structure around AI use changed what learners did with its output.

**[Choi et al. 2025](https://journals.sagepub.com/doi/10.1177/21582440251381680)**

- **Theory:** Prompt-engineering elements (context, persona, output format) and creative problem solving.
- **Ground truth:** Coding of each prompt's elements, and expert scoring of the solutions.
- **Actions captured:** Prompt logs from an undergraduate ChatGPT problem-solving contest.
- **Learning events:** Prompt features and a "critical attitude": re-prompting in response to the output.
- **Findings:** Giving context and writing more prompts predicted better problem-solving performance. This is the closest study to your course's content, and supports logging prompt versions and revision tags.

**For GALS:** Chen's help types and RelianceScope's ICAP response-use codes give you ready-made labels for AI_HELP_PROMPT_CLASSIFIED and the copy/paste/edit rules (M31–M33).

#### Stream D: Outcomes and working adults

**[Lee et al. 2025](https://www.microsoft.com/en-us/research/blog/the-future-of-ai-in-knowledge-work-tools-for-thought-at-chi-2025/) (CHI)**

- **Theory:** Critical thinking framed through Bloom's taxonomy (knowledge, comprehension, application, analysis, synthesis, evaluation).
- **Ground truth:** Self-report only. Workers described real tasks where they used GenAI and rated their critical thinking and effort.
- **Actions captured:** None logged; 936 described episodes of AI use at work.
- **Learning events:** Perceived critical thinking, cognitive effort, confidence in AI and in oneself.
- **Findings:** Among 319 knowledge workers, more confidence in GenAI went with less critical thinking, while more self-confidence went with more. Critical effort shifted from producing work to verifying information, integrating AI output and "task stewardship". Time pressure was a barrier. This is the strongest signal on your actual population, though it has no behavioural data.

**[Bastani et al. 2025](https://ui.adsabs.harvard.edu/abs/2025PNAS..12222633B/abstract) (PNAS)**

- **Theory:** AI as a learning aid versus a crutch; guardrails that make the AI give hints rather than answers.
- **Ground truth:** A randomised field experiment with exam grades as the outcome.
- **Actions captured:** Practice-session performance and the students' messages to the AI.
- **Learning events:** Practice performance with AI and learning measured on an exam taken without AI.
- **Findings:** Nearly a thousand high-school maths students were assigned to an unrestricted GPT-4 tutor (GPT Base), a guarded hint-giving version (GPT Tutor) or no AI during practice. Both AI groups did much better during practice. On the later exam without AI, GPT Base students scored 17% lower than controls, while GPT Tutor's safeguards largely removed that harm. Many GPT Base students had simply asked for answers.

**[Kosmyna et al. 2025](https://arxiv.org/abs/2506.08872) (preprint)**

- **Theory:** Cognitive load and "cognitive debt": effort saved now at the cost of later ability.
- **Ground truth:** EEG brain connectivity, natural-language analysis of essays, and tests of recall and sense of ownership.
- **Actions captured:** Essay writing with an LLM, a search engine or no tool, over several sessions.
- **Learning events:** Neural engagement, memory for one's own essay, ownership.
- **Findings:** 54 participants aged 18–39 took part in three sessions; 18 completed a fourth, switched-condition session. The LLM group showed the weakest connectivity and the poorest ability to recall or quote their own essays. It is a small, non-peer-reviewed study, so treat it as a signal only.

**For GALS:** Bastani is the strongest causal evidence for designing your practice tutor to give hints rather than finished prompts. It is also why every module needs a transfer task done without AI.

## 3. Is the list exhaustive? (question 5)

No. The 45 actions cover the SRL and ITS core well, but they miss the course's own events, all timing data and every AI-interaction behaviour. v2 adds 38 events.

| Gap                           | Already in v1                                                    | Missing (added in v2)                                                                                                                                                 | Source                             |
| ----------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Course-native metacognition   | REFLECTION_SUBMITTED, SELF_CHECK_SUBMITTED                       | PREDICTION_COMMITTED, REFERENCE_REVEALED, GAP_NOTED, BELIEF_COMMITTED, BELIEF_REVISED, RATIONALE_SUBMITTED, CRITERION_SELF_SCORED, RESULTS_RECORDED                   | The course's logEvent calls        |
| Reading time and interruption | CONTENT_VIEWED ("measurable interval" undefined), TASK_ABANDONED | SLIDE_EXITED (dwell), FOCUS_LOST, FOCUS_RETURNED, IDLE_STARTED, SESSION_STARTED, SESSION_ENDED                                                                        | FLoRA; Kovanović 2015              |
| Re-reading vs first reading   | CONTENT_REVISITED (only inside one sequence)                     | Its own rule (M03b)                                                                                                                                                   | Bannert 2014                       |
| Help-seeking quality          | Help requests; answer-dependence sequence                        | Help avoidance (M11), help-type label, support declined (M12)                                                                                                         | Aleven 2006; Chen 2025             |
| Calibration                   | CONFIDENCE_RATED (GALS = 0)                                      | Calibration rule (M23) comparing confidence or self-score with results                                                                                                | Schraw 2009                        |
| Gaming / low effort           | none                                                             | RAPID_RESPONSE_FLAGGED (M24)                                                                                                                                          | Baker 2004, 2008                   |
| Prompting process             | none                                                             | RUN_SETTINGS_RECORDED, PROMPT_GOAL_DECLARED, PROMPT_SUBMITTED, PROMPT_VERSION_SAVED, PROMPT_REVISION_TAGGED, TOKEN_COUNT_CHECKED, TEST_CASE_RUN, TEST_RESULT_RECORDED | Choi 2025; course labs             |
| Using AI output               | none                                                             | AI_OUTPUT_VIEWED, OUTPUT_REGENERATED, OUTPUT_RATED, OUTPUT_VERIFIED, OUTPUT_COPIED, OUTPUT_PASTED, OUTPUT_EDITED, AI_HELP_PROMPT_CLASSIFIED                           | RelianceScope; StudyChat; Lee 2025 |
| Events used but undefined     | referenced in Mapping                                            | NEXT_ITEM_OPENED, INTERVENTION_DISPLAYED / ACCEPTED / DISMISSED, DELAYED_TEST_SUBMITTED, TRANSFER_TASK_SUBMITTED, WORK_ARTIFACT_SUBMITTED                             | v1 Mapping sheet                   |

The highest-priority gaps for a prompting course are the last two AI rows. The evidence on metacognitive laziness says reading, judging and verifying AI output is where learning is won or lost, and the course currently can't see any of it.

Some v1 items remain valid but unused by this course (hints, notes, tutor messages, peer help). They stay in the library for the wider GALS platform.

## 4. Incorporating it into GALS and the prompting course (question 6)

Start with logging fixes that need a few lines of code, then bring the labs on-platform, then validate before any intervention fires.

### Step 1 — Fix the course logger (days)

1. Send events to a server, not only localStorage. Add session_id, learner_id (pseudonymised) and slide_type to every event.
2. Log SLIDE_EXITED with dwell_ms from the existing IntersectionObserver. Add blur/focus and idle listeners.
3. Log answer text (with consent) alongside chars, plus ms_on_slide before each commit.
4. Add a 1–5 confidence rating to the 8 MCQ and 8 Predict slides, and tag each MCQ distractor with a misconception id.
5. Show each session's self-score criteria on its Objectives slide, so REQUIREMENTS_VIEWED becomes observable.

### Step 2 — Bring exercises and labs on-platform (weeks)

Replace the free-text results box with a structured lab form. Each exercise then leaves a plan → prompt → inspect → judge → revise → reflect trace:

1. **Plan:** model, version, sampling settings and tools on/off (the course already asks for these), plus a one-line goal, audience and format.
2. **Prompt:** numbered version boxes with token count and a revision tag (context, constraint, example, format, role, compression, reasoning).
3. **Judge:** a test-case table with pass/fail and a failure-reason dropdown (missing fact, ambiguity, instruction dropped, format).
4. **Verify:** a "check one claim against the course pack" field in at least one exercise per session.
5. **Reflect:** keep the existing reflection, split into its three prompts.

The stronger option is an embedded prompt sandbox calling the model directly. That makes AI_OUTPUT_VIEWED, OUTPUT_REGENERATED, OUTPUT_COPIED/PASTED and OUTPUT_EDITED real events instead of self-reports. Add one unassisted transfer prompt-writing task per module, graded on the same rubric.

### Step 3 — Validate before acting (pilot, \~8 weeks)

- Think-aloud with 10–15 working adults on two labs. Code with Bannert's scheme plus the AI-interaction codes. Fill the Validation sheet; expect \~50–60% overall match.
- Two coders on 20% of segments (target κ ≥ 0.70); then human–LLM κ for the help-type classifier.
- Calibrate every value on the Parameters sheet from pilot distributions and keep the one that best matches think-aloud.

### Step 4 — Analyse

First-order Markov / process maps (pMineR, bupaR) and Heuristics Miner, with at least two algorithms reported. Epistemic or ordered network analysis on coded prompt text. Model transfer-task scores on process indicators, keeping AI-assisted products separate from evidence of learning.

### Step 5 — Interventions (only rules validated in step 3)

| Detected rule                 | Intervention                                            | Evidence                 |
| ----------------------------- | ------------------------------------------------------- | ------------------------ |
| M31 passive reliance          | "Check one claim and name one change before using this" | Fan 2025; RelianceScope  |
| M28 unreflective regeneration | Show the rubric; ask what's wrong before resending      | Chen 2025                |
| M15 without GAP_NOTED         | Ask for one thing they would change                     | Course design            |
| M16 persistent misconception  | Offer the matching theory slide again                   | Conceptual change        |
| M24 low-effort commit         | Ask for a fuller prediction; no penalty                 | Baker 2006               |
| M20/M25 long idle             | Resume card with a 2-minute recap task                  | Lee 2025 (time pressure) |

Cap nudges at one or two per activity, explain why each appears, and let learners see their own process profile. Evaluate each nudge on transfer scores, not completion.

### Step 6 — Governance

Tell learners prompts and outputs are logged and why. Offer opt-out from research use. Strip personal and work-confidential text before analysis or LLM classification: working adults may paste workplace material.

## 5. Caveats

- No rule in v1 or v2 is yet validated in GALS. The Mapping sheet marks each as theory-only or adopted; treat all as candidates until the pilot.
- Most validated libraries come from university reading-writing tasks. Prompting tasks and working adults may need different rules and thresholds.
- Several GenAI findings rest on small samples (Chen: 38; Lai: 34), a preprint (Kosmyna) or self-report (Lee). RelianceScope and StudyChat report weak links to outcomes.
- Dwell, scroll and focus are weaker proxies than eye tracking; label them as proxies.
- All Parameters values are starting points, not findings.
- The v1 theory codes (Win17, Fan22b, Hou25 and others) come from the pipeline document's reference list and were kept as written.

## Sources

Study links are in the table in section 2. Full references for the new rules are on the References sheet of Process_Mining_Library_v2.xlsx.
