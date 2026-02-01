#!/bin/sh
set -e

# Generate Prisma client only if not already present (avoids network download at runtime)
if [ ! -d "node_modules/.prisma/client" ]; then
  echo "Generating Prisma client..."
  pnpm exec prisma generate
else
  echo "Prisma client already generated, skipping."
fi

echo "Running database migrations..."
pnpm exec prisma migrate deploy || echo "WARNING: prisma migrate deploy failed (exit $?). Continuing anyway..."

echo "Starting API in watch mode..."
exec pnpm exec nest start --watch
