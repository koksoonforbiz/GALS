# EF assessment: deploying to lithium (L40)

How to roll the EF assessment (branch `course-prompting-ef`, Phases 1–8) onto the lithium two-door stack. Read with `docs/two-door/runbook-l40.md`; this file covers only what the EF assessment adds.

**What changes on the server**

| Item                                                          | Kind       | Notes                                                                                                                                                               |
| ------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration `20261022120000_add_ef_assessment_and_course_gates` | additive   | New `course_gates`, `student_gate_completions`, `efa_*` tables; enum values added to `ActivityAction` and `SecurityEventType`. No existing table or column changes. |
| Battery seed (`seed:ef-battery`)                              | one-off    | Loads `docs/EF_battery_v2` (stimuli sha256 `a705e667…`, 60 allocation slots). Idempotent; refuses a changed file unless `--force`.                                  |
| `RESEARCH_EXPORT_SALT`                                        | new secret | Needed by **every** research export (EF and the existing learning-event exports). Now passed to the api container by `docker-compose.yml`.                          |
| `repo-api` image                                              | rebuild    | New API code.                                                                                                                                                       |
| `repo-nginx` image                                            | rebuild    | New student/admin bundles **and** the nginx allowlist (`/api/puzzles/` allowed on the public door, `/api/efa-admin/` and `/api/course-gates/` denied).              |

Nothing else (postgres, redis, minio, clamav, workers) changes.

## Constraints (from the first deployment)

- VPN + SSH key + **one OTP per SSH connection** (the "SMU server" authenticator entry, not the GALS one). One attempt per code; repeated rejects lock SSH for a while. Batch the server steps into as few connections as possible.
- Rootless Docker: `export DOCKER_HOST=unix:///run/user/1001/docker.sock`.
- Registries are blocked: **build images on the laptop** (WSL Docker) and stream them over SSH.
- After building, stop the laptop's local dev containers (`gals-milestone-1-monorepo-*`): their nginx takes 127.0.0.1:8443/9443 and shadows the SSH tunnel.

## 1. Laptop: test and build

```sh
# all tests green on the commit you deploy
pnpm --filter @ats/api test
pnpm check:two-door && pnpm --filter @ats/web lint:boundaries

# build the two changed images with the server's project name (repo-*)
GALS_API_BUILD_TARGET=production \
  COMPOSE_PROJECT_NAME=repo ./deploy/scripts/twodoor.sh local build api nginx
mkdir -p ~/gals-images
docker save repo-api repo-nginx | gzip > ~/gals-images/gals-efa-$(git rev-parse --short HEAD).tar.gz
sha256sum ~/gals-images/gals-efa-*.tar.gz
```

The code must also be on the server's checkout. Push the branch to the `gals` remote first (never `origin`); the server pulls from there.

## 2. Server: one connection for transfer + backup

```sh
# from the laptop (WSL): stream the image archive, then check the hash on the server
cat ~/gals-images/gals-efa-<sha>.tar.gz | ssh lithium 'mkdir -p ~/gals-images && cat > ~/gals-images/gals-efa-<sha>.tar.gz && sha256sum ~/gals-images/gals-efa-<sha>.tar.gz'
```

Then, in an SSH session on lithium:

```sh
export DOCKER_HOST=unix:///run/user/1001/docker.sock
cd ~/gals/repo

# 2.1 database backup before migrating
mkdir -p ~/gals-backups
./deploy/scripts/twodoor.sh l40 exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  | gzip > ~/gals-backups/pre-efa-$(date +%Y%m%d-%H%M).sql.gz

# 2.2 code and images
git fetch gals && git checkout <commit>
gunzip -c ~/gals-images/gals-efa-<sha>.tar.gz | docker load

# 2.3 the export salt — generated on the server, never printed or pasted in chat
grep -q '^RESEARCH_EXPORT_SALT=.\{16,\}' .env || \
  printf 'RESEARCH_EXPORT_SALT=%s\n' "$(openssl rand -hex 24)" >> .env
```

