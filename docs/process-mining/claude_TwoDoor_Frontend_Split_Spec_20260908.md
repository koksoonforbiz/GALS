# GALS Two-Door Split — Implementation Specification for the Repository Agent

**Date:** 2026-09-08
**Audience:** the Claude session working directly on the GALS monorepo
**Status:** Specification. Contains VERIFIED facts (with sources), UNVERIFIED items the implementer MUST check against the code before acting, and DECISIONS RESERVED for humans.

---

## 0. Epistemic ground rules (read first)

This document was written **without access to the repository**. Its factual basis is two internal documents:

- `01_functionality_inventory.md` (2026-07-08) — states it was "read directly from the source on branch `claude/capstone-evidence-pack-h737h5` (based on `origin/KianYu`, 93 commits ahead of `milestone-1-monorepo`)".
- `Platform Archiecture_20260531` (2026-05-31) — tech-architecture doc.

Both are **at least two months old**. The repo may have moved. Therefore:

1. **The code wins over this document, always.** Every file path, line number, route, and module name below must be re-verified against the current working branch before it is acted on.
2. Items tagged **[VERIFY]** are known unknowns: do not implement around them until you have looked.
3. Items tagged **[HUMAN DECISION]** must be surfaced to Kok Soon / the team, not decided by you.
4. Do not invent routes, modules, or config values that you cannot find in the code. If something referenced here does not exist in the repo, flag it back rather than creating it.

---

## 1. Objective

Split GALS delivery into two "doors" served by one host:

- **Door 1 (public, student):** internet-facing virtual host serving a **student-only frontend bundle** and a **default-deny allowlist** of student-required API routes.
- **Door 2 (private, teacher/admin):** virtual host bound to an SMU-intranet interface (reachable only via SMU VPN / campus network) serving the **full teacher/admin frontend** and the full API proxy.

**Invariants that must not change:**

- One NestJS API deployment, one PostgreSQL database, one Redis, one MinIO, unchanged Prisma schema. **No database migration is part of this work.**
- All existing application-layer auth (JWT Bearer, role guards, 2FA) stays exactly as is. The network split is an _additional_ layer, never a replacement.
- No behavior change for the sensing/logging pipeline (activity-log, replay snapshots, webgazer, pupil, recording) beyond routing.
- Backend containers remain unpublished on the private Docker network (per current compose layout — [VERIFY] current `docker-compose.yml` port mappings).

---

## 2. Verified current state (with sources)

Facts below are from the two documents named in §0. Re-verify each against the current branch; the ones most load-bearing for this work are marked ★.

**Repo layout** (Platform Architecture doc): monorepo with `apps/api` (NestJS + Prisma), `apps/web` (React 18 + Vite + TypeScript + Tailwind, React Router v6), `apps/pyfeat-worker`, `apps/openface3-worker`, `apps/worker`. Dev orchestration via `docker-compose.yml`: postgres 5432, redis 6379, minio 9000/9001, api 3000, web 5173 (Vite dev server, self-signed HTTPS).

**★ Single frontend app:** routes for both audiences are registered in one router at `apps/web/src/App.tsx` (functionality inventory cites `App.tsx` for routes and `App.tsx:70-77` for the captureDom flag). Pages are already partly segregated on disk: `apps/web/src/pages/student/` and `apps/web/src/pages/teacher/` exist. `components/`, `lib/`, `contexts/` (AuthContext, PageContext) are shared/mixed.

**★ Teacher UI routes are NOT all under `/teacher`:** the inventory lists Session Timeline at **`/dashboard/sessions/:sessionId/timeline`** — a teacher surface outside the `/teacher` prefix. Any path-prefix-based assumption ("everything teacher is under /teacher") is therefore **wrong** as of the inventory date. There may be others; enumerate the real route table from the current `App.tsx`.

**★ Auth:** JWT Bearer tokens stored in `localStorage`, sent as `Authorization: Bearer <token>`; backend role guards distinguish teacher/student/admin. The `auth` module includes a **register** endpoint (bcrypt register) alongside login; accounts are also provisioned by teachers via `user-management` (crypto temp passwords, bulk-enroll).

**★ Socket.IO:** three realtime surfaces are documented — the **dialogue** WS gateway (student dialogue mode), the **grading** module's `GradingGateway` which pushes grade completion **to students** (`student:<id>` rooms, fed by a 2s `GradeCompletedPoller`), and a **text-mining** WS used for teacher dashboards. Note carefully: **grading WS is student-facing** (students receive grades live), text-mining WS is teacher-facing. Do not classify "grading" as teacher-only.

