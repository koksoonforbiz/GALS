# GALS two-door deployment

Two entry points, one stack (see [docs/two-door/](../docs/two-door/) for the plan, route table, API classification and config inventory):

| Door        | Bundle         | nginx server         | `/api` policy                       | Header sent to API     |
| ----------- | -------------- | -------------------- | ----------------------------------- | ---------------------- |
| **public**  | `dist-student` | `:8443` in-container | default-deny allowlist (135 routes) | `X-GALS-Door: public`  |
| **private** | `dist-admin`   | `:9443` in-container | everything                          | `X-GALS-Door: private` |

Both doors proxy `/socket.io/` (WebSocket) and `/s3/` (presigned MinIO, forwarded with `Host: minio:9000` — the signature depends on it). Only the nginx container is published to the host; Postgres, Redis, MinIO, the API and the worker keep no host ports under the two-door overlay.

## Layout

```
deploy/
  nginx/templates/gals.conf.template   rendered by envsubst (GALS_* only) → /etc/nginx/conf.d/gals.conf
  nginx/snippets/public-api-allowlist.conf   the public door's /api rules (generated from api-classification.md)
  nginx/snippets/{proxy-api*,socket-io,s3-proxy,spa-static,security-headers,tls}.conf
  nginx/admin-access.local.conf        private-door allow/deny (local: allow all; port is loopback)
  nginx/admin-access.l40.example.conf  template for a real allow/deny file
  .env.twodoor.local.example           copy → .env.twodoor.local (gitignored)
  .env.twodoor.l40.example             copy → .env.twodoor.l40   (gitignored)
  scripts/twodoor.sh                   compose wrapper (root .env + door env + both compose files)
  scripts/mkcert-local.sh              locally-trusted certs for *.gals.test → deploy/certs/ (gitignored)
docker-compose.twodoor.yml             overlay: adds nginx, un-publishes everything else
apps/web/Dockerfile  (target: twodoor) builds both bundles into one unprivileged nginx image
apps/api/prisma/scripts/seed-twodoor-local.ts   opt-in click-through fixture
```

## Local simulation (Windows + WSL2 or Linux)

1. **Hosts file** (where the browser runs):
   ```
   127.0.0.1  student.gals.test
   127.0.0.1  admin.gals.test
   ```
2. **Certs** — `./deploy/scripts/mkcert-local.sh` (run where the browser runs so `mkcert -install` trusts the CA there; the files go to `deploy/certs/`).
3. **Env** — `cp deploy/.env.twodoor.local.example deploy/.env.twodoor.local` (defaults are fine). Your root `.env` is still required.
4. **Up** — `./deploy/scripts/twodoor.sh local up -d --build`
5. **Seed** (optional, prints fresh credentials) — `./deploy/scripts/twodoor.sh local exec api pnpm run seed:twodoor`. If the API runs the production image (`GALS_API_BUILD_TARGET=production`, which sets `NODE_ENV=production`), the seed refuses by design — override for the one command: `./deploy/scripts/twodoor.sh local exec -e NODE_ENV=development api pnpm run seed:twodoor`.
6. Open `https://student.gals.test:8443` (student door) and `https://admin.gals.test:9443` (staff door). `https://localhost:8443` / `:9443` also work — each door is the default server on its port.

`./deploy/scripts/twodoor.sh local down` stops it. The plain `docker compose up` dev stack is untouched by any of this.

Requires Docker Compose v2.24+ (`ports: !reset`).

**WSL2 note:** if Docker Engine runs inside WSL2 (no Docker Desktop), WSL shuts the distro down a few seconds after its last process exits — and every container with it. Keep a WSL shell open (or a background `wsl -e sleep infinity`) while the stack should stay up. The `restart: unless-stopped` policies in the overlay bring everything back when the daemon returns, but only the daemon coming back does that.

## What to expect on the public door

- Staff credentials sign in successfully but land on `/wrong-door` ("This sign-in is for students…") with only a sign-out button — there is no link to the staff door, by design.
- `/register`, `/health`, `/teacher/*` do not exist in the bundle; any `/api/user-management/*`, `/api/jobs/*`, `/api/health` etc. return **404** from nginx before reaching the API.
- The seeded PDF renders in the course view: `GET /api/items/:id/download-url` → relative `/s3/...` → nginx → MinIO.

## L40 delta

See the comments in `deploy/.env.twodoor.l40.example`: real hostnames, Let's Encrypt certs in `GALS_CERT_DIR`, public door on `0.0.0.0:443` + `:80` for ACME, private door **not** on the internet (loopback + SSH tunnel, or a VPN-interface IP plus an allow/deny file), `GALS_API_BUILD_TARGET=production`, `NODE_ENV=production`. The full runbook is Phase 7.
