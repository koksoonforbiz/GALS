# Two-Door — L40 deployment runbook (Phase 7)

The L40 host runs exactly the stack that passed `verification-local.md`, with the deltas below. No real hostname, IP, or secret appears in this document or in the repository; they live in the two gitignored files the runbook tells you to create.

## 0. What changes between local and L40

| Concern                  | Local (verified)                                    | L40                                                                                                                     |
| ------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Hostnames                | `student.gals.test`, `admin.gals.test` (hosts file) | real DNS names → `GALS_STUDENT_HOST`, `GALS_ADMIN_HOST`                                                                 |
| TLS                      | mkcert                                              | Let's Encrypt (HTTP-01 through the `:80` server block) or institutional certs                                           |
| Public door bind         | `127.0.0.1:8443`                                    | `0.0.0.0:443` (`GALS_STUDENT_PUBLISH`)                                                                                  |
| HTTP (ACME + redirect)   | `127.0.0.1:8080`                                    | `0.0.0.0:80` (`GALS_HTTP_PUBLISH`)                                                                                      |
| Private door bind        | `127.0.0.1:9443`                                    | **still not the internet**: `127.0.0.1:9443` + SSH tunnel, or `<vpn-interface-ip>:443` + `admin-access.conf` allow/deny |
| API image                | `development` (bind-mounted src)                    | `production`, `NODE_ENV=production` (`GALS_API_BUILD_TARGET`, `GALS_API_NODE_ENV`)                                      |
| Dev seed                 | `pnpm run seed:twodoor`                             | never run — refuses `NODE_ENV=production`; accounts are provisioned through the teacher UI                              |
| MinIO / Postgres / Redis | not published                                       | not published (unchanged)                                                                                               |
| Secrets                  | root `.env`                                         | root `.env` (or `.env.enc` + `ENV_MASTER_KEY`, see `.env.example`), plus the two gitignored door files                  |

Everything else — bundles, nginx allowlist, DoorGuard, socket auth — is byte-for-byte what CI built and the local click-through exercised.

## 1. Prerequisites on the host

- Docker Engine + Compose **v2.24+** (`docker compose version`; `ports: !reset` needs it).
- Ports 80 and 443 free; outbound access to the Bedrock region, SMTP, and Let's Encrypt.
- DNS: the public name resolves to the host's public IP. The staff name resolves to whatever address the private door will be bound to (VPN-side IP), or is not published at all if you use the SSH-tunnel option.
- A deploy user in the `docker` group; the repository cloned at, e.g., `/srv/gals/repo` on the branch/tag that passed CI.
- `/srv/gals/certs/` and `/srv/gals/admin-access.conf` (created below), outside the repo.

## 2. Configuration

1. Root `.env` from `.env.example` — every `:?required` value in `docker-compose.yml` (Postgres creds, `JWT_SECRET`, SMTP, Bedrock token/region). Set `LLM_DAILY_COST_CAP_USD` before real users (checklist item 16). Do not set `ALLOWED_ORIGINS` here — the door file overrides it.
2. `deploy/.env.twodoor.l40` from `deploy/.env.twodoor.l40.example`: hostnames, the three `*_PUBLISH` bindings per the table above, `GALS_ALLOWED_ORIGINS=https://<student-host>,https://<admin-host>`, `GALS_CERT_DIR=/srv/gals/certs`, `GALS_ADMIN_ACCESS_FILE=/srv/gals/admin-access.conf`, `GALS_API_BUILD_TARGET=production`, `GALS_API_NODE_ENV=production`.
3. `/srv/gals/admin-access.conf` from `deploy/nginx/admin-access.l40.example.conf`: `allow <campus/VPN CIDR>; … deny all;` (or leave it "allow all" **only** if the private port is loopback-bound and reached via SSH tunnel).
4. Certificates — first issuance needs the `:80` block up. Bring the stack up once with self-signed placeholders in `/srv/gals/certs` (`openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj "/CN=placeholder" -keyout student.key -out student.crt`, same for `admin`), then run certbot in webroot mode against the `certbot_webroot` volume (`docker compose … exec nginx ls /var/www/certbot` shows the path; `docker volume inspect` gives the host mount), and copy `fullchain.pem`/`privkey.pem` to `student.crt`/`student.key` and `admin.crt`/`admin.key`. `docker compose … exec nginx nginx -s reload` picks them up. Automate renewal with a cron/systemd timer that repeats the copy + reload.

## 3. Deploy

```sh
cd /srv/gals/repo
git fetch && git checkout <tag-or-commit that passed CI>
./deploy/scripts/twodoor.sh l40 up -d --build          # builds both bundles + api production image
./deploy/scripts/twodoor.sh l40 exec api npx prisma migrate deploy   # the production entrypoint does NOT migrate (apps/api/docker-entrypoint.sh)
./deploy/scripts/twodoor.sh l40 ps                     # only nginx has PORTS
```

First-time provisioning: sign in on the **private** door with the initial admin (created via `POST /api/auth/register` on the private door, or the existing bulk-provisioning flow), then create teachers and provision students (login ID + temporary password) from the User Management pages. Students receive their login ID and temporary password out of band and are forced through `/change-password` on first sign-in.

## 4. Verify (same script as local)

```sh
STUDENT_URL=https://<student-host> ADMIN_URL=https://<admin-host-or-tunnel> \
  node deploy/scripts/verify-twodoor.mjs
```

(Real certificates: omit `--insecure`; through an SSH tunnel to `127.0.0.1:9443` the admin cert name won't match — add `--insecure` for that run only.) Then repeat `verification-local.md` §B1–B4 in a browser against the real hostnames; B4.2 becomes: from outside the VPN, `https://<admin-host>` must not connect, and `https://<student-host>/api/health` must be 404.

## 5. Operate

- **Logs**: `./deploy/scripts/twodoor.sh l40 logs -f nginx api`. nginx access logs go to stdout with the door in the `server_name`; DoorGuard/socket refusals are `PERMISSION_DENIED` rows in `security_events` with `reason: PRIVATE_ROUTE_VIA_PUBLIC_DOOR` / `PRIVATE_NAMESPACE_VIA_PUBLIC_DOOR` — a burst of these on the public door is a probe or a misconfigured allowlist.
- **Update**: `git checkout <new tag>` → `twodoor.sh l40 up -d --build` (nginx restarts with the new bundles; sessions survive because JWTs are stateless).
- **Rollback**: `git checkout <previous tag>` → same command. The database is shared across versions; only roll back across a migration if that migration is reversible.
- **Backups**: unchanged from `docs/BACKUP_PLAN.md` — the two-door overlay adds only the `certbot_webroot` volume, which is disposable.
- **Tightening later** (not blocking go-live): a Content-Security-Policy on both doors once the sensing stack's needs are enumerated with the browser open (see `deploy/nginx/snippets/security-headers.conf`); `X-GALS-Door` strict mode (treat a missing header as public) once nothing but nginx can reach the API.

## 6. Rollback of the split itself

The single-bundle image (`apps/web/Dockerfile` target `production`, `apps/web/nginx.conf`) and the plain `docker compose up` stack are untouched by the split. If the two-door stack must be abandoned on the host, `twodoor.sh l40 down` and bring the previous deployment method back; nothing in the database or MinIO was changed by the split.