**★ Webcam upload path:** the `recording` module uses **presigned MinIO uploads per segment** ("presigned MinIO upload per segment, lifecycle verification"). If the student browser PUTs segments directly against a presigned MinIO URL, then MinIO itself (or an nginx proxy path to it) must be reachable through the public door, and the presigned URL's host/port must be the public hostname. This is a **top-priority [VERIFY]** — it can silently break all webcam capture for the 2026 study if the public door only proxies the NestJS API.

**★ API surface:** 46 module directories in `apps/api/src` (inventory §1–§5 lists them with base routes). Teacher LLM/admin routes exist under prefixes like `admin/courses/:courseId/...` (course-structure, page-content) but most teacher modules sit at bare prefixes (`courses`, `questions`, `assessments`, `user-management`, `analytics`, …) — i.e., **the API has no uniform student/admin path prefix**. Classification must be done per (method, path), not per prefix. See §5.

**Known security-relevant endpoints** (inventory §5/§7): `jobs` controller string-interpolates `sessionId` into a shell command (`jobs.controller.ts:18`, flagged command-injection risk); the `grading` module hosts a dev `SeedController`; `GET /health` probes exist. All three matter for the allowlist (§5) — none of these may be exposed on the public door ([VERIFY] whether SeedController is compiled in production builds at all).

**captureDom** is deliberately OFF for the 2026 study (`App.tsx:70-77` per inventory). The split must not disturb this flag or the screenshot-driven replay path.

**[VERIFY] How the web client addresses the API:** in dev, web (5173) and api (3000) are different origins, so there is presumably an API base-URL env (`VITE_...`) and a CORS config in NestJS. Find them. In production under Two-Door, both doors should call the API **same-origin via relative paths** (each vhost proxies `/api` and the WS path), which eliminates CORS for both doors. If the client currently hardcodes or env-injects an absolute API origin, that must become relative or per-build.

---

## 3. Target end state (the "results")

When this work is complete:

- `apps/web` produces **two build outputs**: a student bundle (deployed behind Door 1) and an admin/teacher bundle (deployed behind Door 2). One codebase, shared component library, two entry points.
- The **student build output contains no admin code**: no admin route components, no admin page chunks, no admin-only API path strings, no teacher Socket.IO client wiring. Verified mechanically (see §7), not by inspection.
- The **admin build** contains the full teacher/admin surface (everything under `/teacher/*` plus `/dashboard/...` and any other teacher routes found in the real route table). Whether the admin build also includes the student surface (so teachers can preview the student experience) is a **[HUMAN DECISION]** — default to _admin-only_ unless told otherwise, and note that teacher "preview as student" workflows, if any exist, would break.
- A written **route classification** (per method+path, including WS) exists in the repo, from which the nginx allowlist is generated — the classification is the artifact, nginx config is derived from it.
- Nginx serves door 1 from the student dist with the default-deny allowlist, door 2 from the admin dist with full proxy. (The nginx/interface work itself is gated on SCIS/IITS confirmations — the repo work is to _produce_ the two dists, the classification, and config templates.)
- Optional hardening (recommended, small): each nginx block sets a trusted door header; a NestJS guard denies admin-classified routes when the request arrived via the public door. See §6.
- CI builds both targets and runs the leak checks (§7) on every change.

---

## 4. Frontend changes (`apps/web`)

### 4.1 Discovery first (do these before editing anything)

1. Enumerate the **complete current route table** from `App.tsx` (and any nested route files). Output it as a table: path → page component → audience (student / teacher / shared / auth). The inventory's route lists (§1.2 and §2.2 there) are your cross-check, not your source.
2. Map the **import graph**: which of `components/`, `lib/`, `contexts/` are imported by student pages, teacher pages, or both. Expect these to be shared: `AuthContext`, `PageContext`, `PdfReader`, design-system components. Expect these to be student-only: `BiometricsWrapper`, `PermissionGate`, `RecordingConsentModal`, `WebcamPreviewWindow`, `PupilSizeOverlay`, `WebgazerStatusBadge`, `PyfeatStatusBadge`, `BiometricsActiveBanner`, `FloatingChatbot`, `components/dialogue/`, `lib/interaction-log`, `lib/webgazer`, `lib/pupil-size`, `lib/activity-log`. Expect teacher-only: `components/editor/` (TipTap), `pages/teacher/student-logs/` (incl. `ReplayTab.tsx`, `lib/aoiScoring.ts`, `lib/exportReplayCsv.ts`), `features/openface3/`, `features/text-mining/`. **Verify each — do not trust this expectation list.**
3. Find every place the API origin / Socket.IO URL is configured (env vars, `io(...)` calls, axios/fetch base). List them.

### 4.2 Restructure

