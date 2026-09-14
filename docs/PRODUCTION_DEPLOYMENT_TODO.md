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

| Variable                      | What it does                                                                                                                                                                                           | Why it matters for production                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENCRYPTION_KEY`              | Decouples the at-rest encryption key (TOTP secrets, LLM API keys) from `JWT_SECRET`.                                                                                                                   | Checklist item 4. Generate a strong random value (`openssl rand -hex 32`) and set it **before** the first real secret is ever encrypted — switching it later does not re-encrypt existing rows.                                                                                                                                                                        |
| `ENV_MASTER_KEY`              | Decrypts `.env.enc` back to `.env` at container boot (`docker-entrypoint.sh`/`start-dev.sh`) — a separate concern from `ENCRYPTION_KEY` above (this one protects the `.env` file itself, not DB rows). | Checklist item 4's "otherwise, minimally encrypted [config files]" fallback clause. Opt-in and off by default — see `.env.example`'s comment and `apps/api/scripts/decrypt-env-boot.js` for the full setup (`encrypt-env.js --generate-key`, then `encrypt-env.js` to produce `.env.enc`). Supply this key via your deploy tool's live secret injection, never a file. |
| `LLM_DAILY_COST_CAP_USD`      | Per-key-owner (teacher) daily spend cap; refuses further AI calls with a 429 once hit.                                                                                                                 | Checklist item 16 — directly answers "what happens if a user uses too much of the API": today, without this set, nothing stops them. Pick a number based on expected class size × realistic daily usage, with headroom.                                                                                                                                                |
| `POSTGRES_APP_PASSWORD`       | Enables the scoped `ats_app` Postgres role (see §3).                                                                                                                                                   | Checklist item 8 — services currently connect as the DB bootstrap superuser.                                                                                                                                                                                                                                                                                           |
| `NODE_ENV=production`         | Enables Swagger's auto-disable, malware-scanner fail-closed behavior, and other prod-only guards already wired to this flag.                                                                           | Several checklist items assume this is set correctly; verify it explicitly rather than trusting a default.                                                                                                                                                                                                                                                             |
| `CLAMAV_HOST` / `CLAMAV_PORT` | Points the malware scanner at the `clamav` sidecar.                                                                                                                                                    | Already defaults correctly in `docker-compose.yml` if that service is deployed — just confirm it's actually running (§2).                                                                                                                                                                                                                                              |

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
- [ ] **Nodemailer major-version bump (6.x→10.x).** Trigger a real 2FA email
      and confirm delivery — this was a 4-major-version dependency bump
      patched for a CVE, verified only by type-checking and unit tests.

## 3. Decisions that need a human, not more code

These were deliberately left as open product/policy questions rather than
guessed at:

- **Mandatory MFA for teacher/admin roles** (item 9) — currently opt-in.
- **Password expiry / forced first-login change** (item 5) — investigated and
  found to have been _deliberately removed_ in an earlier change (students
  have no self-service password-change flow at all); re-adding it reverses
  that decision and needs sign-off, not a unilateral rebuild.
- **PII redaction vs. visibility-only** (item 63) — a detector flags likely
  PII in AI replies today but doesn't redact, because redacting fights the
  grounding system's "faithfully reproduce the source" instruction. Pick a
  side once there's a real legal/PDPA read on this.
- **MinIO's shared network** — the browser needs direct access for presigned
  uploads in the current architecture; revisit once the real object-storage
  target (S3? on-prem?) for the L40 deployment is chosen.
- **Output moderation** (item 62) — removed the OpenAI Moderation API path
  along with OpenAI as a generation provider (product decision: Bedrock
  only); no moderation runs today. The Bedrock-native option is **AWS
  Bedrock Guardrails**, which needs a Guardrail resource actually
  provisioned in the AWS account first — infrastructure, not code.

## 4. Blocked on infrastructure that doesn't exist yet

Nothing to build here — these need the actual L40 server's OS, network, and
hosting decisions made first, then a short config pass once they are:

- **TLS termination** (item 33) — needs a reverse proxy (nginx/Caddy/Traefik)
  in front of the app with a real certificate. Local dev is correctly plain
  HTTP (browsers already treat `localhost` as a secure context); this is
  purely a "put something in front of it" task once the server's hostname/IP
  is known.
- **Root/admin account PAM gating** (item 1) — depends on whatever OS-level
  account the L40 server is administered through (SSH keys? a bastion?
  local sudo?) — not an application concern until that's decided.
- **Host anti-malware, OS hardening to CIS/NIST/SANS benchmarks** (items 48,
  50 remainder) — this pass hardened the two containers where it was safe to
  do without live verification (`apps/api` and `apps/web` production
  stages now run non-root); the _host OS_ itself and the three Python ML
  worker containers (which need runtime writes for model downloads and video
  processing — confirmed by reading their Dockerfiles, not guessed) still
  need a hardening pass once there's a real host to harden.
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
available** (checklist item 51's last 6 findings): NestJS v10→v11 and React
Router v6→v7. Both are real, multi-day migrations with breaking API changes
— schedule as dedicated work with a full regression pass, not squeezed into
a pre-launch checklist item. Not urgent (moderate, not critical/high) but
tracked here so it doesn't get lost.
