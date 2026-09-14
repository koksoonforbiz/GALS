#!/usr/bin/env node
'use strict';
// Checklist item 4 — encrypts a plaintext .env file into .env.enc.
// Usage:
//   ENV_MASTER_KEY=<hex-key> node scripts/encrypt-env.js [source] [dest]
//   node scripts/encrypt-env.js --generate-key
//
// `source` defaults to `.env`, `dest` defaults to `<source>.enc`. Run
// this from apps/api/. The master key is NEVER written to any file by
// this script — supply it via ENV_MASTER_KEY (your shell, CI secret
// store, or deploy tool), and store it somewhere that isn't this repo
// or this container image. Losing it makes .env.enc permanently
// undecryptable — same failure mode as ENCRYPTION_KEY (see
// apps/api/src/common/encryption-key.ts's doc comment).

const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const crypto = require('node:crypto');
const { encryptEnvContent } = require('./env-crypto-lib');

const args = process.argv.slice(2);

if (args.includes('--generate-key')) {
  console.log(crypto.randomBytes(32).toString('hex'));
  console.log('\n^ Save this as ENV_MASTER_KEY somewhere OUTSIDE this repo (a password manager,');
  console.log("  your deploy tool's secret store). It is not written to any file here.");
  process.exit(0);
}

const masterKey = process.env.ENV_MASTER_KEY;
if (!masterKey) {
  console.error('ENV_MASTER_KEY is not set. Generate one first:');
  console.error('  node scripts/encrypt-env.js --generate-key');
  console.error('Then re-run with ENV_MASTER_KEY=<that value> node scripts/encrypt-env.js');
  process.exit(1);
}

const source = args[0] || '.env';
const dest = args[1] || `${source}.enc`;

if (!existsSync(source)) {
  console.error(`Source file not found: ${source}`);
  process.exit(1);
}

const plainText = readFileSync(source, 'utf8');
const cipherText = encryptEnvContent(plainText, masterKey);
writeFileSync(dest, cipherText, 'utf8');

console.log(`Encrypted ${source} -> ${dest}`);
console.log(
  `${dest} is safe to commit/distribute as ciphertext. ${source} stays plaintext locally — ` +
    'do NOT commit it (it already is in .gitignore).',
);
