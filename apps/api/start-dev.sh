#!/bin/sh
set -e

# Checklist item 4 — opt-in encrypted-.env-at-rest support. No-op
# unless ENV_MASTER_KEY is set, so this changes nothing for the
# existing dev workflow unless someone deliberately opts in — see
# scripts/decrypt-env-boot.js's doc comment.
node scripts/decrypt-env-boot.js

# Always regenerate Prisma client in dev — the prisma/ folder is volume-mounted
# so the schema may have changed since the Docker image was built.
echo "Generating Prisma client..."
pnpm exec prisma generate

echo "Running database migrations..."
pnpm exec prisma migrate deploy || echo "WARNING: prisma migrate deploy failed (exit $?). Continuing anyway..."

echo "Seeding CS 601 assessment..."
pnpm exec ts-node --transpile-only -P tsconfig.json prisma/scripts/seed-cs601-assessment.ts || echo "WARNING: assessment seed failed (exit $?). Continuing anyway..."

echo "Starting API in watch mode..."
exec pnpm exec nest start --watch
