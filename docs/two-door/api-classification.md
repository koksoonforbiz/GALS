# Two-Door — API & Socket Classification (Phase 0 artifact 2 of 3)

**Source of truth:** every `*.controller.ts` under `apps/api/src` (39 controllers) parsed for `@Controller`, HTTP-method decorators, `@Roles`, and `@UseGuards`, plus `apps/api/src/main.ts` for the global prefix and the three `@WebSocketGateway` classes. Branch `splitting_builds` at `ca30e33`. The extractor treats guards as **cumulative** (class + method), as NestJS does.

**Status:** READ-ONLY discovery. This file is the artifact the public nginx allowlist and the Phase 4 door-guard are generated from. **Human review of every PUBLIC/BOTH row is the critical security review of this whole effort.**

**Totals:** 332 HTTP routes — **88 PUBLIC**, **47 BOTH**, **197 PRIVATE**, 0 unclassified. Public door must therefore carry 135 routes. Plus 3 Socket.IO gateways.

Global prefix: `app.setGlobalPrefix('api')` (`main.ts:98`), no versioning. Every path below is the full path as served.

## Classification rules applied

1. **`@Roles` present** (260 of 332 routes): `student`-only → PUBLIC; `teacher`/`admin`-only → PRIVATE; any mix containing `student` and a staff role → BOTH.
2. **No `@Roles`** (72 routes, "any authenticated"): classified by which frontend audience actually calls the route (verified by grepping the web client), per the map in the table notes.
3. **Overrides** for the security-relevant special cases (dev seed, health, the two unguarded export routes) — each called out inline.

Door meaning: **PUBLIC** = student door allowlist; **PRIVATE** = admin door only, 404 on the public door; **BOTH** = allowlisted on the public door, also served on the admin door.

## Unguarded routes (no JWT at all) — exactly six

| Route                                                                            | Classification        | Why it matters                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/auth/login`, `POST /api/auth/2fa/verify`, `POST /api/auth/2fa/resend` | BOTH                  | Pre-authentication by nature. Rate-limited per route.                                                                                                                                                                                                                    |
| `POST /api/auth/register`                                                        | BOTH                  | **[HUMAN DECISION]** Public self-registration on the student door. Linked from `/login`. Accounts are otherwise teacher-provisioned.                                                                                                                                     |
| `POST /api/dev/seed`                                                             | PRIVATE               | Hard-gated `NODE_ENV === 'development'` (`seed.controller.ts:21–24`, fails closed if unset). Creates a teacher+student with password `password123`. **[HUMAN DECISION]** exclude the controller from the production build/compose entirely rather than rely on the gate. |
| `GET /api/health`                                                                | PRIVATE (recommended) | Frontend `/health` page calls it. **[HUMAN DECISION]** if external monitoring needs it on the public door — a minimal `200` from nginx itself would be the safer alternative.                                                                                            |

## Socket.IO gateways — the mounting facts (decides Phase 4)

| Gateway             | File                                    | Namespace              | Path                  | Audience                                                                | Client in `apps/web`?                                                                                                                                     |
| ------------------- | --------------------------------------- | ---------------------- | --------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DialogueGateway`   | `dialogue/dialogue.gateway.ts:13`       | `dialogue`             | default `/socket.io/` | **student**                                                             | Yes — `pages/student/DialogueLearning.tsx:213–224`, sends `auth: { token }`                                                                               |
| `GradingGateway`    | `grading/grading.gateway.ts:12`         | _(none → default `/`)_ | default `/socket.io/` | **student** (grade push to `student:<id>` rooms)                        | Yes — `lib/socket.ts:8–13`, **no auth sent**                                                                                                              |
| `TextMiningGateway` | `text-mining/text-mining.gateway.ts:10` | `text-mining`          | default `/socket.io/` | **teacher** (server emits `ef.detection.*` from `detection.service.ts`) | **No.** No `io(` call anywhere in teacher/feature code; the text-mining dashboard is HTTP fetch + refetch (`features/text-mining/hooks/useDashboard.ts`). |

Consequences:

- All three multiplex over **one path**, so nginx cannot separate them by URL — exactly the spec's §4.4 trap. `/socket.io/` must be allowlisted on the public door (dialogue + grading need it) and the teacher namespace must be refused **at the handshake** (spec option 1). Option 2 (custom `path` for text-mining) is unnecessary: there is no browser client to move.
- The **admin build needs no socket client at all.** The student build needs exactly two (grading default namespace, dialogue namespace). Both currently connect to an **absolute** `VITE_API_URL || 'http://localhost:3000'` — must become same-origin in production builds (Phase 2).
- All three gateways set `cors: true` (any origin) — becomes moot once same-origin, but note it.

### ★ Finding: the gateways have no authentication at all

`handleConnection` only logs (`dialogue.gateway.ts:20–22`); `GradingGateway` and `TextMiningGateway` have no connection handler. Every `join*` handler puts the client into whatever room id it names, with no ownership check:

- `/dialogue` → `join_session { sessionId }` → receives another student's streamed AI replies (`message_chunk`, `message_complete`) — chat transcripts are personal data.
- default `/` → `join { studentId }` → receives any student's `grade_completed` events.
- `/text-mining` → `join_session { sessionId }` → receives any student's `ef.detection.*` events.

The spec's premise that "auth guards on the gateways remain the primary control" is **not true in the current code**. The Phase 4 door-header check closes the _teacher-namespace-via-public-door_ case only; the _student-eavesdrops-on-student_ cases need JWT verification at the handshake plus ownership checks in `join*`. The dialogue client already sends the token; the grading client would need to. **[HUMAN DECISION]**: this touches the "no JWT logic changes" boundary. Strong recommendation to include it in Phase 4 — it is additive (no existing guard is modified) and the two-door work makes `/socket.io/` deliberately internet-reachable.

## Mixed modules — per-method resolution (the spec's "trap")

All resolved at method+path granularity; no route is ambiguous. Modules the spec named that **no longer exist** (deleted in `ca30e33`, migration `20260907000000_drop_kc_systems`): `mastery`, `kc`, `kc-evaluation`, `knowledge-version`, `curriculum-coverage`, `publish-gate` — do not carry them into the allowlist.

