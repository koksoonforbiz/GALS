# GALS Two-Door — Execution Plan for Claude Code (v1.1, audited)

**Date:** 2026-09-16 (v1.1 — audited: adds the prod-like local profile, the definitive local→L40 delta list, and the local test checklist)
**Read together with:** `TwoDoor_Frontend_Split_Spec` (in the ITS project, `claude/TwoDoor_Frontend_Split_Spec_20260908.md`) — that document carries the full factual basis, the [VERIFY] items, and the anti-hallucination rules. This document is the ordered execution sequence. Where the two disagree, the spec's epistemic rules win: **the code wins over both documents; verify before acting; do not invent anything you cannot find in the repo.**

**Confirmed decisions (treat as settled, supersede the spec's open items where they overlap):**

- Teacher/admin door hostname will be an **`in.scis.smu.edu.sg`** name (exact name TBC with SCIS — use a placeholder env var, never hardcode).
- Student door hostname will be a purchased public domain (TBC — same rule: env var placeholder).
- The teacher door binds to the L40's **existing internal IP** (value TBC from SCIS — placeholder).
- Student-door TLS: Let's Encrypt **HTTP-01** (so the public allowlist must permit `/.well-known/acme-challenge/`). Teacher-door TLS: certificate via SMU process (installed manually; treat as files provided at deploy time).
- No wildcard/DNS-01 automation. No registrar API integration.

---

## A. How this work runs (environment model)

**All development happens on the local repo. Nothing in Phases 0–6 touches or requires the L40.** The central design principle (added in v1.1): **the local verification environment IS the deployment artifact.** Phase 3 produces a production-topology compose profile — nginx serving the two built frontends and proxying the API, backend containers unpublished — that runs identically on the local machine and on the L40. Moving to the L40 then changes **only one env file, the certificates, and DNS** (§E), not the structure.

Two environments exist side by side throughout:

1. **Dev profile (unchanged):** the existing docker-compose dev setup — Vite HMR on 5173 against the API on 3000, bind mounts, hot reload. Day-to-day development stays here; do not break it.
2. **Two-door profile (new, e.g. `docker-compose.twodoor.yml` or a compose `--profile`):** built `dist-student/` + `dist-admin/` served by an nginx container with the real two-server-block config; API/Postgres/Redis/MinIO with **no published ports** (only nginx exposed); env-file-driven hostnames/IPs/cert paths. This is the dress rehearsal and the thing that ships.

Local two-door simulation details:

- **Two addresses for the two doors.** On Linux, loopback aliases `127.0.0.2` (public door) and `127.0.0.3` (internal door) work natively. **On macOS or Windows this needs setup (macOS: `sudo ifconfig lo0 alias 127.0.0.2` etc.; Windows: different again) — first ASK the user what OS the local machine runs.** Acceptable fallback on any OS: one address, two ports (e.g. `:8443` public door, `:9443` internal door) — per-IP `listen` binding then gets its final check on the L40 instead. Prefer two addresses where easy; do not burn time fighting the OS.
- `/etc/hosts` entries mapping two test hostnames (e.g. `student.gals.test`, `admin.gals.test`) to those addresses. Use `.test` TLD names locally, driven by the same env vars as production.
- **Locally trusted certs via `mkcert`** (install its CA into the user's browser trust store) so HTTPS, HSTS, secure cookies, and browser webcam/media permissions behave realistically. Self-signed is the fallback (browser warnings during testing only).
- **Seeded test data:** the profile must come up with at least one teacher and one student account and one course with content (use the existing seed mechanism found in Phase 0 — the spec notes a dev `SeedController`; verify how seeding is actually done and script it). Without seeded accounts the user cannot click through anything.
- **Known local limitation:** the GPU workers (pyfeat/openface3) will not produce results on a machine without the GPU + model weights. Webcam **upload** must still be tested locally (segments land in MinIO, jobs enqueue); analysis output is expected-absent locally and is verified on the L40.

**Branching:** one feature branch off the current working branch (confirm which branch is current with the user before starting — the spec's branch facts are from July 2026 and may be stale). Commit in small, phase-aligned commits. Do not merge to the main line without human review of Phase 0 output first (see stop point).

---

## B. Phase sequence

### Phase 0 — Discovery and classification (READ-ONLY; ends in a mandatory stop)

No code changes in this phase. Also ask the user two environment questions up front: (a) what OS the local machine runs (decides the two-address vs two-port simulation), (b) which branch is current. Then produce three artifacts, committed under `docs/two-door/`:

1. **`route-table.md`** — every frontend route from the real router registrations (expect them in `apps/web/src/App.tsx`, but verify), each labeled student / teacher / auth / shared. Known trap from the spec: at least one teacher surface lived outside `/teacher` (`/dashboard/sessions/:sessionId/timeline`); find all such cases.
2. **`api-classification.md` (or `.json`)** — every API endpoint (method + full path, derived from controllers/decorators plus the global prefix in `main.ts`) and every Socket.IO gateway (namespace + path + audience), classified PUBLIC / PRIVATE / MIXED-per-method. Cover the spec's known mixed modules (`courses`, `modules`/`items`, `assessments`, `enrollments`, `mastery`, `recording`, `webgazer`, `pupil-size`, `activity-log`) at method granularity. Include `/health`, any seed/dev controllers, and the `jobs` module (PRIVATE, always).
3. **`config-inventory.md`** — every place a hostname/origin/URL is configured or embedded: API base URL usage in the web client, Socket.IO client URLs, CORS config in the API, env vars, and **exactly how MinIO presigned URLs are generated** (which host ends up in the URL the browser receives, for both upload and download flows). Also record how the three Socket.IO gateways are mounted (one path, namespaces?) — this decides Phase 4's socket approach — and how database seeding works (for the test profile).

**STOP.** Present the three artifacts for human review. The nginx allowlist and the frontend split are both generated from them; an error here becomes a security hole or a broken student flow later. Do not proceed on your own.

### Phase 1 — Guardrails before moving anything

1. Add an import-boundary rule (dependency-cruiser or ESLint `no-restricted-imports`): code reachable from the student entry must not import teacher-only directories (exact directory list comes from Phase 0's import findings). Wire it into lint/CI so violations fail.
2. Ensure both future build commands have CI/script stubs (they'll be red until Phase 2 — acceptable, or gate them until then).

### Phase 2 — Frontend split (the bulk of the work)

1. Create two entries (e.g. `entry-student.tsx`, `entry-admin.tsx`) sharing a common providers root (Auth, query client, theme, PageContext if shared — per Phase 0 findings). Split the router registrations per the route table. Do not move page files unless an import-boundary violation forces it; the split is enforced at entry/router + lint level.
2. Two Vite build targets producing separate outDirs (`dist-student/`, `dist-admin/`). Per-entry builds (not one build with shared chunks). Keep the current dev workflow working.
3. Per-build Socket.IO wiring: student build connects only to the namespaces the classification marked student (per the spec: dialogue and the grading grade-push are student-facing; text-mining is teacher-facing — but trust Phase 0, not the spec, on the final list).
4. API addressing: relative/same-origin in production builds for both targets (each door's nginx proxies the API). Preserve dev behavior.
5. Handle the role-mismatch UX: a teacher logging in on the student door (or a route that no longer exists in that build) gets a clear "use the staff portal" style message, not a broken redirect. Propose wording; flag for human approval.
6. Sensing spine untouched: the student entry keeps `BiometricsWrapper`, capture libs, and the captureDom-OFF flag exactly as they are. Verify capture still initializes on the routes it did before (compare against Phase 0 route table).

### Phase 3 — Nginx, config, and the two-door compose profile

1. Generate `deploy/nginx/` templates from the Phase 0 classification: public server block (student dist root, allowlisted `location` set incl. student socket path and the ACME path `/.well-known/acme-challenge/`, final default-deny returning 404) and internal server block (admin dist root, full API proxy). **All environment-specific values — hostnames, listen addresses, cert paths — come from ONE env file** (e.g. `deploy/.env.twodoor`), with a documented substitution step (envsubst or compose variables). Two committed example env files: `.env.twodoor.local.example` (loopback IPs, `.test` names, mkcert paths) and `.env.twodoor.l40.example` (placeholders for the real values). No invented real values anywhere.
2. **The two-door compose profile** (§A): nginx container mounting the generated config and the two dists; API/Postgres/Redis/MinIO on the internal network with no published ports; seed step; one-command bring-up (`make twodoor-up` or a documented script) and teardown. This same profile, with the L40 env file, is what deploys.
3. Presigned-URL correctness: implement/configure whatever Phase 0 found is needed so browser-visible MinIO URLs carry the door-appropriate public hostname (likely an nginx proxy location for the object store plus the SDK's endpoint/public-URL config). **This is the change most likely to break the study if wrong — test it explicitly in Phase 6 (webcam segment upload + PDF download through the simulated public door).**
4. Each block sets `X-GALS-Door: public|private` and strips any client-supplied value.

### Phase 4 — Backend hardening (small, additive; no RBAC/JWT changes)

1. A guard that rejects PRIVATE-classified routes when `X-GALS-Door: public` is present; absence of the header (dev) never blocks. Apply per the classification; keep the classification file as the single source the guard reads or generates from.
2. Socket handshake door check for teacher-facing gateway(s), per the mounting facts found in Phase 0.
3. Fix the known injection surface: validate `sessionId` before it reaches the shell command in the `jobs` controller (spec cites `jobs.controller.ts:18` — verify location). Strict allowlist validation (e.g. UUID/format check), no behavior change otherwise.

### Phase 5 — CI verification

1. Both builds on every CI run; import-boundary lint enforced.
2. Bundle leak check: script greps built student output for teacher route strings, admin API prefixes, and admin component names (list maintained from Phase 0 artifacts); CI fails on any hit.
3. Route-coverage check: every route the API exposes at boot must appear in the classification artifact; CI fails on unclassified routes (keeps the allowlist honest as endpoints are added).
4. Existing test suite still green.

### Phase 6 — Local end-to-end verification (scripted + human click-through)

Two layers against the two-door profile. **Scripted** (committed, re-runnable, results recorded in `docs/two-door/verification-local.md`):

1. Public door: every PRIVATE route from the classification returns 404; ACME path reachable; no admin strings in served JS; backend ports (5432, 6379, 9000, 3000) unreachable from the host except via nginx.
2. Internal door: PRIVATE routes reachable (auth still required); teacher socket connects.
3. Cross checks: teacher-namespace socket refused via public door; door-guard denials behave as designed.

**Human click-through** — the checklist in §F, run by the user in a real browser. Phase 6 is not complete until both layers pass.

### Phase 7 — Deployment runbook (document only; humans + a later session execute on the L40)

Produce `docs/two-door/deploy-runbook.md` from §E of this plan: prerequisites, the env-file substitutions, cut-over order, rollback (the pre-split single-door config kept deployable), and the joint verification checklist to run with SCIS/IITS (external probe, VPN test, negative tests) mirroring the proposal's §10.

---

## C. Effort and duration (estimate — honest ranges, revisit after Phase 0)

The change is **moderate**: no schema/database work, no backend business-logic changes, no worker changes; it is frontend restructuring + build/deploy configuration + a small additive backend guard. The single biggest unknown is **component entanglement** — pages that mix student and teacher concerns in shared components. Phase 0 reveals this; re-estimate after it.

With Claude Code doing the implementation and a human reviewing:

| Phase                  | Agent working time                                                              | Human time                                                           |
| ---------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 0 Discovery            | hours                                                                           | 1–2 h careful review of the classification (**the** critical review) |
| 1 Guardrails           | hours                                                                           | minutes                                                              |
| 2 Frontend split       | the long pole — roughly 1–3 working days of iteration depending on entanglement | review + manual click-through, 2–4 h                                 |
| 3 Nginx/config/profile | ~1 day incl. presigned-URL work and the compose profile                         | 1 h                                                                  |
| 4 Hardening            | hours                                                                           | 1 h                                                                  |
| 5 CI                   | hours                                                                           | minutes                                                              |
| 6 Verification         | ~0.5–1 day incl. fixing what it finds                                           | 1–2 h click-through (§F)                                             |
| 7 Runbook              | hours                                                                           | 30 min                                                               |

**Calendar estimate: roughly one working week end-to-end with prompt reviews; up to two if Phase 0 reveals heavy entanglement or the presigned-URL path needs real rework.** L40 deployment afterwards: half a day to a day once Andrew's items are in hand (§E), plus IITS-dependent waits that don't block a hosts-file go-live.

---

## D. Rules of engagement (repeat of the spec's, binding here)

- Verify every fact against the code; the spec's file paths and line numbers are from July 2026.
- Stop at the Phase 0 gate for human review; also stop and ask on any [HUMAN DECISION] (admin build containing student surface or not, registration exposure, health endpoint, redirect wording).
- Never hardcode real hostnames, IPs, or secrets; placeholders + env substitution throughout.
- No changes to Prisma schema, workers, RBAC/JWT/2FA logic, or the sensing pipeline's behavior.
- Keep every phase's changes revertible; the current single-door deployment must remain buildable until cut-over.

---

## E. Local → L40: exactly what changes at deployment (and nothing else)

If Phases 0–6 are done right, the move to the L40 is **the same repo, the same compose profile, a different env file, real certificates, and real DNS.** The complete delta:

**1. One env file (`deploy/.env.twodoor` on the L40, root-owned, never committed):**

| Variable (illustrative)                          | Local value              | L40 value (source)                                |
| ------------------------------------------------ | ------------------------ | ------------------------------------------------- |
| Student hostname                                 | `student.gals.test`      | purchased public domain (Prof Ngo approval)       |
| Admin hostname                                   | `admin.gals.test`        | agreed `…in.scis.smu.edu.sg` name (Andrew)        |
| Public listen address                            | `127.0.0.2` (or port)    | L40 public IP (Andrew)                            |
| Internal listen address                          | `127.0.0.3` (or port)    | L40 existing internal IP (Andrew)                 |
| Cert/key paths (student door)                    | mkcert files             | Let's Encrypt live paths                          |
| Cert/key paths (admin door)                      | mkcert files             | SMU-issued cert files (Andrew/IITS process)       |
| Public MinIO/object URL base                     | student `.test` hostname | public student hostname                           |
| DB/Redis/MinIO credentials, JWT secret, LLM keys | dev/test values          | production secrets (root-owned env, per proposal) |

**2. Certificates:** local mkcert is replaced by (a) certbot on the L40 for the student door — HTTP-01 via the already-allowlisted ACME path, plus its systemd renewal timer; (b) the SMU-issued cert for the admin door installed manually, with a renewal reminder in the runbook (likely yearly, not automated).

**3. DNS:** local `/etc/hosts` `.test` entries are replaced by (a) a real public A record for the student hostname → L40 public IP (our registrar); (b) the IITS-resolver registration for the `in.scis` name → internal IP (Andrew/IITS) — with teacher hosts-file entries as the working interim until it lands.

**4. Platform items that exist only on the L40 (runbook steps, not code):** UFW default-deny inbound with 443 on both interfaces and SSH from management ranges (Andrew's sign-off); compose profile started under a restart policy / systemd unit so it survives reboots; production database initialization (migrations run via the existing start path; create real teacher accounts; **no dev seed data**); the seed/dev controller disabled or excluded in production (per the Phase 0 finding); GPU worker deployment with model weights (the part local testing could not cover — verify pyfeat/openface3 jobs actually process on the L40); backups/disk housekeeping per existing practice.

**5. Explicitly unchanged in the move:** repo/branch content, the compose profile structure, the nginx template logic and allowlist, both frontend builds, the classification artifacts, CI. If the move requires editing anything outside the env file and the platform steps above, that is a defect in Phases 3–6 — fix it in the repo, not by hand on the server.

**External prerequisites gating deployment (chase in parallel, none block local work):** public IP + inbound 443 (Andrew/IITS), internal IP value (Andrew), agreed `in.scis` hostname + resolver registration (Andrew→IITS), admin-door certificate issuance (Andrew/IITS), domain purchase (Prof Ngo), teacher RN-VPN access confirmation (Andrew/IITS).

---

## F. Local test checklist (what the user runs in a browser to say "it works")

Bring-up: one command (`make twodoor-up` or equivalent), then with the mkcert CA trusted and hosts entries in place:

1. **Student door** (`https://student.gals.test`): student login works; course view loads content and PDFs; dialogue mode chats over the websocket; submitting an attempt returns a grade notification (grading socket); **webcam consent + recording produces segment uploads (check MinIO/bucket or the segments table — analysis results are expected absent locally, GPU workers not running)**; browser devtools shows no requests to internal hostnames and no 404-storm.
2. **Student door, negative:** visiting any teacher URL (e.g. a `/teacher/...` path and the `/dashboard/sessions/...` path) shows 404/not-found — not a blank admin shell; calling a known admin API path (e.g. user-management) returns 404; the served JS contains no admin route when searched via devtools.
3. **Teacher door** (`https://admin.gals.test`): teacher login works; course builder loads; Student Logs hub opens a session, and the Replay tab loads snapshots/timeline data from previously captured local sessions; text-mining dashboard connects.
4. **Teacher door from the wrong side:** the student hostname does not serve teacher pages; the teacher hostname is bound to the internal address only (on the two-port fallback, confirm the bind addresses in config — final check happens on L40).
5. **Dev unchanged:** the normal dev compose + HMR workflow still runs.

Record pass/fail per item in `docs/two-door/verification-local.md`. All of §F passing + Phase 6's scripted layer passing = ready for the L40 runbook.
