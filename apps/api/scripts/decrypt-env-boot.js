#!/usr/bin/env node
'use strict';
// Checklist item 4 — runs at container start, before the app boots.
// Deliberately opt-in and fully backward-compatible: if ENV_MASTER_KEY
// isn't set, this does nothing and the app reads a plaintext `.env`
// exactly as it always has — no behavior change for anyone who hasn't
// deliberately adopted this. Only when an operator has both encrypted
// their `.env` into `.env.enc` (via encrypt-env.js) AND supplied
// ENV_MASTER_KEY does this decrypt it back to `.env` on disk, which
// ConfigModule.forRoot() then reads normally — same as today's
// plaintext-.env behavior from the app's point of view. Idempotent and
// safe to run on every boot.
//
// Not wired into any Node --require/NODE_OPTIONS preload chain
// deliberately — the dev stage runs via `nest start --watch` (its own
// process-management layer, not a bare `node` invocation), so the one
// mechanism that works identically for both `node dist/main` (prod)
// and `nest start --watch` (dev) is: decrypt to a real `.env` file on
// disk as a plain shell step BEFORE either entry point runs, then let
// dotenv/ConfigModule read it exactly as it always has. See
// start-dev.sh and docker-entrypoint.sh for where this is invoked.

const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { decryptEnvContent } = require('./env-crypto-lib');

const masterKey = process.env.ENV_MASTER_KEY;
const encPath = process.argv[2] || '.env.enc';
const outPath = process.argv[3] || '.env';

if (!masterKey) {
  // Not adopted — silent no-op keeps this invisible in every log for
  // everyone who hasn't opted in, matching the "no behavior change
  // unless deliberately configured" contract of ENCRYPTION_KEY/
  // LLM_DAILY_COST_CAP_USD elsewhere in this project.
  process.exit(0);
}

if (!existsSync(encPath)) {
  console.error(
    `ENV_MASTER_KEY is set but ${encPath} does not exist — nothing to decrypt. ` +
      'Run scripts/encrypt-env.js first, or unset ENV_MASTER_KEY to use a plaintext .env.',
  );
  process.exit(1);
}

try {
  const cipherText = readFileSync(encPath, 'utf8');
  const plainText = decryptEnvContent(cipherText, masterKey);
  writeFileSync(outPath, plainText, 'utf8');
  console.log(`Decrypted ${encPath} -> ${outPath}`);
} catch (err) {
  console.error(`Failed to decrypt ${encPath}: ${err.message}`);
  console.error('Wrong ENV_MASTER_KEY, or the file is corrupted.');
  process.exit(1);
}
