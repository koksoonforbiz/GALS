# GALS + Prompting Course — Context Brief (2026-10-22)

Context for a new session working on GALS (Generative AI Learning System) and the prompting course it hosts. It describes what exists and runs today. Facts marked **(live)** come from the production server on 2026-10-22. Everything else is from the code on branch `course-prompting` (commit `ece94da` plus the uncommitted fixes listed in §7).

> **Name note.** The course is often called "Introduction to Prompt Engineering". Its real title in GALS is **"Advanced Prompt Engineering and AI Collaboration — Study Edition"**. There is only one prompting course.

---

## 1. Platform architecture

### Stack

| Layer                | Tech                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo             | pnpm workspaces + Turborepo. Node 24 (`.nvmrc`). Packages: `apps/api`, `apps/web`, `apps/worker`, `apps/pyfeat-worker`, `apps/openface3-worker`, `packages/shared`, `packages/config`, `gals-studio` (separate research desktop tool), `tools/gals-export`                                                                                                 |
| API                  | NestJS + Prisma 6 (`apps/api`). Global prefix `/api`. Zod schemas in `packages/shared` validate request bodies                                                                                                                                                                                                                                             |
| DB / cache / objects | PostgreSQL 16, Redis 7 (sessions, throttling, LLM spend counters), MinIO (S3: uploads, recordings, exports)                                                                                                                                                                                                                                                |
| Web                  | React 18 + Vite + TS + Tailwind, React Router v6. Built as **two bundles**: `dist-student` and `dist-admin`                                                                                                                                                                                                                                                |
| Realtime             | Socket.IO (`/dialogue`, `/text-mining` namespaces)                                                                                                                                                                                                                                                                                                         |
| LLM                  | **AWS Bedrock only** (Converse API, one shared server credential `AWS_BEARER_TOKEN`, region `ap-southeast-1`). Chat: `global.openai.gpt-5.6-sol` (default), `global.openai.gpt-5.6-terra`. Embeddings: `global.cohere.embed-v4:0` (1536-d). Each **teacher** picks Bedrock under _AI Settings_. Student-facing AI calls use the **course owner's** setting |
| Sensing              | WebGazer.js (gaze), pupil-size batches, MediaRecorder → MP4 segments → MinIO → Py-Feat (emotions/AUs) and OpenFace3 (head pose/gaze) workers (CPU-only torch)                                                                                                                                                                                              |
| Security             | JWT auth. 2FA by **authenticator app (TOTP) only** (email option hidden in the UI). `MFA_REQUIRED_ROLES=admin,teacher,student`. ClamAV scans uploads. Rate limiting (`@nestjs/throttler`, Redis store, per client IP via `trust proxy`)                                                                                                                    |

### Two-door deployment

One nginx container serves two entry points (`docker-compose.twodoor.yml`, `deploy/`):

| Door                 | Bundle         | Port (in container) | `/api` policy                                                              | Header to API          |
| -------------------- | -------------- | ------------------- | -------------------------------------------------------------------------- | ---------------------- |
| **Public (student)** | `dist-student` | 8443                | default-deny allowlist (`deploy/nginx/snippets/public-api-allowlist.conf`) | `X-GALS-Door: public`  |
| **Private (staff)**  | `dist-admin`   | 9443                | everything                                                                 | `X-GALS-Door: private` |

The API's DoorGuard also enforces `@PublicDoor` / `@PrivateDoor`, with the route table in `docs/two-door/api-classification.md`. Every new route must be classified there and in the nginx allowlist. Staff signing in on the student door land on `/wrong-door`.

### Key backend modules (`apps/api/src`)