| Module                                                                | PUBLIC / BOTH                                              | PRIVATE                                                                                 | nginx-expressible?                                                            |
| --------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------- |
| `courses`                                                             | `GET /api/courses`, `/catalog`, `/:id` (BOTH)              | all mutations, `/dialogue-settings`, `/enrollment-policy`, publish/unpublish, duplicate | Yes — `limit_except GET` on `^/api/courses(/[^/]+)?$`, deny the sub-resources |
| `modules` / `items`                                                   | `GET /api/items/:id/download-url` (BOTH) ★ PDF path        | every module/item mutation, `upload-url`, versions                                      | Yes — only that one GET suffix is allowlisted                                 |
| `assessments`                                                         | `GET /api/assessments`, `/available`, `/:id` (BOTH/PUBLIC) | POST/PATCH/DELETE, `/questions`, `/reorder`                                             | Yes — `limit_except GET`                                                      |
| `attempts`                                                            | student create/list/submit/read                            | teacher review reads                                                                    | Yes (distinct paths)                                                          |
| `enrollments`                                                         | `/self`, `/my`, `/:courseId/drop`                          | teacher enrol/list/delete/`drop-student`                                                | Yes (distinct paths)                                                          |
| `recording`                                                           | `segments/initiate`, `segments/:id/complete                | fail`, `consent/:courseId`, `GET config/:courseId`                                      | `PATCH config`, `segments/:id/download`, `segments/:studentId/:courseId`      | Yes — method limit on `config`, distinct suffixes elsewhere |
| `webgazer` / `pupil-size`                                             | `POST logs`, `POST calibration`, `GET config/:courseId`    | `PATCH config`, teacher log reads, `.../export`                                         | Yes — but see the export bug below                                            |
| `activity-log`                                                        | `session/open                                              | close                                                                                   | course`, `batch`                                                              | everything under `/api/activity-log/teacher/`               | Yes — one prefix |
| `logs` (11 ingest routes)                                             | all BOTH (`student,teacher`) — sensing ingest              | —                                                                                       | Yes — whole prefix                                                            |
| `learning-interventions`                                              | 25 student routes                                          | 6 `prompt-config/*` teacher routes                                                      | Yes — one sub-prefix is private                                               |
| `student-rag`                                                         | all 11 student-facing                                      | —                                                                                       | Yes — whole prefix                                                            |
| `dialogue` / `dialogue-notes` / `chat-history` / `code-decomposition` | all student-facing                                         | —                                                                                       | Yes — whole prefixes                                                          |
| `pre-generation`                                                      | `POST match-document`, `GET ready` (student)               | 8 config/admin routes                                                                   | Yes                                                                           |
| `vlm`                                                                 | `GET config/course/:id`, `POST describe-page` (student)    | 2 teacher config                                                                        | Yes                                                                           |
| `pyfeat` / `openface3`                                                | `GET pyfeat/config/:courseId` (BOTH)                       | all orchestration/retry/backfill/stats                                                  | Yes                                                                           |
| `jobs`                                                                | —                                                          | **both routes PRIVATE, always**                                                         | Yes — whole prefix denied                                                     |
| `blobs`                                                               | all 5 BOTH                                                 | —                                                                                       | Yes — whole prefix                                                            |

Because no PRIVATE route shares a (method, path) with a PUBLIC one, **nginx can express the entire allowlist** with prefix/regex `location`s plus `limit_except`. The Phase 4 door-guard is therefore genuine defence-in-depth, not a workaround for an inexpressible rule.

### ★ Finding: two biometric export routes are missing `@Roles`

`GET /api/pupil-size/logs/:studentId/:sessionId/export` (`pupil-size.controller.ts:78–80`) and `GET /api/webgazer/logs/:studentId/:sessionId/export` (`webgazer.controller.ts:98–100`) have `RolesGuard` from the class but **no `@Roles`** — and `RolesGuard` passes any authenticated user when no roles are required. Their sibling routes (`logs/:studentId/:courseId`) are `@Roles('teacher')`. Net effect today: **any logged-in student can export any other student's gaze/pupil CSV** by supplying ids. Classified PRIVATE here; the one-line `@Roles('teacher')` fix is proposed for Phase 4 (applying the existing decorator, not changing RBAC logic — **[HUMAN DECISION]** to confirm it's in scope). This also corrects an over-claim in `docs/OWASP_API_TOP10_MAPPING.md` (API1 "no route found…").

### Already fixed (spec is stale)

- **`jobs.controller.ts` command injection** — already resolved: `execFile` with an argument array (no shell) and `assertValidSessionId` UUID validation (`jobs.controller.ts:24–32, 48, 62`). Phase 4.3 is a verification-only step.

## Derived public allowlist — distinct path patterns (135 routes)

`:x` = a path parameter. Generated from the PUBLIC + BOTH rows; nginx templates in Phase 3 are built from this list, with `limit_except` where the same pattern has private methods (marked ⓜ).

```
/api/auth/{login,logout,register,me,change-password,2fa/*}
/api/courses            GET only ⓜ      /api/courses/catalog     /api/courses/:x   GET only ⓜ
/api/topics  /api/topics/:x   GET only ⓜ
/api/assessments  GET only ⓜ   /api/assessments/available   /api/assessments/:x  GET only ⓜ
/api/attempts  /api/attempts/my  /api/attempts/:x  /api/attempts/:x/submit
/api/enrollments/self  /api/enrollments/my  /api/enrollments/:x/drop
/api/items/:x/download-url   GET only
/api/blobs/**
/api/recording/config/:x  GET only ⓜ   /api/recording/consent/:x
/api/recording/segments/initiate   /api/recording/segments/:x/{complete,fail}
/api/webgazer/config/:x GET only ⓜ  /api/webgazer/logs POST  /api/webgazer/calibration POST
/api/pupil-size/config/:x GET only ⓜ  /api/pupil-size/logs POST
/api/pyfeat/config/:x  GET only ⓜ
/api/activity-log/session/{open,close,course}   /api/activity-log/batch
/api/logs/**   (11 POST ingest routes incl. replay-snapshots, sync-anchor)
/api/dialogue/**   /api/dialogue-notes/**   /api/chat-history/**   /api/code-decomposition/**
/api/learning-interventions/**  EXCEPT  /api/learning-interventions/prompt-config/**  (PRIVATE)
/api/student-rag/**
/api/pre-generation/{match-document,ready}
/api/vlm/config/course/:x  GET     /api/vlm/describe-page  POST
/socket.io/            (dialogue + default namespaces; text-mining refused at handshake)
/s3/**                 (MinIO presigned proxy — see config-inventory.md)
/.well-known/acme-challenge/   (Let's Encrypt HTTP-01)
```

Everything else under `/api/` → **404** on the public door. Notably denied: `/api/user-management/**`, `/api/question-generation/**`, `/api/questions/**`, `/api/rag/**`, `/api/llm/**`, `/api/llm-settings`, `/api/analytics/**`, `/api/affective-mapping/**`, `/api/text-mining/**`, `/api/replay-annotations/**`, `/api/jobs/**`, `/api/openface3/**`, `/api/evaluation/**`, `/api/course-structure/**`, `/api/page-content/**`, `/api/admin/**`, `/api/activity-log/teacher/**`, `/api/dev/**`, `/api/health`, and every teacher-only method on the mixed prefixes.

