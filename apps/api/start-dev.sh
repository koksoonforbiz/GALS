#!/bin/sh
set -e

echo "Generating Prisma client..."
pnpm exec prisma generate

echo "Running database migrations..."
pnpm exec prisma migrate deploy

echo "Starting API in watch mode..."
exec pnpm exec nest start --watch