- Introduce two entry points (e.g. `src/entry-student.tsx` and `src/entry-admin.tsx`, names at implementer's discretion) each mounting its own router: the student router registers only student+auth routes; the admin router only teacher/admin+auth routes. The existing `App.tsx` route registrations are split accordingly. Keep shared providers (AuthContext, theme, query client, PageContext if both sides use it — check) in a shared root component both entries reuse.
- Keep `pages/student/` and `pages/teacher/` where they are; the split is enforced at the entry/router level plus an **import boundary rule**: nothing reachable from the student entry may import from `pages/teacher/` or teacher-only feature dirs (and vice versa is a warning, not necessarily an error, depending on the [HUMAN DECISION] above). Enforce with dependency-cruiser or an ESLint no-restricted-imports config committed to the repo.
- **Login:** both doors need a login screen (students log in publicly; teachers on the intranet host). The two hostnames are different origins, so `localStorage` JWTs are naturally separate per door — no shared-session work needed. [VERIFY] whether the login page or AuthContext has role-based post-login redirects that assume both route trees exist (e.g. redirecting a teacher to `/teacher` — in the student build that route won't exist; decide the UX: show "use the staff portal" message rather than a broken redirect. Exact wording/behavior is a [HUMAN DECISION], propose a default).
- **Registration:** [VERIFY] whether the register flow is exposed in the student UI and whether the study wants open self-registration on the public door at all (accounts are teacher-provisioned per user-management). Surface as [HUMAN DECISION]; do not remove functionality unprompted.

### 4.3 Build config

- Two Vite build commands producing separate outDirs (e.g. `dist-student/`, `dist-admin/`). Mechanism (two config files, `--mode` + conditional input, or env-switched single config) is implementer's choice, with one hard constraint: **tree isolation must hold at the bundle level.** Static imports from a shared root can drag admin code into student chunks even when routes are removed; use per-entry builds (not one build with two HTML inputs sharing chunks) or verify chunk contents explicitly (§7).
- API and Socket.IO addressing: relative/same-origin in production builds for both targets (each vhost proxies the API). Preserve whatever dev-mode setup exists (5173→3000) — do not break local development.
- The captureDom flag and all sensing initialization live with the student entry; confirm nothing sensing-related is lost in the move (`BiometricsWrapper` mounts on attempt/course/dialogue routes per the inventory).

### 4.4 Socket.IO — read carefully

Socket.IO **namespaces are multiplexed over a single HTTP path** (default `/socket.io/`). URL-path allowlisting in nginx therefore **cannot distinguish** the student dialogue/grading namespaces from the teacher text-mining namespace: if `/socket.io/` is allowlisted on the public door, all namespaces are reachable there at the transport level. Options, in preference order — [VERIFY] how the three gateways are actually configured (namespaces? custom paths?) before choosing:

1. Keep one path, and enforce door at the **handshake**: gateway middleware reads the trusted door header (§6) and rejects teacher-namespace connections arriving via the public door. Auth guards on the gateways remain the primary control.
2. Give the teacher-facing gateway(s) a distinct `path` so nginx can route them; more invasive, touches client and server.

Either way: the student build's socket client must connect only to dialogue+grading namespaces; the admin build to whatever teacher realtime it uses.

---

## 5. Route classification and public allowlist (`apps/api` audit — read-mostly)

Produce a checked-in artifact (suggest `docs/route-classification.md` or JSON) listing **every** HTTP route (method + path) and WS gateway, classified:

- **PUBLIC (student door):** needed by the student client.
- **PRIVATE (admin door only).**
- **BOTH** — with per-method notes where a module is mixed.

Ground rules for the audit:

- Derive routes from the actual controllers/decorators (46 module dirs per the inventory), not from documentation. Global prefix, versioning, and the WS paths must come from `main.ts`/gateway config.
- **Mixed modules are the trap.** Per the inventory, at least these serve both audiences and split per method/route, not per prefix: `courses`/`modules`/`items` (students read published course content; mutations are teacher), `assessments` (`GET /available` is student; assembly is teacher), `enrollments` (self-enroll/self-drop student; teacher-drop/policy teacher), `mastery` (`me/*` student; `students/*` teacher), `recording`/`webgazer`/`pupil-size` (student ingest + config reads; teacher config writes), `activity-log` (student batch ingest; teacher summaries/export). Classify at method+path granularity; where nginx can't express it cleanly, the door-guard (§6) covers the remainder.
- Expected PUBLIC set (from inventory — verify each): `auth` login (+refresh if present), `attempts`, `learning-interventions`, `dialogue` (+WS), `dialogue-notes`, `chat-history`, `mastery me/*`, `student-rag`, `logs` (all ingest routes + replay-snapshots POST), `recording` student paths, `webgazer`, `pupil-size`, `activity-log` batch + session lifecycle, student reads of courses/modules/items, `assessments GET /available`, enrollment self-service, grading WS (grade push to students).
- Expected PRIVATE set (verify): `topics`, `questions`, `course-structure` (`admin/...`), `page-content` (`admin/...`), `question-generation`, `kc`, `kc-evaluation`, `knowledge-version`, `curriculum-coverage`, `publish-gate`, `evaluation`, `rag` + `llm-settings`, `user-management`, `vlm`, `analytics`, `affective-mapping`, `text-mining` (+WS), `replay-annotations`, `jobs` (**must never be public** — known command-injection surface at `jobs.controller.ts:18` per inventory; independently, fixing that injection is a small, high-value change worth doing in passing — validate/parameterize `sessionId`), openface3/pyfeat orchestration (retry/backfill/stats/DLQ), `SeedController` (dev-only — verify it is excluded from production entirely), teacher `logs` reads (`getSessionReplayData` etc.).
- **Presigned MinIO uploads (★ from §2):** determine exactly what host:port the browser hits for recording-segment upload (and any presigned downloads students use, e.g. course PDFs — `modules` has "PDF presigned upload/download"). The public door must carry these flows: likely an nginx location proxying MinIO, with the presigned URL generation configured to emit the public hostname. This is a functional blocker if missed — resolve before any cut-over.
- `GET /health`: recommend PRIVATE (or public-but-minimal); flag as [HUMAN DECISION] if monitoring depends on it.

From the classification, generate the two nginx `server` block templates (public: allowlisted locations + final default-deny `404`; private: full proxy). Commit them as templates with placeholder IPs — real interface IPs come from SCIS ([HUMAN DECISION]/external dependency; see the Two-Door proposal document, §9 "Items Requiring Confirmation").

---

## 6. Optional backend hardening (recommended; small, additive)

- Each nginx block sets a header, e.g. `X-GALS-Door: public|private`, and **strips/overwrites any client-supplied value**.
- A NestJS guard (global or on admin controllers) rejects PRIVATE-classified routes when `X-GALS-Door: public`. Fail-safe direction: if the header is absent (e.g. dev), do **not** block — dev must keep working; the guard only _adds_ denial when the public marker is present. Also usable in the Socket.IO handshake per §4.4.
- This is defence in depth on top of the allowlist and RBAC — about a day-scale change ([VERIFY] effort against actual guard structure), and it makes a misconfigured allowlist entry non-fatal.

**Do not** modify existing RBAC guards, JWT logic, or 2FA as part of this work.

---

## 7. Mechanical verification (CI) — the split is only real if these pass

1. **Both targets build** on every CI run.
2. **Import-boundary lint** (dependency-cruiser/ESLint): student-entry-reachable code must not import teacher-only dirs. Build fails on violation.
3. **Bundle leak check:** script greps the _built_ student output (all JS chunks) for a maintained list of admin markers — teacher route paths from the real route table (`/teacher/`, `/dashboard/sessions/` — confirm against the real table), admin API prefixes (`admin/courses`, `user-management`, `question-generation`, `replay-annotations`, `text-mining`, …), and names of admin-only components. Fails the build on any hit. (String-grep on minified output has false-negative risk for computed strings; the import-boundary rule is the primary control, this is the backstop.)
4. **Route-coverage check:** every route in the API (enumerable at boot from the Nest route map) must appear in the classification artifact — CI fails if a new endpoint is added without being classified. This keeps the allowlist honest over time.
5. Existing tests still pass; dev workflow (compose up, HMR) still works.

Manual/joint verification of the network layer (external probes, VPN tests) is specified in the Two-Door proposal document §10 and is out of scope for the repo agent.

---

## 8. Out of scope for the repository agent

- Provisioning the VLAN/intranet interface, UFW rules, internal DNS record, VPN routing (SCIS/IITS).
- Domain purchase and DNS-01 certificate automation (research team, outside repo).
- Any Prisma schema/migration change.
- Any change to the workers (`pyfeat-worker`, `openface3-worker`, `apps/worker`).
- Deciding the [HUMAN DECISION] items: admin-build-includes-student-surface?, public registration on/off, health endpoint exposure, login-redirect UX wording, real IP values.

## 9. Suggested execution order

1. Discovery (§4.1 + §5 audit) → produce the route table + classification + import graph. **Stop and report** — this output gets human review before code moves, because the allowlist derived from it is security-relevant.
2. Import-boundary rules + shared/entry restructure (no behavior change yet; both builds still full-featured is acceptable as an intermediate state, but final student build must be pruned).
3. Two-target build config + relative API/WS addressing.
4. Socket.IO door handling per the option chosen after [VERIFY].
5. Door-guard hardening (§6), including the `jobs.controller` input-validation fix.
6. CI checks (§7).
7. Nginx templates generated from the classification.

---

_Cross-reference: the human-facing proposal (architecture, fallbacks, risk register, confirmations, phases) is `GALS_TwoDoor_Proposal.tex/.pdf`, 2026-09-08._