## Full route table (generated)

Columns: `@Roles` as declared (`(none)` = any authenticated), effective guards (cumulative), assigned door, and the rule/reason.

### ActivityLogController (`activity-log/activity-log.controller.ts`)

| Method | Path                                                                         | @Roles          | Guards                  | Door        | Note                            |
| ------ | ---------------------------------------------------------------------------- | --------------- | ----------------------- | ----------- | ------------------------------- |
| POST   | `/api/activity-log/session/open`                                             | student         | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |
| POST   | `/api/activity-log/batch`                                                    | student,teacher | JwtAuthGuard,RolesGuard | **BOTH**    | Explicit shared @Roles.         |
| PATCH  | `/api/activity-log/session/course`                                           | student         | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |
| POST   | `/api/activity-log/session/close`                                            | student,teacher | JwtAuthGuard,RolesGuard | **BOTH**    | Explicit shared @Roles.         |
| GET    | `/api/activity-log/teacher/students/:studentId/sessions`                     | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/activity-log/teacher/sessions/:sessionId`                              | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| DELETE | `/api/activity-log/teacher/sessions/:sessionId`                              | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/activity-log/teacher/sessions/:sessionId/summary`                      | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/activity-log/teacher/sessions/:sessionId/timeline-data`                | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/activity-log/teacher/sessions/:sessionId/replay`                       | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/activity-log/teacher/sessions/:sessionId/replay/snapshots`             | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/activity-log/teacher/sessions/:sessionId/replay/snapshots/:snapshotId` | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/activity-log/teacher/sessions/:sessionId/export`                       | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/activity-log/teacher/sessions/:sessionId/export/dom-snapshots`         | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/activity-log/teacher/sessions/:sessionId/export/screenshots`           | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/activity-log/teacher/sessions/:sessionId/export-url`                   | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/activity-log/teacher/students/:studentId/all-sessions-export`          | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### AffectiveMappingController (`affective-mapping/affective-mapping.controller.ts`)

| Method | Path                                                        | @Roles        | Guards                  | Door        | Note                            |
| ------ | ----------------------------------------------------------- | ------------- | ----------------------- | ----------- | ------------------------------- |
| GET    | `/api/affective-mapping/config/:courseId`                   | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| PUT    | `/api/affective-mapping/config/:courseId`                   | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/affective-mapping/config/:courseId/reset-defaults`    | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/affective-mapping/config/:courseId/history`           | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/affective-mapping/config/:courseId/preview`           | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/affective-mapping/windows`                            | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/affective-mapping/windows/session/:sessionId/summary` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/affective-mapping/course/:courseId/overview`          | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/affective-mapping/export/windows.csv`                 | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### AnalyticsController (`analytics/analytics.controller.ts`)

