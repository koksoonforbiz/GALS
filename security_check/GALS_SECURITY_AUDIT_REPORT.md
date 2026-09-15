# GALS — SMU Cybersecurity Checklist for Research: Audit Report

|                       |                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Date**              | 15 September 2026 (audit) · updated the same day after the local remediation pass                                            |
| **Codebase audited**  | branch `splitting_builds` @ `f318c8b`, then branch `security-checklist-fixes` (working tree) for the remediation             |
| **Checklist**         | `SMU Cybersecurity Checklist for Research - 20260904.xlsx`, tab _Checklist_, 66 items                                        |
| **Target deployment** | SMU-owned **L40** server, on-premises, Docker Compose "two-door" stack (`deploy/`), AWS Bedrock for LLM inference only       |
| **Outputs**           | This report · `SMU Cybersecurity Checklist for Research - 20260904 - GALS response.xlsx` (column D/E filled for all 66 rows) |

## 1. Result at a glance

| Response                                                                    | Count  | Items                                  |
| --------------------------------------------------------------------------- | ------ | -------------------------------------- |
| **C** — Comply (implemented in the repo, or a commitment the project makes) | **55** | everything not listed below            |
| **NC** — Non-comply (a material part is not done yet)                       | **10** | 29, 30, 32, 42, 48, 50, 60, 62, 63, 66 |
| **NA** — Not applicable                                                     | **1**  | 54 (no model training is performed)    |

_Before the remediation pass the count was 51 C / 14 NC / 1 NA; items 8, 12, 23 and 46 moved to C — see §5a for what was changed._

How the C/NC line was drawn: **C** means the control is built and verifiable in the repository today, _or_ it is a process commitment (items worded "the researcher shall agree to…"), _or_ it is built and will be switched on by a documented go-live step in `docs/two-door/runbook-l40.md` / `docs/PRODUCTION_DEPLOYMENT_TODO.md`. **NC** means something is genuinely not built or not decided. Column E of the workbook says which is which for every row, so IITS can rate residual risk on the partial ones.

Of the 10 remaining NC items, **5 need the L40 server to exist** (29, 30, 32, 48, 50-host), **3 need an external resource or decision** (42 support contracts; 62/63 the Bedrock Guardrail resource in the SMU AWS account — the code for it is already wired), and **2 are testing exercises** (60 red-team run, 66 Project Moonshot) that can be run locally against Bedrock once time is allocated.

## 2. What changed since the previous audit artifact (8 Sept)

The previous "GALS Checklist Audit" artifact was accurate for its date but the branch has moved. Verified differences that change answers:

| Item                 | Previous artifact said                                                        | Verified now                                                                                                                                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5 Password lifecycle | Partial — forced first-login change and 180-day expiry "deliberately removed" | **Fully implemented**: `password-lifecycle.util.ts` (`mustChangePassword`, `PASSWORD_EXPIRY_MS` = 180 d), enforced server-side in `RolesGuard` and client-side in `ProtectedRoute.tsx` → `/change-password`; min age 3 d in `AuthService`. `PRODUCTION_DEPLOYMENT_TODO.md` §3 is stale on this point. |
| 33 TLS               | Gap — no TLS anywhere                                                         | **Built**: two-door nginx with TLS 1.2/1.3 + HSTS (`deploy/nginx/snippets/tls.conf`, `security-headers.conf`), Let's Encrypt/institutional certs per runbook.                                                                                                                                         |
| 17 MinIO exposure    | MinIO on the shared network, browser talks to it directly                     | In the production overlay MinIO has **no host port**; the browser reaches it through nginx `/s3/`. Resolved for L40.                                                                                                                                                                                  |
| 62 Output moderation | "Fixed" via OpenAI Moderation API                                             | **Regressed to none** — OpenAI was removed as a provider (Bedrock only); `moderateText()` deleted. Only Bedrock Guardrails can restore this.                                                                                                                                                          |
| 16 Rate limiting     | Per-route throttles added                                                     | Those throttles were **inert** until `ThrottlerGuard` was bound as `APP_GUARD` (`app.module.ts`) — now fixed; plus a per-teacher daily cost cap (`LLM_DAILY_COST_CAP_USD`).                                                                                                                           |
| 4 Secrets            | Key derived from `JWT_SECRET`                                                 | `ENCRYPTION_KEY` decoupling + optional encrypted `.env.enc` (`encrypt-env.js` / `decrypt-env-boot.js`).                                                                                                                                                                                               |
| 23 EOS assets        | Only an AWS-SDK warning                                                       | **New finding: Node.js 20 is past end-of-life (30 Apr 2026)** — `.nvmrc`, `engines`, both Dockerfiles use it. MinIO pin was reverted to `:latest` (the tag chosen earlier didn't exist).                                                                                                              |
| 51 Advisories        | 6 moderate, none patchable in-major                                           | `react-router-dom 6.30.6` **now patches 3 of the 6** in-major; only `@nestjs/core` (needs v11) and two `react-router` <7.18 findings remain.                                                                                                                                                          |
| 21 Data validation   | Not in the artifact (numbering skipped it)                                    | The xlsx has it as item 21; covered by Zod + Prisma + `execFile` + upload checks.                                                                                                                                                                                                                     |
| 2, 15, 28            | Documentation tasks "to do"                                                   | Now exist: `docs/USER_ACCESS_MATRIX.md`, `docs/OWASP_API_TOP10_MAPPING.md`, `docs/BACKUP_PLAN.md`.                                                                                                                                                                                                    |

## 3. Item-by-item position

Full evidence text for each row is in the workbook (column E). Summary:

| #                                          | Status | Evidence / position (full text in the workbook, column E)                                                                                                                                                       |
| ------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Account and Password**                   |        |                                                                                                                                                                                                                 |
| 1                                          | C      | No default/root admin account, no seeded credentials, no silent default credentials anywhere (MinIO `minioadmin` fallbacks removed this pass).                                                                  |
| 2                                          | C      | docs/USER_ACCESS_MATRIX.md — generated from every \*.controller.ts in apps/api/src.                                                                                                                             |
| 3                                          | C      | Shared Zod schema PASSWORD_COMPLEXITY in packages/shared/src/user.ts: min 12 chars, ≥1 digit, ≥1 lowercase, ≥1 uppercase, ≥1 special character.                                                                 |
| 4                                          | C      | No cloud vault (on-prem SMU host). AES-256-GCM for stored secrets keyed from `ENCRYPTION_KEY`; optional encrypted `.env.enc`; Compose refuses to start with any secret unset.                                   |
| 5                                          | C      | All five rules implemented: forced first-login change, 3-day min age, 180-day expiry, last-3 history, 5-attempt/30-min lockout.                                                                                 |
| 6                                          | C      | All passwords are hashed with bcrypt (cost factor 10) before storage.                                                                                                                                           |
| 7                                          | C      | RBAC via @Roles()/RolesGuard on every controller; self-registration cannot claim admin.                                                                                                                         |
| 8                                          | C      | Every container non-root (API `node`, nginx unprivileged, three ML workers as uid 10001); `ats_app` DB role activated at go-live.                                                                               |
| 9                                          | C      | MFA supported for every role: TOTP and e-mail OTP.                                                                                                                                                              |
| 10                                         | C      | No cloud console; unique named accounts, RBAC, privileged actions logged; L40 host/DB console by named accounts (IITS).                                                                                         |
| 11                                         | C      | `User.isActive` checked on every request in `JwtStrategy.validate()` — deactivation is immediate.                                                                                                               |
| 12                                         | C      | Mandatory MFA built (`MFA_REQUIRED_ROLES`), set to `admin,teacher` in the L40 runbook; un-enrolled staff are gated to Account Security.                                                                         |
| 13                                         | C      | Commitment: quarterly account review using User Management + access matrix.                                                                                                                                     |
| **API Security**                           |        |                                                                                                                                                                                                                 |
| 14                                         | C      | OpenAPI at /api-docs (non-production only) + `docs/two-door/api-classification.md`, `route-table.md`.                                                                                                           |
| 15                                         | C      | `docs/OWASP_API_TOP10_MAPPING.md` maps all ten categories to concrete controls.                                                                                                                                 |
| 16                                         | C      | Global 30 req/60 s throttle + 30 per-route limits; JWT; LlmUsageLog/LlmAuditLog/SecurityEvent; daily LLM cost cap.                                                                                              |
| **Application Security**                   |        |                                                                                                                                                                                                                 |
| 17                                         | C      | nginx → API → internal-only Postgres/Redis/MinIO/ClamAV network; only nginx publishes ports; diagrams in `docs/ARCHITECTURE.md`.                                                                                |
| 18                                         | C      | npm registry pinned (`.npmrc`), frozen lockfile, official Docker images, PyPI.                                                                                                                                  |
| 19                                         | C      | `docs/SECURE_SDLC.md`; CI runs lint/typecheck/unit/e2e/bundle checks.                                                                                                                                           |
| 20                                         | C      | Agree to IITS SAST/DAST per release.                                                                                                                                                                            |
| 21                                         | C      | Zod validation on every request, Prisma parameterised queries, `execFile`, upload type/size + malware scan.                                                                                                     |
| 22                                         | C      | Agree to IITS WAF in front of the public door.                                                                                                                                                                  |
| **Asset Management**                       |        |                                                                                                                                                                                                                 |
| 23                                         | C      | Runtime moved to Node.js 24 LTS (to Apr 2028). MinIO/ClamAV pinned by manifest digest, pull + boot verified live (see §5b; MinIO's pin points at quay.io because Docker Hub's `minio/minio` now refuses pulls). |
| 24                                         | C      | `docs/ARCHITECTURE.md` asset table + `docs/BOM.md`/`bom.csv`.                                                                                                                                                   |
| **Audit Logs and SIEM**                    |        |                                                                                                                                                                                                                 |
| 25                                         | C      | SecurityEvent, ActivityLog (acting-user ID), LlmAuditLog; every 5xx recorded.                                                                                                                                   |
| 26                                         | C      | DB audit tables never purged; container logs to be rotated ≥30 d on L40.                                                                                                                                        |
| 27                                         | C      | Agree to ship stdout/host logs to IITS SIEM.                                                                                                                                                                    |
| **Backup, Restore and DR**                 |        |                                                                                                                                                                                                                 |
| 28                                         | C      | `docs/BACKUP_PLAN.md` — daily pg_dump + daily MinIO sync; Redis not backed up; secrets in a vault.                                                                                                              |
| 29                                         | **NC** | No off-site backup yet — no production data; target to be agreed with IITS.                                                                                                                                     |
| 30                                         | **NC** | Restore not yet tested — go-live gate.                                                                                                                                                                          |
| 31                                         | C      | Daily kept 4 weeks, weekly kept 12 weeks.                                                                                                                                                                       |
| **Data Security**                          |        |                                                                                                                                                                                                                 |
| 32                                         | **NC** | App-level AES-256-GCM on two secret fields; volume/DB/object encryption depends on L40 disk (LUKS) — not yet.                                                                                                   |
| 33                                         | C      | HTTPS/TLS 1.2-1.3 + HSTS at nginx; Bedrock/SMTP over TLS; intra-host Docker network unpublished.                                                                                                                |
| 34                                         | C      | Named RBAC accounts, all privileged actions logged; NDA to be signed by team.                                                                                                                                   |
| 35                                         | C      | Terms/data-collection consent at registration (`termsAcceptedAt`) + per-student recording consent; text pending legal review.                                                                                   |
| 36                                         | C      | Agree to IITS DLP.                                                                                                                                                                                              |
| 37                                         | C      | `docs/DATA_INVENTORY.md` — classification, location, proposed retention per category.                                                                                                                           |
| **End of Project**                         |        |                                                                                                                                                                                                                 |
| 38                                         | C      | Commitment: destroy volumes, secure-erase per IITS, delete backups, revoke Bedrock credentials.                                                                                                                 |
| **Incident Response**                      |        |                                                                                                                                                                                                                 |
| 39                                         | C      | Agree: 2 h (sev-1) / 48 h (sev-2) notification.                                                                                                                                                                 |
| 40                                         | C      | Agree: detailed incident reports.                                                                                                                                                                               |
| 41                                         | C      | Agree: support IR exercises.                                                                                                                                                                                    |
| **NDA, PDPA, and Contract**                |        |                                                                                                                                                                                                                 |
| 42                                         | **NC** | Open-source stack — no commercial back-to-back support; AWS support covers Bedrock; L40 hardware support is IITS's.                                                                                             |
| 43                                         | C      | Hosted on SMU L40; only cloud dependency is AWS Bedrock (the IITS provider).                                                                                                                                    |
| **Patch Management**                       |        |                                                                                                                                                                                                                 |
| 44                                         | C      | Official registries/images only.                                                                                                                                                                                |
| 45                                         | C      | `docs/BOM.md` / `bom.csv` (953 packages).                                                                                                                                                                       |
| 46                                         | C      | CI `dependency-audit` job fails on high/critical; Dependabot for npm/pip/docker/actions; host tracking via IITS tool.                                                                                           |
| **Perimeter Security**                     |        |                                                                                                                                                                                                                 |
| 47                                         | C      | Admin door loopback/VPN + CIDR allow-list; SSH via SMU VPN/bastion.                                                                                                                                             |
| **System Security**                        |        |                                                                                                                                                                                                                 |
| 48                                         | **NC** | IITS host anti-malware agent to be installed at L40 installation.                                                                                                                                               |
| 49                                         | C      | ClamAV scans every upload; fails closed in production; EICAR live test passed locally 2026-09-15 on both upload endpoints (see §5b) — repeat on L40 at go-live.                                                 |
| 50                                         | **NC** | All containers hardened (non-root, helmet, security headers); host OS CIS hardening + CSP pending.                                                                                                              |
| **Vulnerability Management**               |        |                                                                                                                                                                                                                 |
| 51                                         | C      | Agree to timelines; today 0 critical / 0 high / 3 moderate (`react-router-dom 6.30.6` applied; rest need NestJS 11 / RR 7).                                                                                     |
| 52                                         | C      | Agree to pen test before go-live and annually.                                                                                                                                                                  |
| 53                                         | C      | Agree to report remediation progress.                                                                                                                                                                           |
| **AI Model Training & Transparency**       |        |                                                                                                                                                                                                                 |
| 54                                         | NA     | No training/fine-tuning; hosted Bedrock models (GPT-5.6 chat, Cohere Embed v4).                                                                                                                                 |
| 55                                         | C      | Vendor safety alignment + grounding contract refusal clause.                                                                                                                                                    |
| 56                                         | C      | `docs/AI_MODEL_CARD.md`.                                                                                                                                                                                        |
| **AI Prompt Injection**                    |        |                                                                                                                                                                                                                 |
| 57                                         | C      | Zod-validated input + GROUNDING_CONTRACT + delimited SOURCES block.                                                                                                                                             |
| 58                                         | C      | Documents injected only inside the SOURCES boundary; poisoned-chunk tests.                                                                                                                                      |
| 59                                         | C      | 27 automated injection tests in CI (`grounded-prompt.injection.spec.ts`).                                                                                                                                       |
| 60                                         | **NC** | No live red-team yet — planned before go-live.                                                                                                                                                                  |
| **AI Data**                                |        |                                                                                                                                                                                                                 |
| 61                                         | C      | ChatbotMessage (full text), LlmAuditLog (query + metadata), LlmUsageLog (cost); in `DATA_INVENTORY.md` §3 and /terms.                                                                                           |
| **AI Output Safety & Content Moderation**  |        |                                                                                                                                                                                                                 |
| 62                                         | **NC** | Guardrail wiring in code (`BEDROCK_GUARDRAIL_ID`) + tests; the Guardrail resource itself must be created in the SMU AWS account.                                                                                |
| 63                                         | **NC** | In-app detection logs only; blocking/anonymising to come from the Guardrail's PII policy — PDPA decision pending.                                                                                               |
| 64                                         | C      | "The assistant can make mistakes…" notice under the chat input.                                                                                                                                                 |
| **AI Bias, Safety, and Automated Testing** |        |                                                                                                                                                                                                                 |
| 65                                         | C      | Vendor alignment + refusal clause + grounding to course material + disclaimer.                                                                                                                                  |
| 66                                         | **NC** | No independent tool run yet (in-house eval measures groundedness only); Moonshot planned.                                                                                                                       |

## 4. What has been done (verified in code)

- **Identity & access** — bcrypt hashing; 12-char complexity schema shared across all password paths; full password lifecycle (first-login change, min age, expiry, history, lockout) with server-side enforcement; TOTP + e-mail MFA; immediate deactivation via `isActive`; RBAC on 33 controllers with a generated access matrix; self-registration cannot claim admin; no seeded credentials, dev seed fails closed in production.
- **API & app hardening** — Zod validation on every body; `ThrottlerGuard` globally bound + 30 per-route limits; daily LLM cost cap; helmet + nginx security headers; OpenAPI only outside production; command-injection fix (`execFile` + UUID); OWASP API Top 10 mapping; two-door split (public student door with a 135-route allowlist and `DoorGuard`, staff door not internet-exposed).
- **Secrets & crypto** — Compose refuses placeholder secrets; AES-256-GCM for TOTP secrets and per-teacher API keys keyed from `ENCRYPTION_KEY`; optional encrypted `.env.enc`; TLS 1.2/1.3 + HSTS at nginx.
- **Segmentation & supply chain** — Postgres/Redis/MinIO/ClamAV on an internal-only network; only nginx publishes ports; non-root API and nginx images; `.npmrc` registry pin, frozen lockfile, BOM of 953 packages; 117 → 6 advisories via `pnpm.overrides`.
- **Logging** — `SecurityEvent` (failed logins, lockouts, permission denials, token reuse, quota, door probes, 5xx), `ActivityLog` with acting-user ID, `LlmAuditLog`, `LlmUsageLog`; nothing auto-purged.
- **Uploads** — ClamAV scan on both upload endpoints, fail-closed in production.
- **Data governance docs** — `DATA_INVENTORY.md`, `ARCHITECTURE.md`, `BACKUP_PLAN.md`, `AI_MODEL_CARD.md`, `SECURE_SDLC.md`, `USER_ACCESS_MATRIX.md`, `/terms` consent + per-student recording consent.
- **AI safety** — grounding contract (input/retrieved content treated as data, refusal clause), delimited SOURCES block, 27 injection tests in CI, PII detector (log-only), user disclaimer, Bedrock-only provider.

## 5. What has yet to be done

| #          | Gap                                                                                      | Owner                | Where it gets done             |
| ---------- | ---------------------------------------------------------------------------------------- | -------------------- | ------------------------------ |
| 23         | MinIO/ClamAV images on rolling tags — pin to a digest                                    | Dev                  | Needs Docker (WSL2 or L40)     |
| 46         | Host-level patch tracking                                                                | IITS                 | L40                            |
| 51         | NestJS 10→11 and React Router 6→7 migrations (last 3 moderates)                          | Dev                  | Local, scheduled work          |
| 29, 30, 31 | Off-site backup, restore test, confirm retention                                         | Dev + IITS           | L40                            |
| 32         | Volume/DB/object encryption at rest                                                      | IITS (disk)          | L40                            |
| 42         | No commercial support contract for OSS stack                                             | PI / IITS            | Decision                       |
| 48         | Host anti-malware agent                                                                  | IITS                 | L40                            |
| 50         | Host OS CIS hardening; Content-Security-Policy on both doors                             | IITS / Dev           | L40 / Local (browser session)  |
| 60         | Live red-team of the deployed model                                                      | Dev                  | Local (against Bedrock) or L40 |
| 62         | Output moderation — create the Bedrock Guardrail resource and set `BEDROCK_GUARDRAIL_ID` | IITS (AWS resource)  | AWS account                    |
| 63         | PII redaction vs log-only                                                                | PI + SMU PDPA office | Decision                       |
| 66         | Independent AI testing (Project Moonshot)                                                | Dev                  | Local or L40                   |
| 35, 37     | Legal review of /terms text; final PDPA classification & retention                       | SMU legal/PDPA       | Paperwork                      |
| 34, 13, 39 | NDA signatures; quarterly review calendar; IR contact tree                               | PI                   | Paperwork                      |

One item worth noting for IITS: the workbook's own _Summary_ tab has broken formulas in rows 18–23 (`#REF!` and wrong row references for Vulnerability Management / AI categories) — that is in SMU's template, not something we changed.

### 5a. Remediation pass (local machine, 15 Sept 2026) — branch `security-checklist-fixes`

Verified by `pnpm typecheck`, `pnpm lint` (0 errors), the API unit suite (439 passing; the 3 DB-backed integration suites fail identically to baseline because there is no local Postgres), both web bundle builds and the two-door bundle/route-coverage checks.

| Item   | Change                                                                                                                                                                                                                                                                                                                                                                                                             | Where                                                                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 23     | Node 20 (EOL) → **Node 24 LTS**: `.nvmrc`, `engines >=22`, `node:24-alpine` in API + web Dockerfiles, all 5 CI jobs; asset table updated                                                                                                                                                                                                                                                                           | `apps/*/Dockerfile`, `.github/workflows/ci.yml`, `docs/ARCHITECTURE.md`                                                                                                                                                       |
| 51     | `react-router-dom` → 6.30.6 — advisories 6 → **3** (all moderate; the rest need major upgrades)                                                                                                                                                                                                                                                                                                                    | `apps/web/package.json`, `pnpm-lock.yaml`                                                                                                                                                                                     |
| 46     | New CI job `dependency-audit` (`pnpm audit --prod --audit-level=high`) + `.github/dependabot.yml` (npm, 3× pip, 2× docker, github-actions, weekly)                                                                                                                                                                                                                                                                 | `.github/`                                                                                                                                                                                                                    |
| 1, 4   | MinIO credentials now **required** (`:?`) in both compose files; `minioadmin` fallbacks removed from `log-export.service.ts`, `openface3-worker/main.py`, `worker/app/config.py`, the two orphan-cleanup scripts and the READMEs                                                                                                                                                                                   | compose, API, workers                                                                                                                                                                                                         |
| 8, 50  | Three Python ML workers run as **uid 10001 `worker`** (model caches/`HF_HOME`/`TORCH_HOME`/matplotlib under a writable home; py-feat's `feat/resources` chowned so runtime model downloads still work). Written without Docker here — build check listed as a go-live smoke test                                                                                                                                   | `apps/worker`, `apps/openface3-worker`, `apps/pyfeat-worker` Dockerfiles                                                                                                                                                      |
| 12     | **Mandatory MFA**: `MfaPolicyService` reads `MFA_REQUIRED_ROLES`; `RolesGuard` returns `403 MFA_ENROLMENT_REQUIRED` and `WsAuthService` refuses sockets for un-enrolled accounts of a listed role; login//auth/me carry `mustEnrolMfa`; web `ProtectedRoute` + 403 fallback redirect to Account Security, which shows a required-enrolment notice. Off by default; runbook sets `admin,teacher`. 6 new guard tests | `apps/api/src/auth/mfa-policy.service.ts`, `roles.guard.ts`, `auth.service.ts`, `auth.controller.ts`, `ws-auth.service.ts`; `apps/web/src/{components/ProtectedRoute,lib/api,contexts/AuthContext,pages/AccountSecurityPage}` |
| 62, 63 | **Bedrock Guardrails hook**: every Converse call carries `guardrailConfig` when `BEDROCK_GUARDRAIL_ID` is set (`trace: enabled`); `stopReason: guardrail_intervened` is surfaced as `guardrailIntervened`, logged with the policy that fired, and the guardrail's blocked message is returned as the reply. 4 new tests. Still NC until the Guardrail resource exists                                              | `apps/api/src/rag/llm.service.ts`, `llm.service.guardrail.spec.ts`, `.env.example`, `docker-compose.yml`                                                                                                                      |
| docs   | `PRODUCTION_DEPLOYMENT_TODO.md` (stale item-5 entry removed; new env vars, smoke tests, status), `SECURE_SDLC.md`, `AI_MODEL_CARD.md`, `two-door/runbook-l40.md` §2.1, `two-door/config-inventory.md`                                                                                                                                                                                                              | `docs/`                                                                                                                                                                                                                       |

Not done locally at the time of the remediation pass (needed Docker or an external resource): image digest pins, the worker image build check, the Guardrail resource, the Node 24 image build, the red-team / Moonshot runs, and a Content-Security-Policy (needs the sensing stack open in a browser). **The Docker-dependent ones were completed the same day in the live verification pass below (§5b); the Guardrail resource, red-team / Moonshot runs and CSP remain open.**

### 5b. Live verification pass (Docker via WSL2, 15 Sept 2026) — branch `docker-smoke-tests`

Every §6b item that a local Docker stack can exercise was run against a live
stack (Postgres/Redis/MinIO/ClamAV + api/web/workers). Full detail per item is
in `docs/PRODUCTION_DEPLOYMENT_TODO.md` §2's ticked checkboxes. Three real
defects were found by these tests and fixed on this branch:

| Finding                                                                                                                                           | Impact                                                                                                                                                                     | Fix                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ThrottlerRedisStorage` hardcoded `isBlocked: false`; @nestjs/throttler v6 only 429s when the storage reports blocked                             | Rate limiting was still silently inert app-wide even after the earlier `APP_GUARD` fix — counts and `X-RateLimit-*` headers looked correct while nothing was ever rejected | Storage now honours `limit`/`blockDuration` with a Redis block key; live run returns exactly 30×401 then 429s with `Retry-After: 60` (`apps/api/src/common/throttle-redis.storage.ts`)                        |
| The nodemailer 6→10 CVE bump existed only as a root `pnpm.overrides` entry, which the api Dockerfile's lockfile-less `pnpm install` never applies | Every container still ran nodemailer 6.10.1 despite the audit recording the bump as done                                                                                   | `apps/api/package.json` now declares `^10.0.1` directly; rebuilt image verified at 10.0.10 with a real OTP email delivered via Gmail SMTP                                                                     |
| `llm_model_pricing` had no `bedrock` rows, so `calculateCost()` returned $0 for every Bedrock call                                                | The `LLM_DAILY_COST_CAP_USD` circuit breaker (item 16) could never trigger for the production provider                                                                     | Migration `20260915000000_add_bedrock_model_pricing` adds proxy rates (replace with the real Bedrock price sheet before go-live); live test now shows the 429 refusal + `USAGE_QUOTA_EXCEEDED` security event |

Also verified live, no defects: non-root worker images (uid 10001; recording
job end-to-end → 68 EmotionFrame + 15 PyfeatAuResult rows, no permission
errors), Node 24 production images (api healthy as uid 1000; web and twodoor
nginx serving on 8080/8443), MinIO/ClamAV digest pins (pull + boot),
`security_events` rows for failed login and permission denial, EICAR
accept/reject on both upload endpoints, the mandatory-MFA gate (403 +
`mustEnrolMfa` for un-enrolled teachers, students unaffected, 200 after TOTP
enrolment), and the `ats_app` least-privilege role (API healthy on it,
`prisma migrate deploy` + DDL probe clean). No checklist statuses change —
these all verify items already marked C — so the response workbook was not
regenerated.

## 6. What can be done on your local machine now

### 6a. Code changes (no server needed)

Items 1–6 and 8 of the original list were completed in the remediation pass (§5a). What remains:

1. **Content-Security-Policy** (item 50) — flagged in `security-headers.conf` as a follow-up; needs a browser session with the sensing stack (pyodide/webgazer/mediapipe) to enumerate what to allow.
2. **NestJS 10→11 and React Router 6→7** (item 51's last 3 moderates) — multi-day migrations with breaking changes; schedule with a full regression pass.
3. **Commit and push** the `security-checklist-fixes` branch (`git push gals security-checklist-fixes`) and open the PR so the new `dependency-audit` CI job and Dependabot start running.

### 6b. Verification you can run locally (Docker via WSL2 — `docker` is not on this Windows PATH)

These are the tests the previous passes wrote but never ran against a live stack (`PRODUCTION_DEPLOYMENT_TODO.md` §2). All of them work on the local two-door simulation (`deploy/README.md`).

**Status 2026-09-15 (branch `docker-smoke-tests` — see §5b):** every item
below was run and passed except: the **backup/restore rehearsal** (still to
do), the **red-team run** and **Project Moonshot** (testing exercises, still
to do), and `verify-twodoor.mjs` against the full two-door overlay (the
twodoor nginx image itself was built and boot-tested standalone). Three of
the passing tests only passed after real fixes — see the §5b findings table.

- Rate limiting returns a real **429** after 30 requests/60 s.
- **Usage quota**: set `LLM_DAILY_COST_CAP_USD` low, cross it, confirm refusal + `USAGE_QUOTA_EXCEEDED` row.
- **EICAR** file through both upload endpoints → rejected; clean file → accepted (item 49).
- **`ats_app` role**: run `infra/postgres-init/01-create-app-role.sh`, switch `DATABASE_URL`, confirm `prisma migrate deploy` still works (item 8).
- `docker build --target production` for API and web; `--target twodoor` for the nginx image; `node deploy/scripts/verify-twodoor.mjs`.
- **`security_events`** migration applied; failed login + permission-denied request land as rows (item 25).
- **2FA e-mail** actually delivers after the nodemailer 6→10 bump (item 9).
- **Backup/restore rehearsal** (items 28/30): `pg_dump` the local DB, restore into a fresh container, `mc mirror` the MinIO bucket — this is exactly the procedure to repeat on L40, so a local dry run is real evidence.
- Pin `minio/minio` and `clamav/clamav` to digests obtained from `docker inspect` (item 23).
- **Build the three worker images** (`docker compose build worker openface3-worker pyfeat-worker`) and run one recording job end-to-end — the non-root change was written without Docker (items 8, 50).
- **MFA gate**: set `MFA_REQUIRED_ROLES=admin,teacher` locally, sign in as an un-enrolled teacher, confirm the redirect to Account Security and that students are unaffected (item 12).
- **Node 24 images**: `docker build --target production` for API and web on the new base (item 23).
- **Red-team run (item 60)**: point the item 59 payloads at the live Bedrock model using the existing `.env` credentials and record outcomes.
- **Project Moonshot (item 66)** can be run locally against `https://student.gals.test:8443`.

### 6c. Paperwork you can start now

- Send `/terms` text (`apps/web/src/pages/Terms.tsx`) and `docs/DATA_INVENTORY.md` to SMU legal/PDPA for review and final classification (the biometric category — recordings, gaze, pupil, facial AUs — is _Sensitive_).
- NDA/PDPA undertakings for every team member and collaborator (item 34).
- Put the quarterly access review (item 13) and annual restore test / pen test (items 30, 52) on a calendar; name the incident-response contact tree (item 39).
- Decide item 63 (redact vs log-only) and item 42 (whether SMU wants a support arrangement for the OSS stack).
- The workbook's hidden _Business Requirements_ tab (PDPA questions 2.1–2.9) was not requested but IITS may ask for it; the answers are derivable from `DATA_INVENTORY.md`.

## 7. What must be done when installing on L40 (with IITS)

Ordered roughly as the runbook (`docs/two-door/runbook-l40.md`) proceeds.

**Host (IITS + you)**

1. Named accounts only, `sudo` via approval, SSH keys, MFA on SSH, root login disabled (items 1, 10, 12).
2. OS hardened to CIS benchmark; Docker Engine + Compose ≥ 2.24 (item 50).
3. IITS host anti-malware agent, DLP agent, and SIEM log-shipping agent installed (items 27, 36, 48).
4. Full-disk / data-volume encryption (LUKS/dm-crypt) on the volume holding `postgres_data`, `minio_data` and backups (item 32).
5. Host patching enrolled in the IITS patch-tracking tool (item 46); Docker json-file log rotation configured for ≥ 30 days or journald (item 26).

**Network (IITS)** 6. DNS for the student hostname → host public IP; staff hostname → VPN-side IP or none (SSH tunnel option). 7. Firewall: only 443 (and 80 for ACME) inbound to the public door; 9443/admin door **never** on 0.0.0.0; outbound to the Bedrock region, SMTP, Let's Encrypt (item 47). 8. IITS WAF in front of the public door where applicable (item 22).

**Application configuration (you)** 9. Root `.env` from `.env.example`: Postgres credentials, **MinIO root credentials** (now required — no default), `JWT_SECRET`, **`ENCRYPTION_KEY`** (set before the first secret is ever encrypted), `ENV_MASTER_KEY` if using `.env.enc`, SMTP, Bedrock credentials/region, **`LLM_DAILY_COST_CAP_USD`**, **`MFA_REQUIRED_ROLES=admin,teacher`** (tell staff they will be asked to enrol 2FA on first sign-in), `NODE_ENV=production`. 10. `deploy/.env.twodoor.l40`: hostnames, `GALS_STUDENT_PUBLISH=0.0.0.0:443`, `GALS_HTTP_PUBLISH=0.0.0.0:80`, `GALS_ADMIN_PUBLISH=127.0.0.1:9443` (or VPN IP), `GALS_ALLOWED_ORIGINS`, `GALS_CERT_DIR`, `GALS_ADMIN_ACCESS_FILE`, `GALS_API_BUILD_TARGET=production`. 11. `/srv/gals/admin-access.conf` with campus/VPN CIDRs + `deny all` (item 47). 12. Certificates: Let's Encrypt via the `:80` ACME block or SMU institutional certs; renewal timer that copies + `nginx -s reload` (item 33). 13. `POSTGRES_APP_PASSWORD` set; run `01-create-app-role.sh`; switch `DATABASE_URL` to `ats_app` (items 1, 8).

**Deploy & verify** 14. `./deploy/scripts/twodoor.sh l40 up -d --build`, then `prisma migrate deploy` (the production entrypoint does not migrate). 15. Run the §6b smoke tests on the real host (429, EICAR, security_events rows, 2FA e-mail, quota); `verify-twodoor.mjs`; from outside the VPN the admin host must not connect and `/api/health` on the student door must be 404. 16. Create the first admin on the private door; enable MFA on it; provision teachers.

**Backups & assurance** 17. Cron/systemd timers for daily `pg_dump` + MinIO sync; off-site target agreed with IITS; retention 4 w daily / 12 w weekly (items 28–31). 18. **Restore test before go-live** and annually; record the result (item 30). 19. IITS SAST/DAST scan of the release (item 20); penetration test before go-live (item 52). 20. Bedrock Guardrail created in the SMU AWS account (content filters, sensitive-information policy agreed with the PDPA office, blocked message), then set **`BEDROCK_GUARDRAIL_ID`** / **`BEDROCK_GUARDRAIL_VERSION`** — the API already attaches it to every call (items 62, 63); red-team and Moonshot runs recorded (items 60, 66). 21. First quarterly account review scheduled (item 13); disposal procedure filed for project end (item 38).

## 8. Files produced

- `security_check/SMU Cybersecurity Checklist for Research - 20260904 - GALS response.xlsx` — original workbook with column D (C/NC/NA) and column E (elaboration) filled for rows 1–66, regenerated after the remediation pass (55 C / 10 NC / 1 NA). Patched at the XML level so the dropdown validations, hidden IITS tabs, styles and _Summary_ formulas are untouched; the workbook is flagged to recalculate on open so the _Summary_ counts refresh. The original file is unchanged.
- `security_check/GALS_SECURITY_AUDIT_REPORT.md` — this report.
