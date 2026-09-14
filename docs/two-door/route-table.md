# Two-Door — Frontend Route Table (Phase 0 artifact 1 of 3)

**Source of truth:** `apps/web/src/App.tsx` (lines 90–358), read directly on branch `splitting_builds` at `ca30e33`. There are **no nested route files** — a repo-wide search for `<Route`, `useRoutes(`, and `createBrowserRouter` outside `App.tsx` returned nothing. This table therefore IS the complete route surface.

**Status:** READ-ONLY discovery. Nothing has been changed. Human review required before Phase 1.

## Route table

Every registered route. "Wrapper" is what sits between the router and the page. `RoleRoute` is the client-side role check; `BiometricsWrapper` is the sensing spine (webcam/gaze/pupil capture).

| #   | Path                                                  | Page component                                     | Audience             | Wrapper(s)                                                  | Notes                                                                                                        |
| --- | ----------------------------------------------------- | -------------------------------------------------- | -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | `/login`                                              | `pages/Login`                                      | **auth**             | none                                                        | Both doors need this. Links to `/register` (line 252).                                                       |
| 2   | `/register`                                           | `pages/Register`                                   | **auth**             | none                                                        | Public self-registration (student/teacher role picker). **[HUMAN DECISION]** — see §Decisions.               |
| 3   | `/terms`                                              | `pages/Terms`                                      | **auth/shared**      | none                                                        | Data-collection notice linked from registration. Both doors.                                                 |
| 4   | `/change-password`                                    | `pages/ChangePasswordPage`                         | **shared**           | `ProtectedRoute`                                            | Forced-change target (item 5). Both doors. Deliberately outside `Layout`.                                    |
| 5   | `/health`                                             | `pages/Health`                                     | **shared (dev/ops)** | none                                                        | Renders `GET /api/health` JSON. **[HUMAN DECISION]** whether the public door serves it.                      |
| 6   | `/account/security`                                   | `pages/AccountSecurityPage`                        | **shared**           | `ProtectedRoute` → `AuthenticatedLoggingWrapper` → `Layout` | Any authenticated role. MFA + change-password link.                                                          |
| 7   | `/teacher`                                            | `pages/teacher/TeacherDashboard`                   | **teacher**          | + `RoleRoute(teacher,admin)`                                |                                                                                                              |
| 8   | `/teacher/courses`                                    | `pages/teacher/CoursesPage`                        | **teacher**          | + `RoleRoute(teacher,admin)`                                |                                                                                                              |
| 9   | `/teacher/courses/:courseId`                          | `pages/teacher/CourseBuilderPage`                  | **teacher**          | + `RoleRoute(teacher,admin)`                                |                                                                                                              |
| 10  | `/teacher/studio/:courseId`                           | `pages/teacher/CourseStudioPage`                   | **teacher**          | + `RoleRoute(teacher,admin)`                                |                                                                                                              |
| 11  | `/teacher/courses/:courseId/prompts`                  | `pages/teacher/PromptSettingsPage`                 | **teacher**          | + `RoleRoute(teacher,admin)`                                |                                                                                                              |
| 12  | `/teacher/courses/:courseId/generate-questions`       | `pages/teacher/QuestionGenerationPage`             | **teacher**          | + `RoleRoute(teacher,admin)`                                |                                                                                                              |
| 13  | `/teacher/ai-settings`                                | `pages/teacher/AiSettingsPage`                     | **teacher**          | + `RoleRoute(teacher,admin)`                                |                                                                                                              |
| 14  | `/teacher/questions`                                  | `pages/teacher/QuestionsPage`                      | **teacher**          | + `RoleRoute(teacher,admin)`                                |                                                                                                              |
| 15  | `/teacher/assessments`                                | `pages/teacher/AssessmentsPage`                    | **teacher**          | + `RoleRoute(teacher,admin)`                                |                                                                                                              |
| 16  | `/teacher/review`                                     | `pages/teacher/ReviewPage`                         | **teacher**          | + `RoleRoute(teacher,admin)`                                |                                                                                                              |
| 17  | `/teacher/attempt/:attemptId`                         | `pages/teacher/AttemptDetailPage`                  | **teacher**          | + `RoleRoute(teacher,admin)`                                |                                                                                                              |
| 18  | `/teacher/user-management`                            | `pages/teacher/UserManagementPage`                 | **teacher**          | + `RoleRoute(teacher,admin)`                                | Includes the admin-only account-review export button (role-gated in-page).                                   |
| 19  | `/teacher/users/bulk`                                 | `pages/teacher/BulkUserProvisioningPage`           | **teacher**          | + `RoleRoute(teacher,admin)`                                |                                                                                                              |
| 20  | `/teacher/students/:studentId/logs`                   | `pages/teacher/student-logs/StudentLogPage`        | **teacher**          | + `RoleRoute(teacher,admin)`                                | Student Logs hub incl. Replay tab.                                                                           |
| 21  | `/teacher/students/:studentId/text-mining`            | `features/text-mining/pages/StudentTextMiningPage` | **teacher**          | + `RoleRoute(teacher,admin)`                                | Lives under `features/`, not `pages/teacher/`.                                                               |
| 22  | **`/dashboard/sessions/:sessionId/timeline`**         | `pages/dashboard/SessionTimelinePage`              | **teacher**          | + `RoleRoute(teacher,admin)`                                | ★ **The spec's known trap, confirmed**: a teacher surface **outside `/teacher`**. It is the only such route. |
| 23  | `/student`                                            | `pages/student/StudentDashboard`                   | **student**          | + `RoleRoute(student)`                                      |                                                                                                              |
| 24  | `/student/assessments`                                | `pages/student/StudentAssessmentsPage`             | **student**          | + `RoleRoute(student)`                                      |                                                                                                              |
| 25  | `/student/results`                                    | `pages/student/StudentResultsPage`                 | **student**          | + `RoleRoute(student)`                                      |                                                                                                              |
| 26  | `/student/attempt/:attemptId`                         | `pages/student/AttemptPage`                        | **student**          | + `RoleRoute(student)` + **`BiometricsWrapper`**            | Sensing ON.                                                                                                  |
| 27  | `/student/courses/:courseId/assessment/:assessmentId` | `pages/student/AssessmentAttemptPage`              | **student**          | + `RoleRoute(student)` + **`BiometricsWrapper`**            | Sensing ON.                                                                                                  |
| 28  | `/student/catalog`                                    | `pages/student/CatalogPage`                        | **student**          | + `RoleRoute(student)`                                      |                                                                                                              |
| 29  | `/student/courses`                                    | `pages/student/MyCoursesPage`                      | **student**          | + `RoleRoute(student)`                                      |                                                                                                              |
| 30  | `/student/courses/:courseId`                          | `pages/student/StudentCourseViewPage`              | **student**          | + `RoleRoute(student)` + **`BiometricsWrapper`**            | Sensing ON. Course content + PDFs (★ MinIO `/s3/` download path).                                            |
| 31  | `/student/review-queue`                               | `pages/student/ReviewQueuePage`                    | **student**          | + `RoleRoute(student)`                                      |                                                                                                              |
| 32  | `/student/courses/:courseId/dialogue`                 | `pages/student/DialogueLearning`                   | **student**          | + `RoleRoute(student)` + **`BiometricsWrapper`**            | Sensing ON. Opens the `/dialogue` Socket.IO namespace.                                                       |
| 33  | `/student/courses/:courseId/dialogue/sessions`        | `pages/student/DialogueSessionHistory`             | **student**          | + `RoleRoute(student)`                                      |                                                                                                              |
| 34  | `/student/chat-history`                               | `pages/student/ChatHistoryPage`                    | **student**          | + `RoleRoute(student)`                                      |                                                                                                              |
| 35  | `/`                                                   | `<Navigate to="/login">`                           | —                    |                                                             |                                                                                                              |
| 36  | `*`                                                   | `<Navigate to="/login">`                           | —                    |                                                             | Catch-all. See the redirect-loop trap below.                                                                 |