| Method | Path                                | @Roles        | Guards                  | Door        | Note                            |
| ------ | ----------------------------------- | ------------- | ----------------------- | ----------- | ------------------------------- |
| POST   | `/api/analytics/compute`            | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/analytics/:sessionId/summary` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### AssessmentsController (`assessments/assessments.controller.ts`)

| Method | Path                                         | @Roles        | Guards                  | Door        | Note                                                                        |
| ------ | -------------------------------------------- | ------------- | ----------------------- | ----------- | --------------------------------------------------------------------------- |
| POST   | `/api/assessments`                           | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                             |
| GET    | `/api/assessments`                           | (none)        | JwtAuthGuard,RolesGuard | **BOTH**    | Students list/read assessments; teacher assembly routes are @Roles teacher. |
| GET    | `/api/assessments/available`                 | student       | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).                                                   |
| GET    | `/api/assessments/:id`                       | (none)        | JwtAuthGuard,RolesGuard | **BOTH**    | Students list/read assessments; teacher assembly routes are @Roles teacher. |
| PATCH  | `/api/assessments/:id`                       | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                             |
| DELETE | `/api/assessments/:id`                       | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                             |
| POST   | `/api/assessments/:id/questions`             | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                             |
| DELETE | `/api/assessments/:id/questions/:questionId` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                             |
| POST   | `/api/assessments/:id/reorder`               | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                             |
| PATCH  | `/api/assessments/:id/questions/:questionId` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                             |

### AttemptsController (`attempts/attempts.controller.ts`)

| Method | Path                       | @Roles        | Guards                  | Door        | Note                                                                     |
| ------ | -------------------------- | ------------- | ----------------------- | ----------- | ------------------------------------------------------------------------ |
| POST   | `/api/attempts`            | student       | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).                                                |
| GET    | `/api/attempts`            | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                          |
| GET    | `/api/attempts/my`         | student       | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).                                                |
| GET    | `/api/attempts/review`     | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                          |
| GET    | `/api/attempts/:id`        | (none)        | JwtAuthGuard,RolesGuard | **BOTH**    | Student reads own attempt; teacher reads for review (AttemptDetailPage). |
| PATCH  | `/api/attempts/:id`        | student       | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).                                                |
| POST   | `/api/attempts/:id/submit` | student       | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).                                                |
| POST   | `/api/attempts/:id/grade`  | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                          |

### AuthController (`auth/auth.controller.ts`)

| Method | Path                               | @Roles | Guards       | Door     | Note                                                                             |
| ------ | ---------------------------------- | ------ | ------------ | -------- | -------------------------------------------------------------------------------- |
| POST   | `/api/auth/register`               | (none) | (none)       | **BOTH** | Login/2FA/me/change-password needed on both doors (each door has its own login). |
| POST   | `/api/auth/login`                  | (none) | (none)       | **BOTH** | Login/2FA/me/change-password needed on both doors (each door has its own login). |
| POST   | `/api/auth/logout`                 | (none) | JwtAuthGuard | **BOTH** | Login/2FA/me/change-password needed on both doors (each door has its own login). |
| POST   | `/api/auth/2fa/verify`             | (none) | (none)       | **BOTH** | Login/2FA/me/change-password needed on both doors (each door has its own login). |
| POST   | `/api/auth/2fa/resend`             | (none) | (none)       | **BOTH** | Login/2FA/me/change-password needed on both doors (each door has its own login). |
| POST   | `/api/auth/2fa/enable`             | (none) | JwtAuthGuard | **BOTH** | Login/2FA/me/change-password needed on both doors (each door has its own login). |
| POST   | `/api/auth/2fa/enable/confirm`     | (none) | JwtAuthGuard | **BOTH** | Login/2FA/me/change-password needed on both doors (each door has its own login). |
| POST   | `/api/auth/2fa/disable`            | (none) | JwtAuthGuard | **BOTH** | Login/2FA/me/change-password needed on both doors (each door has its own login). |
| POST   | `/api/auth/2fa/totp/setup`         | (none) | JwtAuthGuard | **BOTH** | Login/2FA/me/change-password needed on both doors (each door has its own login). |
| POST   | `/api/auth/2fa/totp/setup/confirm` | (none) | JwtAuthGuard | **BOTH** | Login/2FA/me/change-password needed on both doors (each door has its own login). |
| POST   | `/api/auth/change-password`        | (none) | JwtAuthGuard | **BOTH** | Login/2FA/me/change-password needed on both doors (each door has its own login). |
| GET    | `/api/auth/me`                     | (none) | JwtAuthGuard | **BOTH** | Login/2FA/me/change-password needed on both doors (each door has its own login). |

### BlobController (`blob/blob.controller.ts`)

| Method | Path                          | @Roles | Guards       | Door     | Note                                                                                      |
| ------ | ----------------------------- | ------ | ------------ | -------- | ----------------------------------------------------------------------------------------- |
| GET    | `/api/blobs/presign/upload`   | (none) | JwtAuthGuard | **BOTH** | Attempt blobs + presign: StudentCourseViewPage (student) and CourseBuilderPage (teacher). |
| GET    | `/api/blobs/presign/download` | (none) | JwtAuthGuard | **BOTH** | Attempt blobs + presign: StudentCourseViewPage (student) and CourseBuilderPage (teacher). |
| PUT    | `/api/blobs/:attemptId/:type` | (none) | JwtAuthGuard | **BOTH** | Attempt blobs + presign: StudentCourseViewPage (student) and CourseBuilderPage (teacher). |
| GET    | `/api/blobs/:attemptId/:type` | (none) | JwtAuthGuard | **BOTH** | Attempt blobs + presign: StudentCourseViewPage (student) and CourseBuilderPage (teacher). |
| DELETE | `/api/blobs/:attemptId/:type` | (none) | JwtAuthGuard | **BOTH** | Attempt blobs + presign: StudentCourseViewPage (student) and CourseBuilderPage (teacher). |

### ChatHistoryController (`chat-history/chat-history.controller.ts`)

| Method | Path                                | @Roles | Guards       | Door       | Note                          |
| ------ | ----------------------------------- | ------ | ------------ | ---------- | ----------------------------- |
| GET    | `/api/chat-history/me`              | (none) | JwtAuthGuard | **PUBLIC** | Student chat history (`/me`). |
| GET    | `/api/chat-history/me/:surface/:id` | (none) | JwtAuthGuard | **PUBLIC** | Student chat history (`/me`). |

### CodeDecompositionController (`code-decomposition/code-decomposition.controller.ts`)

| Method | Path                                                           | @Roles | Guards       | Door       | Note                           |
| ------ | -------------------------------------------------------------- | ------ | ------------ | ---------- | ------------------------------ |
| POST   | `/api/code-decomposition/generate`                             | (none) | JwtAuthGuard | **PUBLIC** | Student learning intervention. |
| GET    | `/api/code-decomposition/:sessionId`                           | (none) | JwtAuthGuard | **PUBLIC** | Student learning intervention. |
| POST   | `/api/code-decomposition/:sessionId/infer-tree`                | (none) | JwtAuthGuard | **PUBLIC** | Student learning intervention. |
| POST   | `/api/code-decomposition/:sessionId/check-tree`                | (none) | JwtAuthGuard | **PUBLIC** | Student learning intervention. |
| PATCH  | `/api/code-decomposition/:sessionId/nodes`                     | (none) | JwtAuthGuard | **PUBLIC** | Student learning intervention. |
| POST   | `/api/code-decomposition/:sessionId/nodes/:nodeId/hint`        | (none) | JwtAuthGuard | **PUBLIC** | Student learning intervention. |
| POST   | `/api/code-decomposition/:sessionId/nodes/:nodeId/reveal`      | (none) | JwtAuthGuard | **PUBLIC** | Student learning intervention. |
| POST   | `/api/code-decomposition/:sessionId/nodes/:nodeId/show-answer` | (none) | JwtAuthGuard | **PUBLIC** | Student learning intervention. |
| POST   | `/api/code-decomposition/:sessionId/reveal-solution`           | (none) | JwtAuthGuard | **PUBLIC** | Student learning intervention. |
| PATCH  | `/api/code-decomposition/:sessionId/adopt-solution`            | (none) | JwtAuthGuard | **PUBLIC** | Student learning intervention. |
| PATCH  | `/api/code-decomposition/:sessionId/advance-stage`             | (none) | JwtAuthGuard | **PUBLIC** | Student learning intervention. |
| POST   | `/api/code-decomposition/:sessionId/copy-to-comments`          | (none) | JwtAuthGuard | **PUBLIC** | Student learning intervention. |
| PATCH  | `/api/code-decomposition/:sessionId/code`                      | (none) | JwtAuthGuard | **PUBLIC** | Student learning intervention. |
| POST   | `/api/code-decomposition/:sessionId/check-match`               | (none) | JwtAuthGuard | **PUBLIC** | Student learning intervention. |
| POST   | `/api/code-decomposition/:sessionId/complete`                  | (none) | JwtAuthGuard | **PUBLIC** | Student learning intervention. |

### CourseStructureController (`course-structure/course-structure.controller.ts`)

| Method | Path                                                 | @Roles        | Guards                  | Door        | Note                            |
| ------ | ---------------------------------------------------- | ------------- | ----------------------- | ----------- | ------------------------------- |
| GET    | `/api/admin/courses/:courseId/structure-jobs`        | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/admin/courses/:courseId/structure-jobs/:jobId` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### CoursesController (`courses/courses.controller.ts`)

| Method | Path                                 | @Roles        | Guards                  | Door        | Note                                                                                    |
| ------ | ------------------------------------ | ------------- | ----------------------- | ----------- | --------------------------------------------------------------------------------------- |
| POST   | `/api/courses`                       | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                                         |
| GET    | `/api/courses`                       | (none)        | JwtAuthGuard,RolesGuard | **BOTH**    | Students read published courses; teachers read all. Mutations are @Roles teacher/admin. |
| GET    | `/api/courses/catalog`               | (none)        | JwtAuthGuard,RolesGuard | **BOTH**    | Students read published courses; teachers read all. Mutations are @Roles teacher/admin. |
| GET    | `/api/courses/:id`                   | (none)        | JwtAuthGuard,RolesGuard | **BOTH**    | Students read published courses; teachers read all. Mutations are @Roles teacher/admin. |
| PATCH  | `/api/courses/:id`                   | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                                         |
| POST   | `/api/courses/:id/duplicate`         | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                                         |
| POST   | `/api/courses/:id/publish`           | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                                         |
| POST   | `/api/courses/:id/unpublish`         | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                                         |
| DELETE | `/api/courses/:id`                   | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                                         |
| PATCH  | `/api/courses/:id/enrollment-policy` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                                         |
| GET    | `/api/courses/:id/dialogue-settings` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                                         |
| PUT    | `/api/courses/:id/dialogue-settings` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                                         |

