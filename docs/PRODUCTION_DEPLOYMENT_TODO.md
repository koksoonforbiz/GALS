# Production Deployment TODO (L40 server)

This consolidates every checklist item and follow-up that's already built but
**not yet active**, plus everything genuinely blocked on having a real server
to configure — nothing here needs code changes, it needs to be _done_ once
the L40 deployment target exists. Work through it before go-live, not after.

## 0. Known broken thing (caught live, needs a real fix)

- [ ] **Pin MinIO to a real, verified tag.** An earlier pass pinned
      `minio/minio` to a specific `RELEASE.*` tag that turned out not to be
      published to Docker Hub — `docker compose up` failed with "not found,"
      caught by an actual run, not by anything checkable from this
      environment. Currently reverted to `minio/minio:latest` (works, but
      unpinned again) in both `docker-compose.yml` and
      `infra/docker-compose.yml`. Fix properly once you have Docker access:
      `docker pull minio/minio:latest`, then
      `docker inspect --format '{{index .RepoDigests 0}}' minio/minio:latest`
      to get the exact digest actually running, and pin to that (or a
      confirmed-real `RELEASE.*` tag from https://hub.docker.com/r/minio/minio/tags).

## 1. Environment variables to set (all currently optional / unset in dev)

| Variable                                  | What it does                                                                                                                                                                                              | Why it matters for production                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENCRYPTION_KEY`                          | Decouples the at-rest encryption key (TOTP secrets, LLM API keys) from `JWT_SECRET`.                                                                                                                      | Checklist item 4. Generate a strong random value (`openssl rand -hex 32`) and set it **before** the first real secret is ever encrypted — switching it later does not re-encrypt existing rows.                                                                                                                                                                        |
| `ENV_MASTER_KEY`                          | Decrypts `.env.enc` back to `.env` at container boot (`docker-entrypoint.sh`/`start-dev.sh`) — a separate concern from `ENCRYPTION_KEY` above (this one protects the `.env` file itself, not DB rows).    | Checklist item 4's "otherwise, minimally encrypted [config files]" fallback clause. Opt-in and off by default — see `.env.example`'s comment and `apps/api/scripts/decrypt-env-boot.js` for the full setup (`encrypt-env.js --generate-key`, then `encrypt-env.js` to produce `.env.enc`). Supply this key via your deploy tool's live secret injection, never a file. |
| `LLM_DAILY_COST_CAP_USD`                  | Per-key-owner (teacher) daily spend cap; refuses further AI calls with a 429 once hit.                                                                                                                    | Checklist item 16 — directly answers "what happens if a user uses too much of the API": today, without this set, nothing stops them. Pick a number based on expected class size × realistic daily usage, with headroom.                                                                                                                                                |
| `MFA_REQUIRED_ROLES`                      | Comma-separated roles that must have 2FA (TOTP/email) enrolled before they can use the app; un-enrolled accounts are routed to Account Security and everything else returns `403 MFA_ENROLMENT_REQUIRED`. | Checklist item 12. Set `admin,teacher` on L40. Unset = today's opt-in behaviour, so existing staff accounts are asked to enrol on their next sign-in after the flag goes live — tell them beforehand.                                                                                                                                                                  |
| `BEDROCK_GUARDRAIL_ID` / `_VERSION`       | Attaches an AWS Bedrock Guardrail to every Converse call; a flagged reply is replaced by the guardrail's blocked message and logged.                                                                      | Checklist items 62/63 (output moderation, PII filtering). Needs a Guardrail resource created in the SMU AWS account first (content filters + sensitive-information policy); code is already wired (`LlmService.bedrockGuardrailConfig`). Version defaults to `DRAFT` — publish a numbered version for production.                                                      |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | Object-store root credentials — now **required** by every compose file (no `minioadmin` fallback anywhere, including the workers).                                                                        | Checklist items 1/4. Generate real values; MinIO is not published on L40 but the credential is still a root credential.                                                                                                                                                                                                                                                |
| `POSTGRES_APP_PASSWORD`                   | Enables the scoped `ats_app` Postgres role (see §3).                                                                                                                                                      | Checklist item 8 — services currently connect as the DB bootstrap superuser.                                                                                                                                                                                                                                                                                           |
| `NODE_ENV=production`                     | Enables Swagger's auto-disable, malware-scanner fail-closed behavior, and other prod-only guards already wired to this flag.                                                                              | Several checklist items assume this is set correctly; verify it explicitly rather than trusting a default.                                                                                                                                                                                                                                                             |
| `CLAMAV_HOST` / `CLAMAV_PORT`             | Points the malware scanner at the `clamav` sidecar.                                                                                                                                                       | Already defaults correctly in `docker-compose.yml` if that service is deployed — just confirm it's actually running (§2).                                                                                                                                                                                                                                              |

## 2. Live smoke tests (built, never run against a real server)

Everything below was written and unit-tested this project, but could not be
exercised against a live Docker/Postgres/Redis stack in the environment this
work was done in. Do these once, right after first deploy:

- [ ] **Rate limiting actually enforces.** Hit any route 30+ times in 60s and
      confirm a real 429 comes back. This was silently broken app-wide until
      a fix this pass (`APP_GUARD` was never bound to `ThrottlerGuard`) — the
      fix is code-reviewed and unit-tested, but the actual HTTP 429 behavior
      has never been observed by a real request.
- [ ] **Usage quota.** Set a low `LLM_DAILY_COST_CAP_USD` temporarily, run
      enough chat calls to cross it, confirm the refusal message, that a
      `USAGE_QUOTA_EXCEEDED` row lands in `security_events`, and that normal
      usage resumes the next UTC day.
- [ ] **Malware scanner.** Upload a real file and an [EICAR test
      string](https://en.wikipedia.org/wiki/EICAR_test_file) through both the
      teacher and student document-upload endpoints; confirm the clean file
      passes and the EICAR file is rejected.
- [ ] **Least-privilege DB role.** Follow
      `infra/postgres-init/01-create-app-role.sh`'s header comment to create
      and switch to the `ats_app` role; confirm the API still connects and
      `prisma migrate deploy` still succeeds.
- [ ] **Non-root production containers.** `docker build --target production`
      for both `apps/api` and `apps/web`; confirm both start and serve
      traffic (the web image also changed its internal port to 8080 — make
      sure whatever fronts it points at the new port).
- [ ] **`security_events` table.** Confirm both migrations applied (the
      table itself, and the later `USAGE_QUOTA_EXCEEDED` enum value), then
      trigger a failed login and a permission-denied request and check rows
      land in the table.
- [ ] **Non-root worker containers.** `docker compose build worker
    openface3-worker pyfeat-worker` — all three now run as uid 10001
      (`worker`). Confirm the openface3 image build still downloads its
      weights (that step now runs as the non-root user into `/models`),
      that py-feat can load/download its models (its `feat/resources`
      dir is chowned to the worker user), and that a recording job
      completes end-to-end. Written blind to Docker in this environment.
- [ ] **Mandatory MFA gate.** With `MFA_REQUIRED_ROLES=admin,teacher`
      set, sign in as a teacher with no 2FA enrolled: every page should
      redirect to Account Security (and any direct API call return
      `403 MFA_ENROLMENT_REQUIRED`) until a factor is enrolled; students
      must be unaffected.
- [ ] **Bedrock Guardrail intervention.** Once `BEDROCK_GUARDRAIL_ID` is
      set, send a prompt the guardrail's content policy blocks; confirm
      the student sees the guardrail's blocked message and the API log
      shows `[Bedrock] guardrail intervened` with the policy trace.
- [ ] **Nodemailer major-version bump (6.x→10.x).** Trigger a real 2FA email
      and confirm delivery — this was a 4-major-version dependency bump
      patched for a CVE, verified only by type-checking and unit tests.

## 3. Decisions that need a human, not more code

These were deliberately left as open product/policy questions rather than
guessed at:

- **Mandatory MFA for teacher/admin roles** (item 12) — _built_
  (`MFA_REQUIRED_ROLES`, see §1) but off by default. The remaining decision
  is only _when_ to flip it on L40 and how staff are told; a locked-out
  colleague is recovered by an admin disabling 2FA for them via the
  existing disable flow, then re-enrolling.
- **PII redaction vs. visibility-only** (item 63) — the in-app detector
  still only logs. Bedrock Guardrails' sensitive-information policy
  (§1, `BEDROCK_GUARDRAIL_ID`) is the intended blocking/masking layer;
  decide the policy (block vs. anonymise, which entity types) with SMU's
  PDPA office when the Guardrail is created.
- **MinIO's shared network** — the browser needs direct access for presigned
  uploads in the current architecture; revisit once the real object-storage
  target (S3? on-prem?) for the L40 deployment is chosen.
- **Output moderation** (item 62) — the code side is done: every Bedrock
  Converse call carries `guardrailConfig` when `BEDROCK_GUARDRAIL_ID` is
  set and an intervention is surfaced/logged. What's missing is the
  **Guardrail resource itself** in the SMU AWS account (content filters,
  denied topics, blocked message) — infrastructure, not code. Until it
  exists, no moderation runs.

## 4. Blocked on infrastructure that doesn't exist yet

Nothing to build here — these need the actual L40 server's OS, network, and
hosting decisions made first, then a short config pass once they are:

- **TLS termination** (item 33) — _built_: the two-door overlay's nginx
  terminates TLS 1.2/1.3 with HSTS (`deploy/nginx/snippets/tls.conf`).
  What remains is issuing the real certificate on the host
  (`docs/two-door/runbook-l40.md` §2.4) and the renewal timer.
- **Root/admin account PAM gating** (item 1) — depends on whatever OS-level
  account the L40 server is administered through (SSH keys? a bastion?
  local sudo?) — not an application concern until that's decided.
- **Host anti-malware, OS hardening to CIS/NIST/SANS benchmarks** (items 48,
  50 remainder) — every application container now runs non-root (`apps/api`,
  `apps/web`, and as of the checklist-fixes pass the three Python ML
  workers — see §2 for the build check that still has to happen). The
  _host OS_ itself still needs a hardening pass once there's a real host
  to harden.
- **Data-at-rest disk/volume encryption** (item 32) — depends on whatever
  storage the L40 server uses (LUKS? a hardware RAID controller? cloud
  block storage?). Two DB fields (TOTP secrets, LLM API keys) already get
  application-level encryption regardless of the underlying disk.
- **Backup execution, off-site retention, restore testing** (items 29-31) —
  the plan itself (item 28: what to back up, frequency, retention tiers) is
  now written in `docs/BACKUP_PLAN.md`. Execution against it can't happen
  until there's a real database/object store to back up and a real off-site
  target — both need the L40 server.
- **Network segmentation matching the real topology** (item 17's remainder) —
  the Docker-network segmentation done this pass (Postgres/Redis isolated
  from the web-facing container) carries over conceptually, but the actual
  firewall/VPC/security-group rules depend on how the L40 server is
  networked, which isn't decided yet.
- **SIEM log shipping, WAF, DLP** (items 22, 27, 36) — all explicitly
  IITS/vendor-provided per the checklist's own wording; nothing in this repo
  can satisfy them regardless of hosting target.
- **Penetration testing, formal vulnerability-remediation SLAs** (items
  51-52) — process commitments to schedule with IITS/a vendor once there's a
  live target to test.

## 5. Still-open dependency findings

Two frameworks have moderate-severity findings with **no same-major patch
available** (checklist item 51's last 3 findings — `react-router-dom 6.30.6`
cleared the other three): NestJS v10→v11 and React Router v6→v7. CI now
fails on any high/critical advisory (`dependency-audit` job) and Dependabot
raises PRs for the rest (`.github/dependabot.yml`), so new findings can't
accumulate silently. The runtime moved from Node 20 (EOL 2026-04-30) to
Node 24 LTS in the same pass (checklist item 23). Both are real, multi-day migrations with breaking API changes
— schedule as dedicated work with a full regression pass, not squeezed into
a pre-launch checklist item. Not urgent (moderate, not critical/high) but
tracked here so it doesn't get lost.
