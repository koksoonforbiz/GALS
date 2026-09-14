#!/bin/sh
set -e

# Checklist item 4 — opt-in encrypted-.env decrypt step. No-op (exits 0
# immediately) unless ENV_MASTER_KEY is set — see
# scripts/decrypt-env-boot.js's doc comment for the full contract.
node scripts/decrypt-env-boot.js

exec node dist/main