### DialogueNotesController (`dialogue-notes/dialogue-notes.controller.ts`)

| Method | Path                                    | @Roles  | Guards                  | Door       | Note                      |
| ------ | --------------------------------------- | ------- | ----------------------- | ---------- | ------------------------- |
| POST   | `/api/dialogue-notes`                   | student | JwtAuthGuard,RolesGuard | **PUBLIC** | Explicit @Roles(student). |
| GET    | `/api/dialogue-notes`                   | student | JwtAuthGuard,RolesGuard | **PUBLIC** | Explicit @Roles(student). |
| PATCH  | `/api/dialogue-notes/:id`               | student | JwtAuthGuard,RolesGuard | **PUBLIC** | Explicit @Roles(student). |
| DELETE | `/api/dialogue-notes/:id`               | student | JwtAuthGuard,RolesGuard | **PUBLIC** | Explicit @Roles(student). |
| GET    | `/api/dialogue-notes/export/:sessionId` | student | JwtAuthGuard,RolesGuard | **PUBLIC** | Explicit @Roles(student). |

### DialogueController (`dialogue/dialogue.controller.ts`)

| Method | Path                                              | @Roles        | Guards                  | Door        | Note                            |
| ------ | ------------------------------------------------- | ------------- | ----------------------- | ----------- | ------------------------------- |
| GET    | `/api/dialogue/courses/:courseId/activity`        | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/dialogue/courses/:courseId/sessions`        | student       | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |
| GET    | `/api/dialogue/courses/:courseId/sessions`        | student       | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |
| GET    | `/api/dialogue/sessions/:sessionId`               | student       | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |
| PATCH  | `/api/dialogue/sessions/:sessionId`               | student       | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |
| DELETE | `/api/dialogue/sessions/:sessionId`               | student       | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |
| POST   | `/api/dialogue/sessions/:sessionId/messages`      | student       | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |
| GET    | `/api/dialogue/sessions/:sessionId/messages`      | student       | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |
| POST   | `/api/dialogue/courses/:courseId/studio`          | student       | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |
| GET    | `/api/dialogue/sessions/:sessionId/studio`        | student       | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |
| DELETE | `/api/dialogue/studio/:outputId`                  | student       | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |
| POST   | `/api/dialogue/sessions/:sessionId/interventions` | student       | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |
| GET    | `/api/dialogue/sessions/:sessionId/interventions` | student       | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |

### EnrollmentsController (`enrollments/enrollments.controller.ts`)

| Method | Path                                      | @Roles        | Guards                  | Door        | Note                            |
| ------ | ----------------------------------------- | ------------- | ----------------------- | ----------- | ------------------------------- |
| POST   | `/api/enrollments`                        | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/enrollments/self`                   | student       | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |
| POST   | `/api/enrollments/:courseId/drop`         | student       | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |
| GET    | `/api/enrollments`                        | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/enrollments/my`                     | student       | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |
| DELETE | `/api/enrollments/:id`                    | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/enrollments/:courseId/drop-student` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### EvaluationController (`evaluation/evaluation.controller.ts`)

| Method | Path                                            | @Roles        | Guards                  | Door        | Note                            |
| ------ | ----------------------------------------------- | ------------- | ----------------------- | ----------- | ------------------------------- |
| GET    | `/api/courses/:courseId/evaluation/tree`        | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/courses/:courseId/evaluation/run`         | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/courses/:courseId/evaluation/runs`        | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/courses/:courseId/evaluation/runs/:runId` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/courses/:courseId/evaluation/apply-fixes` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### SeedController (`grading/seed.controller.ts`)

| Method | Path            | @Roles | Guards | Door        | Note                                                                                                   |
| ------ | --------------- | ------ | ------ | ----------- | ------------------------------------------------------------------------------------------------------ |
| POST   | `/api/dev/seed` | (none) | (none) | **PRIVATE** | Dev-only (NODE_ENV=development gate, fails closed). [HUMAN DECISION] exclude from production entirely. |

### HealthController (`health.controller.ts`)

| Method | Path          | @Roles | Guards | Door        | Note                                                                                         |
| ------ | ------------- | ------ | ------ | ----------- | -------------------------------------------------------------------------------------------- |
| GET    | `/api/health` | (none) | (none) | **PRIVATE** | [HUMAN DECISION] recommend PRIVATE (or public-but-minimal) — frontend /health page calls it. |

### JobsController (`jobs/jobs.controller.ts`)

| Method | Path                              | @Roles        | Guards                  | Door        | Note                            |
| ------ | --------------------------------- | ------------- | ----------------------- | ----------- | ------------------------------- |
| POST   | `/api/jobs/export-session`        | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/jobs/export-session/status` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### LearningInterventionsController (`learning-interventions/learning-interventions.controller.ts`)

| Method | Path                                                                            | @Roles        | Guards                  | Door        | Note                                                                                                          |
| ------ | ------------------------------------------------------------------------------- | ------------- | ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/learning-interventions/prompt-config/:courseId`                           | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                                                               |
| GET    | `/api/learning-interventions/prompt-config/:courseId/:interventionType`         | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                                                               |
| PUT    | `/api/learning-interventions/prompt-config/:courseId/:interventionType`         | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                                                               |
| DELETE | `/api/learning-interventions/prompt-config/:courseId/:interventionType`         | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                                                               |
| PATCH  | `/api/learning-interventions/prompt-config/:courseId/PRACTICE_TESTING/defaults` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                                                               |
| POST   | `/api/learning-interventions/prompt-config/preview`                             | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                                                               |
| POST   | `/api/learning-interventions/practice-testing/generate`                         | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| POST   | `/api/learning-interventions/practice-testing/:interventionId/submit`           | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| GET    | `/api/learning-interventions/practice-testing/:interventionId`                  | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| POST   | `/api/learning-interventions/interrogative-elaboration/generate`                | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| POST   | `/api/learning-interventions/interrogative-elaboration/:sessionId/ask`          | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| POST   | `/api/learning-interventions/interrogative-elaboration/:sessionId/complete`     | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| GET    | `/api/learning-interventions/interrogative-elaboration/:sessionId`              | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| POST   | `/api/learning-interventions/stepwise-learning/course-check`                    | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| POST   | `/api/learning-interventions/stepwise-learning/generate-code-question`          | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| POST   | `/api/learning-interventions/stepwise-learning/generate`                        | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| POST   | `/api/learning-interventions/stepwise-learning/:sessionId/check`                | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| PATCH  | `/api/learning-interventions/stepwise-learning/:sessionId/advance`              | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| GET    | `/api/learning-interventions/stepwise-learning/:sessionId`                      | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| POST   | `/api/learning-interventions/stepwise-learning/:sessionId/complete`             | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| POST   | `/api/learning-interventions/distributed-practice/generate`                     | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| GET    | `/api/learning-interventions/distributed-practice/due`                          | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| PATCH  | `/api/learning-interventions/distributed-practice/cards/:cardId/review`         | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| GET    | `/api/learning-interventions/distributed-practice/stats`                        | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| GET    | `/api/learning-interventions/distributed-practice/cards/:cardId/preview`        | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| DELETE | `/api/learning-interventions/distributed-practice/cards/:cardId`                | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| POST   | `/api/learning-interventions/saved-reviews`                                     | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| GET    | `/api/learning-interventions/saved-reviews`                                     | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| GET    | `/api/learning-interventions/saved-reviews/:id`                                 | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| PATCH  | `/api/learning-interventions/saved-reviews/:id`                                 | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |
| DELETE | `/api/learning-interventions/saved-reviews/:id`                                 | (none)        | JwtAuthGuard            | **PUBLIC**  | Student-facing intervention/chatbot routes (prompt-config ones are @Roles teacher and classified separately). |