**Totals:** 16 teacher routes (15 under `/teacher/*` + 1 under `/dashboard/*`), 12 student routes (4 with sensing), 6 auth/shared routes, 2 redirects.

## Sensing spine — what must move to the student entry untouched

Wired from `App.tsx` (not from pages), so it is invisible to a page-level import graph and must be carried over explicitly in Phase 2:

- `AuthenticatedLoggingWrapper` (`App.tsx:59–83`): for students it first renders `PermissionGate` until `PERMISSION_SESSION_KEY` is set in `sessionStorage`, then wraps `Layout` in `LoggingProvider` with the activity-log `sessionId`.
- **captureDom flag — discrepancy with the spec/plan.** `App.tsx:78` currently reads `captureDom={true}`, with the comment at lines 71–77 saying it is _"temporarily ON again — re-testing after lowering PDF_CANVAS_JPEG_QUALITY/… Flip back to `false` once this comparison is done — off by default for the 2026-06-13 study."_ The spec and plan both assert it is OFF. **The code says ON.** Phase 2 will preserve the value exactly as found (`true`) and not touch the comment. **[HUMAN DECISION]** which value should ship for the study — not something the split should silently decide.
- `BiometricsWrapper` (`components/student/BiometricsWrapper.tsx`) mounts on routes 26, 27, 30, 32 above and pulls in: `contexts/BiometricsSyncContext`, `lib/recording/useWebcamRecording`, `lib/pupil-size/usePupilSize`, `lib/webgazer/useEyeTracking` + `CalibrationModal`, `components/student/{BiometricsActiveBanner,BiometricsPanel,WebcamPreviewWindow}`.
- `lib/activity-log` (`ActivityLogProvider`, `usePageViewTracker`) wraps the whole app and is used by `Layout` for both roles — **shared**, stays in the common root.

