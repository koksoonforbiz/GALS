# Two-Door — Config Inventory (Phase 0 artifact 3 of 3)

Every place a hostname, origin, URL, port, or seed mechanism is configured or embedded. Branch `splitting_builds` at `ca30e33`. **READ-ONLY** — nothing changed.

## 1. How the web client addresses the API

| Site                                                              | Value                                                                                                                   | Two-door impact                                                                                                                                      |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/api.ts:1`                                       | `const API_BASE = '/api'` — **relative, same-origin already**                                                           | ✅ None. Every `api.*` HTTP call already goes through whatever serves the page.                                                                      |
| `apps/web/src/lib/socket.ts:8–13`                                 | `io(import.meta.env.VITE_API_URL \|\| 'http://localhost:3000', { path: '/socket.io' })` — **absolute**                  | ❌ Phase 2: must become same-origin in production builds (drop the URL arg, or use `window.location.origin`). Grading namespace. Sends no auth.      |
| `apps/web/src/pages/student/DialogueLearning.tsx:213–224`         | `io(\`${VITE_API_URL \|\| 'http://localhost:3000'}/dialogue\`, { path: '/socket.io', auth: { token } })` — **absolute** | ❌ Phase 2: same fix. Dialogue namespace. Already sends the JWT in `auth`.                                                                           |
| `apps/web/src/pages/teacher/student-logs/tabs/ReplayTab.tsx:1629` | `import.meta.env.DEV` (dev-only branch)                                                                                 | None.                                                                                                                                                |
| Any other `import.meta.env` / `VITE_*`                            | **None.** These three are the only reads in the app.                                                                    | `VITE_API_URL` is not set in `docker-compose.yml` today, so both socket sites already fall back to `localhost:3000` — which only works in local dev. |

**Frontend `/health` page** (`pages/Health.tsx:14`) fetches `/api/health` relatively.

## 2. Dev proxy — the pattern every nginx door must replicate

`apps/web/vite.config.ts` (the entire dev story; **plain HTTP**, no HTTPS — the spec's "self-signed HTTPS" claim is stale):

```
apiTarget   = DOCKER_ENV==='1' ? 'http://api:3000'   : 'http://localhost:3000'
minioTarget = DOCKER_ENV==='1' ? 'http://minio:9000' : 'http://localhost:9000'
proxy:
  /api        → apiTarget   (changeOrigin)
  /socket.io  → apiTarget   (changeOrigin, ws: true)
  /s3         → minioTarget (changeOrigin, rewrite: strip leading /s3)
```

`docker-compose.yml:119` sets `DOCKER_ENV: "1"` on the `web` service. Three locations, all same-origin from the browser's point of view. **The existing production `apps/web/nginx.conf` only replicates the first one** — see §6.

## 3. ★ MinIO presigned URLs — exactly what the browser receives

`apps/api/src/blob/blob.service.ts`:

- Two S3 clients, **both** pointed at the _internal_ endpoint (`BLOB_STORAGE_ENDPOINT` = `http://minio:9000` in compose), `forcePathStyle: true` (lines 46–62).
- `getPresignedUploadUrl` / `getPresignedDownloadUrl` (lines 133–157) sign against the internal endpoint, then `toRelativePath()` (lines 163–170) **rewrites the absolute URL to `/s3<path><query>`** — e.g. `/s3/ats-blobs/<key>?X-Amz-Algorithm=…&X-Amz-Signature=…`.
- Design comment (lines 53–56): _"signatures must be generated against the internal endpoint to avoid signature/host mismatches"_ — i.e. the proxy that receives `/s3/...` **must forward `Host: minio:9000`** (the exact host the signature was computed for) after stripping `/s3`. `changeOrigin: true` in Vite does this. In nginx: `proxy_pass http://minio:9000/;` (trailing slash strips the prefix) + `proxy_set_header Host minio:9000;` — **not `$host`**. Get this wrong and every upload/download fails SigV4 with a 403 (the orphaned-branch history has a "SigV4 host mismatch" fix for precisely this).
- **Consequence for two-door: the browser never sees a MinIO hostname.** No SDK public-URL configuration is needed. Both doors need one `location /s3/` proxy to the internal MinIO. This is far simpler than the spec feared — but it is still a functional blocker if the location is missing or the Host header is wrong (§F test 1: webcam segment upload + PDF download).
- `BLOB_STORAGE_PUBLIC_ENDPOINT` (`env.ts:49–53`, compose line 37 with the comment "used to sign presigned URLs") is **read into a field and never used** (`blob.service.ts:31,37` are its only references). Dead config with a misleading comment — do not rely on it; consider removing in Phase 3.

Which flows use it (all through `/s3/`): recording segment uploads (`POST /api/recording/segments/initiate` returns the presigned PUT), course PDF downloads (`GET /api/items/:id/download-url`), student-uploaded documents (`/api/student-rag/documents/:id/presign`), attempt blobs (`/api/blobs/presign/*`), teacher item uploads (`POST /api/items/:id/upload-url`, admin door only).

## 4. CORS and origins (API)

- `apps/api/src/main.ts:94–97`: `enableCors({ origin: ALLOWED_ORIGINS.split(','), credentials: true })`.
- `ALLOWED_ORIGINS` (`env.ts:54–57`) defaults to `http://localhost:5173`; compose passes `${ALLOWED_ORIGINS:-http://localhost:5173}`.
- Under two-door, every browser request is same-origin through nginx, so HTTP CORS never triggers. Keep `ALLOWED_ORIGINS` set to the two door origins anyway (harmless, and correct if anything ever calls cross-origin).
- Socket.IO gateways all declare `cors: true` (wildcard) — see `api-classification.md` §Socket.IO.

## 5. Environment variables the API validates (`apps/api/src/env.ts`)

`NODE_ENV`, `PORT`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `BLOB_STORAGE_ENDPOINT`, `BLOB_STORAGE_BUCKET`, `BLOB_STORAGE_ACCESS_KEY`, `BLOB_STORAGE_SECRET_KEY`, `BLOB_STORAGE_REGION` (default `us-east-1`), `BLOB_STORAGE_PUBLIC_ENDPOINT` (optional, unused), `ALLOWED_ORIGINS`, `SMTP_HOST/PORT/USER/PASS/FROM`. Read elsewhere via `ConfigService` (not in the schema): `ENCRYPTION_KEY`, `ENV_MASTER_KEY`, `LLM_DAILY_COST_CAP_USD`, `AWS_BEARER_TOKEN`, `AWS_REGION`, `CLAMAV_HOST/PORT`, `POSTGRES_APP_PASSWORD`, `MFA_REQUIRED_ROLES`, `BEDROCK_GUARDRAIL_ID/VERSION`. None of these embed a public hostname. The `.env` encryption path (`scripts/decrypt-env-boot.js`) is opt-in and unaffected.

## 6. Current Docker topology (dev) and the production baseline

`docker-compose.yml` (dev profile, `target: development` for `api` and `web`):

| Service                             | Published ports today | Networks                    |
| ----------------------------------- | --------------------- | --------------------------- |
| `api`                               | **3000**              | `local-dev`, `internal-net` |
| `web` (Vite)                        | **5173**              | `local-dev`                 |
| `worker`                            | **8000**              | `local-dev`, `internal-net` |
| `pyfeat-worker`, `openface3-worker` | —                     | `local-dev`, `internal-net` |
| `postgres`                          | **5432**              | `internal-net`              |
| `redis`                             | **6379**              | `internal-net`              |
| `minio`                             | **9000, 9001**        | `local-dev`                 |
| `clamav`                            | —                     | `internal-net`              |

The two-door profile must publish **none** of these — only the nginx container. Note `minio` is on `local-dev` (browser-reachable in dev via the Vite proxy) and **not** on `internal-net`; nginx must join whichever network reaches `minio:9000` and `api:3000`.

**Production baseline — `apps/web/Dockerfile` production stage + `apps/web/nginx.conf`:** `nginxinc/nginx-unprivileged:1.30-alpine`, listens **8080**, serves `dist/`, and has **one** proxy location: `/api → http://api:3000`. It does **not** proxy `/socket.io` or `/s3`. So the current single-door production image already breaks dialogue/grading sockets and every MinIO upload/download (a `/s3/...` request falls through `try_files` to `index.html`). This matches the earlier audit note that the non-root web build has never run end-to-end. The two-door templates must not inherit this — each door needs all three locations — and the pre-split config kept "deployable" for rollback should be understood as _buildable_, not _known-working_.

Also relevant: `apps/api/Dockerfile` production stage runs `docker-entrypoint.sh` (the opt-in `.env` decrypt step) then `node dist/main` as non-root `node`; the dev stage runs `start-dev.sh`.

## 7. Database seeding — for the two-door profile's "one teacher, one student, one course with content"

Two mechanisms exist; **neither satisfies the requirement on its own**:

| Mechanism                                           | Trigger                                             | Creates                                                                                                                                                                                            | Gap                                                                                                                                                                                                                                            |
| --------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/prisma/scripts/seed-cs601-assessment.ts`  | `start-dev.sh:19` on every **dev** boot (`ts-node`) | An admin/teacher (`SEED_ADMIN_EMAIL`/`_PASSWORD`/`_NAME` env, defaults `admin@gals.local` / `Admin1234!`), course "CS 601", an assessment + questions. Idempotent (finds existing by title/email). | **No student, no enrollment, no modules/items/PDFs.** Not run by the production entrypoint.                                                                                                                                                    |
| `POST /api/dev/seed` (`grading/seed.controller.ts`) | Manual HTTP call                                    | Teacher + student (`password123`), course, enrollment, one topic + question.                                                                                                                       | **No modules/items/PDF content.** Hard-gated `NODE_ENV === 'development'`, so **unusable** in a production-topology profile. `password123` fails the current 12-char complexity policy for any _new_ set/reset, but login doesn't re-check it. |

Phase 3 needs an explicit, opt-in seed step for the two-door profile that adds: a student account, an enrollment, and at least one module item with a real PDF uploaded to MinIO (so §F.1 "course view loads content and PDFs" and the `/s3/` download path can actually be exercised). It must be a deliberate command, never automatic, because §E.4 forbids dev seed data on the L40. **[HUMAN DECISION]**: extend `seed-cs601-assessment.ts` behind a flag vs. a new `seed-twodoor-local.ts`.

## 8. Local two-door simulation — an OS nuance to confirm

`vite.config.ts:38–45` documents that the source tree lives on a Windows filesystem mounted into **WSL2** (`/mnt/d/...`, polling watch). If the "Linux" host for the two-door profile is WSL2 on this same laptop with the browser running on Windows: WSL2's localhost forwarding covers `127.0.0.1` only, so loopback aliases `127.0.0.2`/`127.0.0.3` inside WSL2 are **not reachable from a Windows browser**. In that case the two-port fallback (`:8443` public, `:9443` internal, both on `127.0.0.1`) is the workable choice and the per-IP `listen` binding gets its final check on the L40. If it is a separate Linux machine (or the browser runs inside WSL2/WSLg), loopback aliases work natively. **Confirm before Phase 3.**

## 9. Summary of what Phase 2/3 must change (config-wise) — and what they must not

Must change: the two absolute socket URLs (§1); split `Sidebar` nav arrays (route-table.md); nginx templates carrying `/api`, `/socket.io`, `/s3` on both doors with the exact MinIO `Host` header (§3); a two-door compose profile with no published backend ports (§6); an opt-in seed (§7).

Must not change: `lib/api.ts` (already relative), `blob.service.ts` signing design (already correct for a proxied `/s3/`), `ALLOWED_ORIGINS` handling, any env var name, the `.env`-encryption entrypoint, workers, Prisma.