### LlmModelsController (`llm/llm-models.controller.ts`)

| Method | Path              | @Roles        | Guards                  | Door        | Note                            |
| ------ | ----------------- | ------------- | ----------------------- | ----------- | ------------------------------- |
| GET    | `/api/llm/models` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### LogsController (`logs/logs.controller.ts`)

| Method | Path                         | @Roles          | Guards                  | Door     | Note                    |
| ------ | ---------------------------- | --------------- | ----------------------- | -------- | ----------------------- |
| POST   | `/api/logs/cursor`           | student,teacher | JwtAuthGuard,RolesGuard | **BOTH** | Explicit shared @Roles. |
| POST   | `/api/logs/clicks`           | student,teacher | JwtAuthGuard,RolesGuard | **BOTH** | Explicit shared @Roles. |
| POST   | `/api/logs/scroll`           | student,teacher | JwtAuthGuard,RolesGuard | **BOTH** | Explicit shared @Roles. |
| POST   | `/api/logs/keystrokes`       | student,teacher | JwtAuthGuard,RolesGuard | **BOTH** | Explicit shared @Roles. |
| POST   | `/api/logs/visibility`       | student,teacher | JwtAuthGuard,RolesGuard | **BOTH** | Explicit shared @Roles. |
| POST   | `/api/logs/clipboard`        | student,teacher | JwtAuthGuard,RolesGuard | **BOTH** | Explicit shared @Roles. |
| POST   | `/api/logs/replay-snapshots` | student,teacher | JwtAuthGuard,RolesGuard | **BOTH** | Explicit shared @Roles. |
| POST   | `/api/logs/viewport`         | student,teacher | JwtAuthGuard,RolesGuard | **BOTH** | Explicit shared @Roles. |
| POST   | `/api/logs/performance`      | student,teacher | JwtAuthGuard,RolesGuard | **BOTH** | Explicit shared @Roles. |
| POST   | `/api/logs/errors`           | student,teacher | JwtAuthGuard,RolesGuard | **BOTH** | Explicit shared @Roles. |
| POST   | `/api/logs/sync-anchor`      | student,teacher | JwtAuthGuard,RolesGuard | **BOTH** | Explicit shared @Roles. |

### ItemsController (`modules/items.controller.ts`)

| Method | Path                                   | @Roles        | Guards                  | Door        | Note                            |
| ------ | -------------------------------------- | ------------- | ----------------------- | ----------- | ------------------------------- |
| POST   | `/api/modules/:moduleId/items`         | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| PATCH  | `/api/modules/:moduleId/items/:id`     | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| DELETE | `/api/modules/:moduleId/items/:id`     | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/modules/:moduleId/items/reorder` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### ItemActionsController (`modules/items.controller.ts`)

| Method | Path                                          | @Roles        | Guards                  | Door        | Note                                                                 |
| ------ | --------------------------------------------- | ------------- | ----------------------- | ----------- | -------------------------------------------------------------------- |
| POST   | `/api/items/:id/upload-url`                   | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                      |
| POST   | `/api/items/:id/upload-url/confirm`           | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                      |
| GET    | `/api/items/:id/download-url`                 | (none)        | JwtAuthGuard,RolesGuard | **BOTH**    | Course PDF presigned download — the student PDF path (★ MinIO flow). |
| GET    | `/api/items/:id/versions`                     | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                      |
| GET    | `/api/items/:id/versions/:versionId`          | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                      |
| POST   | `/api/items/:id/versions/:versionId/rollback` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                      |

### ModulesController (`modules/modules.controller.ts`)

| Method | Path                                     | @Roles        | Guards                  | Door        | Note                            |
| ------ | ---------------------------------------- | ------------- | ----------------------- | ----------- | ------------------------------- |
| POST   | `/api/courses/:courseId/modules`         | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| PATCH  | `/api/courses/:courseId/modules/:id`     | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| DELETE | `/api/courses/:courseId/modules/:id`     | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/courses/:courseId/modules/reorder` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### Openface3Controller (`openface3/openface3.controller.ts`)

| Method | Path                                               | @Roles        | Guards                  | Door        | Note                            |
| ------ | -------------------------------------------------- | ------------- | ----------------------- | ----------- | ------------------------------- |
| GET    | `/api/openface3/jobs/:id`                          | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/openface3/jobs`                              | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/openface3/jobs/stats`                        | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/openface3/jobs/:id/retry`                    | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/openface3/health`                            | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/openface3/dead-letter`                       | admin         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/openface3/dead-letter/:jobId/requeue`        | admin         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/openface3/frames`                            | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/openface3/frames/student/:studentId`         | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/openface3/frames/session/:sessionId/summary` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### PageContentController (`page-content/page-content.controller.ts`)

| Method | Path                                        | @Roles        | Guards                  | Door        | Note                            |
| ------ | ------------------------------------------- | ------------- | ----------------------- | ----------- | ------------------------------- |
| POST   | `/api/admin/ai/suggest-prompt`              | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/admin/pages/:pageId/generate-content` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### PreGenerationController (`pre-generation/pre-generation.controller.ts`)

| Method | Path                                             | @Roles                | Guards                  | Door        | Note                            |
| ------ | ------------------------------------------------ | --------------------- | ----------------------- | ----------- | ------------------------------- |
| GET    | `/api/pre-generation/config/:courseId`           | teacher,admin         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| PATCH  | `/api/pre-generation/config/:courseId`           | teacher,admin         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/pre-generation/match-document`             | teacher,admin,student | JwtAuthGuard,RolesGuard | **BOTH**    | Explicit shared @Roles.         |
| GET    | `/api/pre-generation/ready`                      | teacher,admin,student | JwtAuthGuard,RolesGuard | **BOTH**    | Explicit shared @Roles.         |
| GET    | `/api/pre-generation/status/:documentId`         | teacher,admin         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/pre-generation/exercises`                  | teacher,admin         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/pre-generation/cost/:courseId`             | teacher,admin         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/pre-generation/regenerate`                 | teacher,admin         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/pre-generation/module-items/list`          | teacher,admin         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/pre-generation/module-items/:itemId/queue` | teacher,admin         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### PupilSizeController (`pupil-size/pupil-size.controller.ts`)