`auth` (JWT, TOTP 2FA, MfaPolicy, RolesGuard) · `activity-log` (event spine: `POST /api/activity-log/batch`, sessions) · `logs` (high-frequency streams: click/scroll/cursor/keystroke-meta/clipboard-meta/visibility/viewport/replay snapshots, sync anchors) · `interactive-lesson` (course parser + slide state) · `prompt-lab` · `learning-events` (parser, validation, classifier, exports, nudges, transfer) · `governance` (text-capture consent) · `rag` (LlmService, retrieval) · `llm/model-registry.ts` · `learning-interventions` (Learning Assistant chatbot + strategies) · `user-management` · `webgazer`, `pyfeat`, `openface3`, `recording` · `text-mining`.

### Core data model (Prisma, abbreviated)

```
User(student|teacher|admin, llmProvider, twoFactorMethod, totpSecret, isTemporaryPassword, …)
 └ Course(teacherId, status, visibility) → CourseModule → ModuleItem(type, lessonJson, …)
      ModuleItem.type includes INTERACTIVE_LESSON (lessonJson = one session's slide deck)
 └ Enrollment(studentId, courseId, status ACTIVE|DROPPED)
StudentSession ─ anchor for all logs
 ├ activity_logs (action enum + JSON metadata)        ← raw action layer
 ├ session_replay_snapshots, session_sync_anchors, visibility_logs, … (streams)
 ├ webgazer / pupil / recording_segments → pyfeat / openface3 results
 └ learning_events (derived)                           ← process layer
lesson_slide_states (per student × item × slide: saved fields, ≤32 KB)
prompt_lab_runs / prompt_lab_versions / prompt_lab_test_cases / prompt_lab_test_results / prompt_lab_output_ratings
text-consent decisions, nudge policies/log, learning-event parameter sets, validation codes, classifier labels, transfer tasks/scores
security_events (CONFIG_CHANGED, PERMISSION_DENIED, AI_OUTPUT_FLAGGED, …)
```

---

## 2. Production deployment (lithium) — operating constraints

