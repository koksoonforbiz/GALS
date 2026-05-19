#!/bin/sh
set -e

# Always regenerate Prisma client in dev — the prisma/ folder is volume-mounted
# so the schema may have changed since the Docker image was built.
echo "Generating Prisma client..."
pnpm exec prisma generate

echo "Running database migrations..."
pnpm exec prisma migrate deploy || echo "WARNING: prisma migrate deploy failed (exit $?). Continuing anyway..."

echo "Starting API in watch mode..."
exec pnpm exec nest start --watch