| Method | Path                                                | @Roles          | Guards                  | Door        | Note                                                                                                              |
| ------ | --------------------------------------------------- | --------------- | ----------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/pupil-size/config/:courseId`                  | teacher,student | JwtAuthGuard,RolesGuard | **BOTH**    | Explicit shared @Roles.                                                                                           |
| PATCH  | `/api/pupil-size/config/:courseId`                  | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                                                                   |
| POST   | `/api/pupil-size/logs`                              | student         | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).                                                                                         |
| GET    | `/api/pupil-size/logs/:studentId/:courseId`         | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                                                                   |
| GET    | `/api/pupil-size/logs/:studentId/:sessionId/export` | (none)          | JwtAuthGuard,RolesGuard | **PRIVATE** | ★ BUG: no @Roles — any authenticated user can export any student's biometric CSV. Teacher-intent; fix in Phase 4. |

### PyfeatController (`pyfeat/pyfeat.controller.ts`)

| Method | Path                                    | @Roles          | Guards                  | Door        | Note                            |
| ------ | --------------------------------------- | --------------- | ----------------------- | ----------- | ------------------------------- |
| GET    | `/api/pyfeat/config/:courseId`          | teacher,student | JwtAuthGuard,RolesGuard | **BOTH**    | Explicit shared @Roles.         |
| PATCH  | `/api/pyfeat/config/:courseId`          | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/pyfeat/jobs`                      | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/pyfeat/jobs/:studentId/:courseId` | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/pyfeat/jobs/:jobId/results`       | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/pyfeat/jobs/:jobId/export`        | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/pyfeat/jobs/:jobId/retry`         | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### QuestionGenerationController (`question-generation/question-generation.controller.ts`)

| Method | Path                                                                | @Roles        | Guards                  | Door        | Note                            |
| ------ | ------------------------------------------------------------------- | ------------- | ----------------------- | ----------- | ------------------------------- |
| GET    | `/api/question-generation/jobs/:jobId`                              | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/question-generation/jobs`                                     | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| PATCH  | `/api/question-generation/jobs/:jobId/questions/:index/review`      | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/question-generation/jobs/:jobId/approve-all`                  | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/question-generation/jobs/:jobId/regenerate`                   | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/question-generation/grade-open-ended`                         | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/question-generation/feedback-config/:courseId`                | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/question-generation/feedback-config/:courseId/:feedbackLevel` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| PUT    | `/api/question-generation/feedback-config/:courseId/:feedbackLevel` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| DELETE | `/api/question-generation/feedback-config/:courseId/:feedbackLevel` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/question-generation/feedback-settings/:courseId`              | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| PUT    | `/api/question-generation/feedback-settings/:courseId`              | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### QuestionsController (`questions/questions.controller.ts`)

| Method | Path                              | @Roles        | Guards                  | Door        | Note                            |
| ------ | --------------------------------- | ------------- | ----------------------- | ----------- | ------------------------------- |
| POST   | `/api/questions`                  | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/questions`                  | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/questions/course/:courseId` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/questions/bulk-import`      | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/questions/bulk-status`      | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/questions/:id`              | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| PATCH  | `/api/questions/:id`              | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| DELETE | `/api/questions/:id`              | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/questions/:id/duplicate`    | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/questions/:id/archive`      | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### RagController (`rag/rag.controller.ts`)

| Method | Path                                  | @Roles        | Guards                  | Door        | Note                            |
| ------ | ------------------------------------- | ------------- | ----------------------- | ----------- | ------------------------------- |
| GET    | `/api/courses/:courseId/documents`    | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| DELETE | `/api/documents/:documentId`          | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/documents/:documentId/rechunk`  | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/courses/:courseId/rag/query`    | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/courses/:courseId/rag/generate` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/courses/:courseId/drafts`       | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/drafts/:draftId`                | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/drafts/:draftId/approve`        | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/drafts/:draftId/reject`         | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/courses/:courseId/llm-logs`     | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/llm-settings`                   | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/llm-settings`                   | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| DELETE | `/api/llm-settings`                   | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/llm-settings/cohere`            | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| DELETE | `/api/llm-settings/cohere`            | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### RecordingController (`recording/recording.controller.ts`)

| Method | Path                                           | @Roles          | Guards                  | Door        | Note                            |
| ------ | ---------------------------------------------- | --------------- | ----------------------- | ----------- | ------------------------------- |
| GET    | `/api/recording/config/:courseId`              | teacher,student | JwtAuthGuard,RolesGuard | **BOTH**    | Explicit shared @Roles.         |
| PATCH  | `/api/recording/config/:courseId`              | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/recording/segments/initiate`             | student         | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |
| PATCH  | `/api/recording/segments/:segmentId/complete`  | student         | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |
| PATCH  | `/api/recording/segments/:segmentId/fail`      | student         | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |
| GET    | `/api/recording/segments/:segmentId/download`  | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/recording/segments/:studentId/:courseId` | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/recording/consent/:courseId`             | student         | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |
| POST   | `/api/recording/consent/:courseId`             | student         | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).       |

### ReplayAnnotationsController (`replay-annotations/replay-annotations.controller.ts`)