- **Host:** SMU SCIS server `lithium`, 10.193.102.20, AlmaLinux 10.2. 128 cores, 503 GB RAM, **4× NVIDIA L40** (driver 615.71, CUDA 13.4; GALS doesn't use them yet). App lives in `~/gals/repo` (user `koksoonchong`).
- **Access:** SMU VPN, then SSH key `~/.ssh/id_ed25519_koksoonchong`, then an **authenticator OTP per connection** (the "SMU server" entry, _not_ the GALS entry). Repeated failed OTPs trigger a temporary SSH block, so make **one attempt per code**.
- **Docker:** **rootless** (`DOCKER_HOST=unix:///run/user/1001/docker.sock`). Linger on, and the user service is enabled, so the stack survives logout and reboot. No sudo. Ports <1024 need the admin.
- **No outbound access to registries** (Docker Hub, quay, npm, PyPI blocked; the admin confirmed this is a production server). **All images are built on the developer laptop** (WSL Docker, compose project `-p repo`), saved and gzipped, streamed over SSH with a SHA-256 check, then `docker load`ed. ClamAV signatures are refreshed on the laptop and copied in. Bedrock (AWS) _is_ reachable.
- **Stack command:** `./deploy/scripts/twodoor.sh l40 <compose args>`. Update: `up -d --no-build --pull never --force-recreate api nginx`. After an nginx restart, check `curl -sk https://127.0.0.1:9443/api/health` = 200 (a stale upstream once gave 502).
- **Fresh-DB migrations:** run them in a one-off container before the API starts: `twodoor.sh l40 run --rm --no-deps -T --entrypoint sh api -c 'npx --no-install prisma migrate deploy'`.
- **Access for testing:** both doors are bound to `127.0.0.1` on lithium. Reach them with an SSH tunnel: `ssh -N -L 8443:127.0.0.1:8443 -L 9443:127.0.0.1:9443 koksoonchong@10.193.102.20` → student https://127.0.0.1:8443, staff https://127.0.0.1:9443 (self-signed certs). Not yet internet-facing.
- **Laptop pitfall:** starting WSL Docker revives the old local dev stack, whose nginx grabs 8443/9443 and shadows the tunnel ("API error: 502"). Stop `gals-milestone-1-monorepo-*` containers after building.
- **Git:** push to remote **`gals`** (`git push gals <branch>`), never `origin`.

**Live state (2026-10-22):** 9 services up 6 days (api, nginx, postgres, redis, minio, clamav, worker, pyfeat-worker, openface3-worker). Users: 1 admin (`koksoonchong@smu.edu.sg`, 2FA on, Bedrock selected), 1 teacher (test account `teacher1@gals.test`, to be deactivated), 2 students. Bedrock chat and embeddings verified from inside the API container.

---

## 3. Course structure

**Source:** `docs/process-mining/course_slides.html` (342,956 bytes, a self-contained study edition with an embedded course JSON). Imported by `apps/api/prisma/scripts/import-prompting-course.ts`, which is **idempotent** and keyed by **frozen slide keys** (`s<session>-<n>`). It refuses key drift unless `--force-key-drift` is passed. Parsing is done by `apps/api/src/interactive-lesson/course-html-parser.ts`; the slide schema is in `packages/shared/src/interactive-lesson.ts`. On a production image the importer must run with `apps/api/src` and the HTML bind-mounted into a one-off API container (the prod image has no `src`).

**In GALS (live):** course `60e2d976-9fdd-4213-86a4-a56fab51c6d6`, owner `koksoonchong@smu.edu.sg`, **PUBLISHED / PUBLIC**. There are 9 modules, each holding one `INTERACTIVE_LESSON` item whose `lessonJson` is that session's deck, **196 slides** in total.

| #   | Module                                                                  | Slides |
| --- | ----------------------------------------------------------------------- | ------ |
| 1   | Session 1: How Language Models See Text                                 | 26     |
| 2   | Session 2: The Anatomy of a Prompt                                      | 23     |
| 3   | Session 3: Learning from Examples: Zero-Shot and Few-Shot               | 23     |
| 4   | Session 4: Making Models Reason: Chain-of-Thought and Beyond            | 24     |
| 5   | Session 5: System Prompts, Metaprompting, and Structured Output         | 22     |
| 6   | Session 6: Iterating and Evaluating Prompts Systematically              | 25     |
| 7   | Session 7: Grounding and Acting: RAG and Tool Use                       | 24     |
| 8   | Session 8: Adversarial Prompts, Multimodal Prompting, and Mini-Capstone | 25     |
| 9   | Appendix: References, materials and version notes                       | 4      |

### Per-session slide template

Every session follows the same pedagogical arc. Counts by type:

| Session | title | objectives | theory | figure | think | predict | mcq | example | misconceptions | concept | check | exercise | task | stretch | selfscore | reflect |
| ------- | ----- | ---------- | ------ | ------ | ----- | ------- | --- | ------- | -------------- | ------- | ----- | -------- | ---- | ------- | --------- | ------- |
| s1      | 1     | 1          | 6      | 4      | 1     | 1       | 1   | 1       | 1              | 1       | 1     | 3        | 1    | 1       | 1         | 1       |
| s2      | 1     | 1          | 5      | 2      | 1     | 1       | 1   | 1       | 1              | 1       | 1     | 3        | 1    | 1       | 1         | 1       |
| s3      | 1     | 1          | 5      | 2      | 1     | 1       | 1   | 1       | 1              | 1       | 1     | 3        | 1    | 1       | 1         | 1       |
| s4      | 1     | 1          | 6      | 2      | 1     | 1       | 1   | 1       | 1              | 1       | 1     | 3        | 1    | 1       | 1         | 1       |
| s5      | 1     | 1          | 5      | 2      | 1     | 1       | 1   | 1       | 1              | 1       | 1     | 2        | 1    | 1       | 1         | 1       |
| s6      | 1     | 1          | 7      | 2      | 1     | 1       | 1   | 1       | 1              | 1       | 1     | 2        | 1    | 2       | 1         | 1       |
| s7      | 1     | 1          | 7      | 2      | 1     | 1       | 1   | 1       | 1              | 1       | 1     | 2        | 1    | 1       | 1         | 1       |
| s8      | 1     | 1          | 6      | 3      | 1     | 1       | 1   | 1       | 1              | 1       | 1     | 2        | 1    | 2       | 1         | 1       |
| s9      | 1     | –          | 3      | –      | –     | –       | –   | –       | –              | –       | –     | –        | –    | –       | –         | –       |

**Slide types (`LessonSlideType`):** `title`, `objectives`, `theory`, `figure` (SVG + caption/alt), `think` (free-text prediction, gate ≥20 chars), `predict` (prediction then auto reveal, gate 20), `mcq` (options with feedback; distractors carry `misconceptionId`; rationale gate 15), `example`, `misconceptions` (agree/disagree per claim; **every claim is false**; reason gate 8), `concept`, `check` (answer gate 10 → reveal → "what I missed"), `exercise` / `task` / `stretch` (labs; `lab: true` = take-home; `expect` = analysis template revealed after results), `selfscore` (criteria), `reflect` (what worked / what to change / next real task, gate 20), `transfer` (unassisted prompt-writing task appended at import from a JSON file; **none imported yet**, only `transfer_tasks.template.json` exists). Gates (`LESSON_GATES`) mirror the HTML: options, reveal and "show answer" stay locked until a valid save.

### Labs and the Prompt Lab (38 slides)

`exercise` (20), `task` (8) and `stretch` (10) slides embed the **Prompt Lab**, which replaces the "external AI tool" in the HTML. Its features: run settings and goal, run with 1–5 samples (declared experiment), temperature, max tokens ≤4000, prompt ≤24k chars, saved versions with token counts (approx chars/4) and revision tags, test cases (≤20) with pass/fail and failure reasons, output rating against criteria, claim verification, copy/paste attribution. The API accepts `systemText` (≤8k), but **the UI has no system-prompt field yet**. If the course owner hasn't selected Bedrock, the Lab silently falls back to a **"Built-in template"** (no real AI).

Lab feasibility on GALS today:

| Status                                                        | Slides                                                                                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fully doable (self-contained)                                 | s1-20, s1-23, s2-16, s2-20, s3-20                                                                                                                                         |
| AI works, but needs the **materials pack** (not in GALS/repo) | s1-21, s1-22, s2-17–2-19, s3-16–3-19, s4-17–4-21, s6-18–6-21                                                                                                              |
| Needs a **system-prompt box** (missing in UI)                 | s5-16 (LexBot), s8-18 (red/blue team)                                                                                                                                     |
| Needs a tool GALS lacks                                       | s1-19 token counter (M-01), s5-17/5-18 schema validator (M-07), s7-18/7-20 retrieval sandbox (M-09), s6-22/7-19/7-21 tool simulator (M-10), s8-18 security sandbox (M-11) |
| Needs images                                                  | s8-19 image generation, s8-20 screenshot input (Prompt Lab is text-only)                                                                                                  |
| No AI needed                                                  | s5-19, s8-21, s8-22 (capstone design note)                                                                                                                                |

The **materials pack** M-01…M-14 is described on slide `s9-2`: token counter, product briefs, filler passage, articles and mini-sets, support-message dev/hold-out/pool sets, reasoning problems with a hidden checker, meeting notes and validator, ticket set and rubric, policy corpus and retrieval sandbox, tool simulator, security sandbox, form screenshots, capstone rubric, facilitator run sheet. **None of it exists as GALS content.**

---

## 4. Learning-process capture (how actions map to learning processes)

Three layers, following `GALS_PromptingCourse_Integration_Plan_for_Claude_Code.md` (Phases 0–7, all implemented; Phase 7 passed locally on 2026-10-07/08):

### 4.1 Raw action layer → `activity_logs`

Emitted by `apps/web/src/components/interactive-lesson/` (`lessonEvents.ts`, `useLessonTracking.ts`, `prompt-lab/PromptLab.tsx`) through the activity-log context, batched to `/api/activity-log/batch`, each with `slideKey`, `slideType`, `moduleItemId`, session and metadata.

- **Reading / navigation:** `SLIDE_ENTERED` (`visitNo`), `SLIDE_EXITED` (`dwellMs`, `maxVisiblePct`), `MODULE_ITEM_VIEWED`, `SESSION_START/END`, `IDLE_STARTED/ENDED` (`T_idle` 120 s). Focus comes from `visibility_logs` and isn't duplicated.
- **Attempt / commitment:** `ATTEMPT_STARTED` (first input, `msFromSlideEnter`), `PREDICTION_COMMITTED` (think/predict), `BELIEF_COMMITTED` / `BELIEF_REVISED` (misconceptions), `MCQ_ANSWERED` (`option`, `correct`, `attemptNo`, `misconceptionId`), `RATIONALE_SUBMITTED`, `SELF_CHECK_SUBMITTED`, `RESULTS_RECORDED`, `CONFIDENCE_RATED` (1–5, before/after).
- **Evaluation / reflection:** `REFERENCE_REVEALED` (`revealKind` predict/check/expect/misconception), `GAP_NOTED` ("what I missed", `chars:0` = none stated), `CRITERION_SELF_SCORED`, `REFLECTION_SUBMITTED` (3 parts).
- **AI interaction (Prompt Lab):** `RUN_SETTINGS_RECORDED`, `PROMPT_GOAL_DECLARED`, `TOKEN_COUNT_CHECKED`, `PROMPT_SUBMITTED` (`runId`, `versionNo`, tokens), `AI_OUTPUT_VIEWED`, `OUTPUT_REGENERATED`, `PROMPT_VERSION_SAVED`, `PROMPT_REVISION_TAGGED`, `TEST_CASE_RUN`, `TEST_RESULT_RECORDED`, `OUTPUT_RATED`, `OUTPUT_VERIFIED`, `OUTPUT_COPIED`, `OUTPUT_PASTED` (`matchesAiOutput`), `OUTPUT_EDITED`. **No clipboard text or keystrokes are ever stored**, only char counts.
- **Transfer:** `TRANSFER_TASK_SUBMITTED`.
- **Platform-wide, also present:** chatbot (`CHATBOT_MESSAGE_SENT/RECEIVED`), interventions, WebGazer, pupil, recording, emotion self-report.

**Text and consent:** text fields are included only with the learner's **text-capture consent** (`TEXT_CONSENT_NOTICE_VERSION = prompting-course-notice-v1`). Without consent, events carry `chars` only, and Prompt Lab text is a session-only working copy that is scrubbed at session close (`retainText`).

### 4.2 Process layer → `learning_events`

`apps/api/src/learning-events/engine/rules.ts`: 36 pure rules (**M01–M35 + M03b**) from `Process_Mining_Library_v2.xlsx` (mirrored in `learning-events/config/library.v2.json`: 83 actions, 36 rules, parameters). Each output is a **candidate** learning event (`evidenceClass`: adopted from the literature, _not yet validated in GALS_). Rules whose inputs this course never emits are marked `notApplicable` and listed in the coverage report.

| Rule       | Family                                                                  | Rule | Family                                                                                     |
| ---------- | ----------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| M01        | Orientation (objectives/criteria dwell ≥ T_orient before first attempt) | M19  | Strategy adaptation                                                                        |
| M02        | Planning                                                                | M20  | Persistence / interruption / disengagement candidate                                       |
| M03 / M03b | Information access (first reading) / Re-reading                         | M21  | Knowledge-based regulation (revisit → changed answer)                                      |
| M04        | Knowledge building / self-explanation                                   | M22  | Self-appraisal; forward planning                                                           |
| M05        | Forethought / prediction                                                | M23  | Calibration (confidence vs. accuracy, per module)                                          |
| M06        | Active performance                                                      | M24  | Low-effort commitment / gaming candidate (`T_rapid`)                                       |
| M07        | Performance evaluation (system)                                         | M25  | Off-task / idle time                                                                       |
| M08        | Help-seeking / co-regulation                                            | M26  | Planning (AI task: settings + goal before first prompt)                                    |
| M09        | Instrumental help-seeking and recovery                                  | M27  | Evaluation-driven prompt revision (read → judged → revised)                                |
| M10        | Possible answer dependence (n/a: reveals are gated)                     | M28  | Unreflective regeneration (excl. declared experiments)                                     |
| M11        | Help avoidance (candidate)                                              | M29  | Systematic testing (version tested on ≥2 cases + judged)                                   |
| M12        | Support declined                                                        | M30  | Verification / critical evaluation of AI output                                            |
| M13        | Monitoring (confidence ratings)                                         | M31  | Passive reliance (candidate)                                                               |
| M14        | Evaluation against a criterion                                          | M32  | Active / constructive use of AI output                                                     |
| M15        | Evaluation with self-identified gap (check → reveal → gap)              | M33  | Help-seeking type with an LLM (executive/instrumental/conceptual/verification; classifier) |
| M16        | Belief revision (misconception commit → changed?)                       | M34  | Intervention uptake                                                                        |
| M17        | Monitoring followed by regulation                                       | M35  | Retention / transfer / authentic performance (unassisted transfer task)                    |
| M18        | Recovery / adaptive regulation                                          |      |                                                                                            |

**Parameters** (versioned parameter sets; recompute after changing them): `T_read` 10 s (M03), `T_orient` 15 s (M01), `T_out` = max(5 s, words ÷ 4/s) (M27/M28), `T_idle` 120 s (M20/M25), `T_rapid` (M24), and others in `library.v2.json`.

**When it runs:** `@OnEvent('session.closed')` → `computeSession`. **Only explicit session close triggers it** (logout or the close endpoint). Sessions ended by closing the tab are **not parsed** until someone calls `POST /api/learning-events/courses/:courseId/recompute`. **(live)** 14 student sessions, only 2 closed, 8 learning events, so run a course recompute before any analysis.

### 4.3 Validation, analysis and interventions

`/api/learning-events/…` (private door, teacher/admin): `library`, `parameter-sets` (GET/POST), `sessions/:id` (+ `recompute`), `courses/:id/recompute`, `courses/:id/coverage`, `validation/codes/seed`, `courses/:id/validation(.csv)`, `courses/:id/inter-rater`, `rule-status`, `courses/:id/classifier/run | sample.csv | labels | agreement` (LLM prompt classifier for M33, human–LLM κ threshold default 0.6), **`courses/:id/export/event-log.csv`** (`?format=eventlog` gives bupaR start/complete lifecycle rows; loader in `docs/process-mining/load_eventlog.R`), `courses/:id/export/outcomes.csv`, `courses/:id/transfer` (+ `transfer/scores`).

- **Think-aloud validation** reuses Replay annotations (ReplayAnnotation codes vs. rule output: TP / sensitivity / specificity / match rate).
- **Nudges** (`learning-events/nudges`): rule-triggered, **off by default**. Enabling an unvalidated rule requires `requiresValidated: false`. Capped, with dismissal logged.
- Research workflow: `docs/process-mining/RESEARCH_WORKFLOW.md`. Phase 0 discovery: `PHASE0_DISCOVERY.md`. Phase 7 results: `PHASE7_VERIFICATION.md`.

**(live) capture counts:** activity*logs 1,158 (mostly sensing streams; `SLIDE_ENTERED` 87, `SLIDE_EXITED` 85, `IDLE*\*`6,`QUESTION_ANSWERED`5,`PROMPT_SUBMITTED` 1), student_sessions 14, learning_events 8, lesson_slide_states 1, prompt_lab_runs 1, prompt_lab_versions 0, session_replay_snapshots 895, visibility_logs 45. **The capture has not yet been verified end-to-end on the server with Bedrock** (Phase 7 caveat 3: local runs used a stand-in model).

---

## 5. AI safety / misuse guardrails (current state)

| Control                                                                                                                                                | State                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth + TOTP, enrolment check, Prompt Lab only on lab slides                                                                                            | ✅                                                                                                                                                                                                         |
| Prompt Lab per-student per-course limits: 60 runs/h, 200k tokens/24 h (`PROMPT_LAB_RUNS_PER_HOUR`, `PROMPT_LAB_TOKENS_PER_DAY`); route throttle 20/min | ✅                                                                                                                                                                                                         |
| All runs logged (text kept only with consent); teacher read `GET /api/prompt-lab/courses/:courseId/students/:studentId`                                | ✅                                                                                                                                                                                                         |
| **Content moderation**                                                                                                                                 | ❌ None. It relies on an AWS **Bedrock Guardrail** (`BEDROCK_GUARDRAIL_ID`/`VERSION`, empty). If one is added, its prompt-attack filter would block Session 8's legitimate injection exercises, so tune it |
| **Daily LLM spend cap** (`LLM_DAILY_COST_CAP_USD`)                                                                                                     | ❌ Unset. Note it's tracked **per course owner** (all students in a course share it)                                                                                                                       |
| Off-task use                                                                                                                                           | ⚠️ A lab slide accepts any prompt, so it can be used as a general chatbot (rate limits only)                                                                                                               |

---

## 6. Open items

1. Course owner must keep **Bedrock** selected; the Learning Assistant and Prompt Lab both depend on it.
2. **Materials pack** (M-01…M-14) and missing lab tools (token counter, validator, retrieval sandbox, tool simulator, security sandbox, image I/O): build, provide as files, or mark the labs external/optional.
3. **System-prompt field** in the Prompt Lab UI.
4. **Transfer tasks** (`transfer_tasks.json`) not authored or imported (needed for M35).
5. **Misconception tags** on the 8 MCQs await approval (plan decision #3).
6. Parse unclosed sessions (course recompute) and consider closing idle sessions automatically.
7. Bedrock Guardrail + daily cost cap.
8. End-to-end server verification of capture (a real student session → actions → learning events → bupaR export). R/bupaR not yet run.
9. Go-live: public route/IP, port 443 (rootless needs a sysctl or firewall redirect), real hostname + Let's Encrypt via DNS-01 (issued on the laptop), client-IP preservation, staff door VPN-only.
10. Staff-account admin UI: there is no list or deactivate/reset UI for teacher accounts (students only).

## 7. Uncommitted changes (laptop + deployed on lithium, not in git)

`apps/api/src/main.ts` (trust proxy) · `user-management.{controller,service}.ts` + new `user-management.service.spec.ts` (teacher→admin escalation fix in bulk provision; `POST /user-management/users/:userId/reset-2fa`; reset-password pipe fix) · `courses/courses.controller.ts` (PATCH validation pipe moved to `@Body` — method-level `@UsePipes` was validating `@Param` and 400-ing every request) · `web/.../AccountSecurityPage.tsx` (email 2FA hidden behind `VITE_ENABLE_EMAIL_2FA`) · `UserManagementPage.tsx` (Reset 2FA button) · `components/ProtectedRoute.tsx` (fix for the password-change ↔ MFA-enrolment redirect loop) · `components/student/PermissionGate.tsx` (screen-share error reasons) · `docker-compose.twodoor.yml` (clamav `restart: unless-stopped`) · `docs/two-door/{runbook-l40,api-classification}.md`.
