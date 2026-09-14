#!/bin/sh
# Checklist item 8 — "services run as least-privilege accounts, not
# root/admin". Today the API/worker/pyfeat-worker/openface3-worker
# containers all connect using POSTGRES_USER, which the official
# postgres image creates as a full SUPERUSER on first boot. This
# script creates a separate, scoped role for those containers to use
# instead — full DML/DDL rights on the app's own tables (so Prisma
# migrations still work), but NOT superuser, CREATEDB, CREATEROLE, or
# REPLICATION.
#
# Idempotent — safe to run more than once.
#
# HOW THIS RUNS:
#   - Fresh environment: mounted into docker-entrypoint-initdb.d/ (see
#     infra/docker-compose.yml and the root docker-compose.yml's
#     `postgres` service), so the official postgres image runs every
#     *.sh file here automatically the FIRST time it initializes an
#     empty data directory. Needs POSTGRES_APP_PASSWORD set in the
#     `postgres` service's environment for that automatic run to work.
#   - Existing environment (a `postgres_data` volume that already has
#     data): Postgres does NOT re-run initdb scripts against an
#     existing data directory. Apply it manually instead:
#       docker compose exec -e POSTGRES_APP_PASSWORD=<value> -T postgres \
#         sh /docker-entrypoint-initdb.d/01-create-app-role.sh
#
# ACTIVATING IT (deliberately not wired into docker-compose.yml's
# default DATABASE_URL — flipping that blind, with no way to verify
# against a live stack, risks breaking every container's DB
# connectivity if this script hasn't actually been applied yet):
#   1. Set POSTGRES_APP_PASSWORD in your .env.
#   2. Run this script against your Postgres instance (see above).
#   3. Change DATABASE_URL in docker-compose.yml (api/worker/
#      pyfeat-worker/openface3-worker) from
#      postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
#      to
#      postgresql://ats_app:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}
#   4. `docker compose up -d --build` and confirm the API still
#      connects AND `prisma migrate deploy` still succeeds (ats_app
#      owns the schema, so DDL should work identically to before).

# NOTE: the official postgres image SOURCES *.sh files in
# docker-entrypoint-initdb.d/ (rather than executing them as a
# subprocess), so this deliberately avoids `set -e` / `exit` — either
# would abort the rest of Postgres's own init sequence, not just this
# script, if something here failed or if the password guard below
# skips the body.

if [ -z "$POSTGRES_APP_PASSWORD" ]; then
  echo "01-create-app-role.sh: POSTGRES_APP_PASSWORD not set — skipping (scoped app role not created)." >&2
else

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ats_app') THEN
      CREATE ROLE ats_app WITH LOGIN PASSWORD '$POSTGRES_APP_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
    ELSE
      ALTER ROLE ats_app WITH LOGIN PASSWORD '$POSTGRES_APP_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
    END IF;
  END
  \$\$;

  -- Ownership transfer (not just GRANT) so ats_app can run Prisma
  -- migrations (CREATE/ALTER/DROP TABLE) without needing superuser.
  ALTER SCHEMA public OWNER TO ats_app;

  -- Covers every table/sequence/function that already exists.
  GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ats_app;
  GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ats_app;
  GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO ats_app;

  -- Covers tables/sequences/functions created by FUTURE migrations
  -- too — without this, every new migration would need a manual GRANT.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO ats_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO ats_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON FUNCTIONS TO ats_app;
EOSQL

echo "01-create-app-role.sh: ats_app role ready."

fi