| Method | Path                                | @Roles        | Guards                  | Door        | Note                            |
| ------ | ----------------------------------- | ------------- | ----------------------- | ----------- | ------------------------------- |
| GET    | `/api/replay-annotations/codes`     | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/replay-annotations/codes`     | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| PATCH  | `/api/replay-annotations/codes/:id` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| DELETE | `/api/replay-annotations/codes/:id` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/replay-annotations`           | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/replay-annotations`           | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| PATCH  | `/api/replay-annotations/:id`       | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| DELETE | `/api/replay-annotations/:id`       | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### StudentRagController (`student-rag/student-rag.controller.ts`)

| Method | Path                                                                        | @Roles  | Guards                  | Door       | Note                      |
| ------ | --------------------------------------------------------------------------- | ------- | ----------------------- | ---------- | ------------------------- |
| GET    | `/api/student-rag/courses/:courseId/documents`                              | student | JwtAuthGuard,RolesGuard | **PUBLIC** | Explicit @Roles(student). |
| GET    | `/api/student-rag/courses/:courseId/documents/:documentId`                  | student | JwtAuthGuard,RolesGuard | **PUBLIC** | Explicit @Roles(student). |
| PATCH  | `/api/student-rag/courses/:courseId/documents/:documentId/toggle`           | student | JwtAuthGuard,RolesGuard | **PUBLIC** | Explicit @Roles(student). |
| DELETE | `/api/student-rag/courses/:courseId/documents/:documentId`                  | student | JwtAuthGuard,RolesGuard | **PUBLIC** | Explicit @Roles(student). |
| DELETE | `/api/student-rag/documents/:documentId`                                    | student | JwtAuthGuard,RolesGuard | **PUBLIC** | Explicit @Roles(student). |
| POST   | `/api/student-rag/documents/:documentId/reprocess`                          | student | JwtAuthGuard,RolesGuard | **PUBLIC** | Explicit @Roles(student). |
| GET    | `/api/student-rag/documents/:documentId/guide`                              | student | JwtAuthGuard,RolesGuard | **PUBLIC** | Explicit @Roles(student). |
| POST   | `/api/student-rag/courses/:courseId/documents/:documentId/regenerate-guide` | student | JwtAuthGuard,RolesGuard | **PUBLIC** | Explicit @Roles(student). |
| GET    | `/api/student-rag/courses/:courseId/documents/importable`                   | student | JwtAuthGuard,RolesGuard | **PUBLIC** | Explicit @Roles(student). |
| POST   | `/api/student-rag/courses/:courseId/documents/import`                       | student | JwtAuthGuard,RolesGuard | **PUBLIC** | Explicit @Roles(student). |
| GET    | `/api/student-rag/documents/:documentId/presign`                            | student | JwtAuthGuard,RolesGuard | **PUBLIC** | Explicit @Roles(student). |

### TextMiningController (`text-mining/text-mining.controller.ts`)

| Method | Path                                                                         | @Roles        | Guards                  | Door        | Note                            |
| ------ | ---------------------------------------------------------------------------- | ------------- | ----------------------- | ----------- | ------------------------------- |
| GET    | `/api/text-mining/constructs`                                                | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/text-mining/sessions/:sessionId/dashboard`                             | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/text-mining/activity-sessions/:activitySessionId/dashboard`            | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/text-mining/sessions/:sessionId/detections`                            | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/text-mining/activity-sessions/:activitySessionId/detections`           | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/text-mining/sessions/:sessionId/detections.csv`                        | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/text-mining/activity-sessions/:activitySessionId/detections.csv`       | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/text-mining/students/:studentId/dashboard`                             | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/text-mining/courses/:courseId/prompts`                                 | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| PUT    | `/api/text-mining/courses/:courseId/prompts`                                 | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/text-mining/courses/:courseId/prompts/reset`                           | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/text-mining/courses/:courseId/prompts/:constructKey/versions/:version` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/text-mining/prompts/try`                                               | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/text-mining/teacher-settings`                                          | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| PUT    | `/api/text-mining/teacher-settings`                                          | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/text-mining/sessions/:sessionId/reprocess`                             | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### TopicsController (`topics/topics.controller.ts`)

| Method | Path              | @Roles        | Guards                  | Door        | Note                                                        |
| ------ | ----------------- | ------------- | ----------------------- | ----------- | ----------------------------------------------------------- |
| POST   | `/api/topics`     | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                             |
| GET    | `/api/topics`     | (none)        | JwtAuthGuard,RolesGuard | **BOTH**    | Read-only; used by student course view and teacher builder. |
| GET    | `/api/topics/:id` | (none)        | JwtAuthGuard,RolesGuard | **BOTH**    | Read-only; used by student course view and teacher builder. |
| PATCH  | `/api/topics/:id` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                             |
| DELETE | `/api/topics/:id` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                             |

### UserManagementController (`user-management/user-management.controller.ts`)

| Method | Path                                                         | @Roles        | Guards                  | Door        | Note                            |
| ------ | ------------------------------------------------------------ | ------------- | ----------------------- | ----------- | ------------------------------- |
| GET    | `/api/user-management/students`                              | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/user-management/students/export`                       | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/user-management/account-review/export`                 | admin         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/user-management/students/:studentId`                   | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/user-management/students`                              | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/user-management/students/bulk`                         | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/user-management/students/:studentId/resend-invitation` | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/user-management/users/:userId/reset-password`          | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/user-management/users/:userId/deactivate`              | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/user-management/users/:userId/reactivate`              | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| POST   | `/api/user-management/enrollments/bulk`                      | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/user-management/my-usage`                              | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/user-management/courses-overview`                      | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/user-management/usage-summary`                         | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| GET    | `/api/user-management/pricing`                               | teacher,admin | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| PUT    | `/api/user-management/pricing/:id`                           | admin         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### VlmController (`vlm/vlm.controller.ts`)

| Method | Path                               | @Roles                | Guards                  | Door        | Note                            |
| ------ | ---------------------------------- | --------------------- | ----------------------- | ----------- | ------------------------------- |
| POST   | `/api/vlm/describe-page`           | student,teacher,admin | JwtAuthGuard,RolesGuard | **BOTH**    | Explicit shared @Roles.         |
| GET    | `/api/vlm/config/course/:courseId` | student,teacher,admin | JwtAuthGuard,RolesGuard | **BOTH**    | Explicit shared @Roles.         |
| GET    | `/api/vlm/config`                  | teacher,admin         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |
| PATCH  | `/api/vlm/config`                  | teacher,admin         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin). |

### WebgazerController (`webgazer/webgazer.controller.ts`)

| Method | Path                                              | @Roles          | Guards                  | Door        | Note                                                                                                              |
| ------ | ------------------------------------------------- | --------------- | ----------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/webgazer/config/:courseId`                  | teacher,student | JwtAuthGuard,RolesGuard | **BOTH**    | Explicit shared @Roles.                                                                                           |
| PATCH  | `/api/webgazer/config/:courseId`                  | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                                                                   |
| POST   | `/api/webgazer/logs`                              | student         | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).                                                                                         |
| POST   | `/api/webgazer/calibration`                       | student         | JwtAuthGuard,RolesGuard | **PUBLIC**  | Explicit @Roles(student).                                                                                         |
| GET    | `/api/webgazer/logs/:studentId/:courseId`         | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                                                                   |
| GET    | `/api/webgazer/logs/:studentId/:sessionId/export` | (none)          | JwtAuthGuard,RolesGuard | **PRIVATE** | ★ BUG: no @Roles — any authenticated user can export any student's biometric CSV. Teacher-intent; fix in Phase 4. |
| GET    | `/api/webgazer/calibration/:studentId/:courseId`  | teacher         | JwtAuthGuard,RolesGuard | **PRIVATE** | Explicit @Roles(teacher/admin).                                                                                   |