## Shared chrome and the one real leak vector

`Layout`, `Header`, `Sidebar` are shared by both roles and import **no page components**. The only teacher-specific content in them is `Sidebar.tsx`'s `teacherNavItems` array (lines 11–131): eight literal `/teacher/...` path strings. Left as-is, those strings would appear in the student bundle and trip the Phase 5 bundle-leak grep. **Phase 2 must split the nav arrays per entry** (or inject them). `Header` links only to `/account/security` (shared). `Layout` shows the student exit-survey / logout gate only when `user.role === 'student'` (line 24, 73) — role-conditional rendering, not an import; fine to keep shared.

## Import-graph result (entanglement)

Computed from the real import statements (transitive closure from every `pages/student/*` vs every `pages/teacher/*` + `pages/dashboard/*` + `features/text-mining/pages/*` seed), script kept in the session scratchpad and reproducible:

- **Direct cross-audience page imports: 0.**
- **Transitive crossings: 2**, both benign — student pages reach `components/editor/BlockRenderer.tsx` and `components/editor/block-types.ts` (the read-only renderer for teacher-authored content). The TipTap editor proper (`BlockEditor`, `RichTextEditor`, `blocks/*`, `latex-extensions`) is teacher-only as expected. **Phase 1's boundary rule must whitelist those two files as shared** (or Phase 2 moves them out of `components/editor/`).
- **Teacher closure reaching student pages: 0.**

Verified audience of shared dirs (counts are files reachable):

| Dir                                                                                                       | Student-only | Teacher-only | Both             |
| --------------------------------------------------------------------------------------------------------- | ------------ | ------------ | ---------------- |
| `components/FloatingChatbot`                                                                              | 10           | 0            | 0                |
| `components/dialogue`                                                                                     | 10           | 0            | 0                |
| `components/code-practice`                                                                                | 4            | 0            | 3                |
| `components/editor`                                                                                       | 0            | 11           | 2 (the renderer) |
| `components/teacher` (incl. `biometrics/` settings & log viewers)                                         | 0            | 13           | 0                |
| `components/dashboard`                                                                                    | 0            | 2            | 0                |
| `features/openface3`                                                                                      | 0            | 3            | 0                |
| `features/text-mining`                                                                                    | 0            | 6            | 0                |
| `contexts/PageContext`                                                                                    | 1            | 0            | 0                |
| `contexts/AuthContext`, `lib/api`, `lib/socket`, `lib/activity-log`, `lib/biometrics`, `components/Toast` | —            | —            | shared           |
| `lib/llm/useLlmModels`                                                                                    | 0            | 1            | 0                |
| `lib/pyodideRunner`, `components/{PdfReader,MDXRenderer,MathText,ChatMessageContent}`                     | student      | —            | —                |

The spec's "expected" lists were broadly right; corrections: `PageContext` is student-only (not shared); `lib/biometrics` is reached by teachers only via `AuthContext`'s logout cleanup (harmless); `FloatingChatbot.tsx` itself was deleted last session — the directory survives via `DockedChatbot`/`ChatbotPanel`.

## The redirect-loop trap (Phase 2 must fix)

Confirmed in code, exactly as the spec's [VERIFY] feared:

- `pages/Login.tsx:38–40` — on any logged-in user: `navigate(user.role === 'student' ? '/student' : '/teacher')`.
- `components/RoleRoute.tsx:15–22` — role mismatch → `<Navigate to="/teacher">` or `/student`; no user → `/login`.

In a student-only build with no `/teacher` route, a teacher logging in on the public door would loop: `/teacher` → catch-all `*` → `/login` → user present → `/teacher` → … The fix is a per-entry "wrong door" screen. **[HUMAN DECISION]** on wording; proposed default: _"This sign-in is for students. Staff should use the staff portal."_ with a sign-out button, no automatic redirect to the other door (its hostname must not be embedded in the student bundle).

## Decisions this table surfaces

1. **Registration on the public door** — `/register` is linked from `/login` and the API route is unguarded. Accounts are otherwise teacher-provisioned. Keep, hide, or remove on the student door? (Spec §4.2; do not remove unprompted.)
2. **`/health` on the public door** — page + `GET /api/health`. Recommend private.
3. **captureDom** — currently `true` in code vs "OFF for the study" in the documents. Which ships?
4. **Wrong-door wording** — proposed default above.
5. **Admin build includes student surface?** — default per spec is admin-only. Note that no "preview as student" feature exists in the code today (no teacher page imports a student page), so nothing breaks either way.

## Phase 2 outcome (implemented)

Decisions taken: `/register` and `/health` are admin-door only; wrong-door wording is the proposed default (sign-out only, no other-door link); captureDom left exactly as the code had it (`true`, comment intact) — the teacher-portal toggle is a separate, later phase; the admin build carries **both** route trees so staff can use the student surface from the private hostname (and `vite` dev is unchanged).

Where things live now:

| Concern                                                          | File                                                                                                                                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Door constant (`__GALS_DOOR__` via Vite `define`)                | `apps/web/src/door.ts`, `vite-env.d.ts`, `vite.config.shared.ts`                                                                                                 |
| Provider stack (Router › ActivityLog › Auth › Toast › NavConfig) | `src/app/AppShell.tsx`                                                                                                                                           |
| Sensing spine (moved verbatim from `App.tsx`)                    | `src/app/AuthenticatedLoggingWrapper.tsx`                                                                                                                        |
| Route modules                                                    | `src/routes/{authRoutes,adminOnlyRoutes,shell,studentRoutes,teacherRoutes}.tsx`                                                                                  |
| Per-door nav + home paths (replaces `Sidebar.tsx` inline arrays) | `src/nav/{NavConfigContext,studentNav,teacherNav}.tsx`                                                                                                           |
| Wrong-door screen                                                | `src/pages/WrongDoorPage.tsx` at `/wrong-door`                                                                                                                   |
| Apps / entries / HTML                                            | `src/app/{StudentApp,AdminApp}.tsx`, `src/entry-{student,admin}.tsx`, `index.html` (admin), `student.html` (student)                                             |
| Builds                                                           | `vite.config.ts` (admin → `dist`, dev default), `vite.config.admin.ts` (`dist-admin`), `vite.config.student.ts` (`dist-student`, output renamed to `index.html`) |

Redirect-loop fix: `Login.tsx` and `RoleRoute.tsx` now use `useHomePath(role) ?? WRONG_DOOR_PATH` — a role the door doesn't serve goes to `/wrong-door`, never to a route the bundle lacks. No teacher path literal remains outside `nav/teacherNav.tsx` and `routes/teacherRoutes.tsx`.

Same-origin sockets: `lib/socket.ts#getSocketOrigin()` — `VITE_API_URL`, else `localhost:3000` in dev, else `window.location.origin` (nginx proxies `/socket.io`). `DialogueLearning.tsx` uses the same helper.

Bundle check on `dist-student` (2026-09-14): zero hits for `/teacher`, `/dashboard/sessions`, `/register`, `auth/register`, `/health`, `user-management`, `ai-settings`, `text-mining`, `openface`, `/api/jobs`, `/api/users`, `/api/security-events`. Only the wrong-door copy and `/wrong-door` itself are present. `AuthContext.register` moved into `pages/Register.tsx` to achieve the `auth/register` zero. Boundary rule now seeds from `src/entry-student.tsx`; `editor-styles.css` joined the renderer exception because `BlockRenderer` uses the `.tiptap` class.