**Back up the salt with the other secrets** (e.g. copy `.env` to the encrypted backup location). Never change it during a study: a new salt gives every student a new pseudonym, and exports no longer join across time points.

## 3. Migrate, start, seed

```sh
# migration in a one-off container from the new image
./deploy/scripts/twodoor.sh l40 run --rm --no-deps -T --entrypoint sh api \
  -c 'npx --no-install prisma migrate deploy'

./deploy/scripts/twodoor.sh l40 up -d --no-build api nginx
./deploy/scripts/twodoor.sh l40 ps

# battery: dry run first, then the real seed (docs folder bind-mounted read-only)
./deploy/scripts/twodoor.sh l40 run --rm --no-deps -T -v "$PWD/docs/EF_battery_v2:/efa:ro" \
  --entrypoint sh api -c 'pnpm run seed:ef-battery -- --dir /efa --dry-run'
./deploy/scripts/twodoor.sh l40 run --rm --no-deps -T -v "$PWD/docs/EF_battery_v2:/efa:ro" \
  --entrypoint sh api -c 'pnpm run seed:ef-battery -- --dir /efa'
```

The seed output must show stimuli sha256 `a705e66707fb0f67f7d73241957dc12b73a0c61eca0b204584d251a97e2dd832` and 60 allocation slots. Before seeding, check the checkout has not been reformatted: `sha256sum docs/EF_battery_v2/source/stimuli.json`.

`docs/EF_battery_v2/pdf/` (facilitator sheets with answers) is not in git and must not be copied to the server.

## 4. Verify

```sh
STUDENT_URL=https://127.0.0.1:8443 ADMIN_URL=https://127.0.0.1:9443 \
  node deploy/scripts/verify-twodoor.mjs --insecure

# public door: staff EF routes are closed, student routes need a login
curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1:8443/api/efa-admin/courses/x/settings   # 404
curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1:8443/api/course-gates/courses/x         # 404
curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1:8443/api/puzzles/courses/x/occasions/T0 # 401
```

Then in the browser, through the tunnel:

1. **Staff door** → the course → Settings → _EF assessment (puzzles)_ → **Settings**: T0 before Session 1, T2 after the last session (T1 off unless wanted), all seven puzzles → **Save settings**. The _Gates in this course_ table shows four gates.
2. **Raters** tab: at least two staff for W4 and for W5.
3. **Student door** with a test student: the course page shows the checklist and Session 1 locked; run the questionnaire and at least one puzzle; reload once mid-puzzle (it must move on to the next puzzle).
4. **Progress** tab shows that student, the administration log, and the interrupted puzzle; **Reset…** it with a reason, or **Unlock…** the gate.
5. **Coding and exports**: download `Occasions.csv`. A "needs RESEARCH_EXPORT_SALT" error means step 2.3 did not reach the container (`up -d` again after editing `.env`).
6. Remove the test student's EF data before the class starts (or use a separate test course).

## 5. Operating notes

- An occasion with no activity for 24 h **expires**; the student sees "please contact your instructor". Staff **Reopen…** it in Progress (audited), or **Unlock…** the gate.
- **Reset…** a puzzle only on an open occasion; the new attempt shows the same items and is flagged `items_reexposed`.
- Unlock, reset and reopen require a reason and are recorded in `security_events` (`GATE_OVERRIDE`, `EF_TASK_RESET`).
- Students who decline the notice stay at the gate (decision Q7); there is no skip.
- If a new T0 cannot get a form ("not available yet"), the 60 allocation slots are used up: extend `allocation.csv` and re-seed.
- The puzzles allow 3000 requests/min per client IP and route, so a lab behind one NAT address can run them together.

## 6. Rollback

- **Turn the assessment off:** in Settings, untick the occasions and save. Gates nobody passed are removed; gates with completions stay as not required, so no student is blocked.
- **Previous version:** `git checkout <previous commit>`, `docker load` the previous `repo-api`/`repo-nginx` archive, `up -d --no-build api nginx`. The migration is additive, so the old code runs with the new tables in place. Do not roll the migration back while EF data exists; restore the pre-EF backup (2.1) only if the data is to be discarded.
