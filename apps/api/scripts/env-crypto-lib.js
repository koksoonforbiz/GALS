'use strict';
// Checklist item 4 — "these secrets must be minimally encrypted if
// stored on local configuration files." Whole-file AES-256-GCM
// encryption for `.env`, so operational secrets (DB password, SMTP
// password, JWT_SECRET, the shared Bedrock credential) never sit in
// plaintext on disk between deploys — only the decrypted copy inside a
// running container's ephemeral filesystem does, same exposure window
// as today's plaintext `.env` already has.
//
// Deliberately a standalone, dependency-free CommonJS script (built-in
// `crypto`/`fs` only, no "type":"module" needed) rather than a NestJS
// provider: the decrypt step has to run BEFORE the app boots (before
// ConfigModule.forRoot() reads `.env` off disk), so it can't depend on
// Nest's DI container existing yet. Same AES-256-GCM scheme and
// `iv:authTag:ciphertext` hex format as LlmService's API-key
// encryption (apps/api/src/rag/llm.service.ts) for consistency, with
// its own key-derivation salt so a shared ENV_MASTER_KEY value never
// collides with an unrelated derived key.

const crypto = require('node:crypto');

const ALGO = 'aes-256-gcm';
const SALT = 'env-file-encryption-salt';

function deriveKey(masterKey) {
  return crypto.scryptSync(masterKey, SALT, 32);
}

function encryptEnvContent(plainText, masterKey) {
  const key = deriveKey(masterKey);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptEnvContent(cipherText, masterKey) {
  const parts = cipherText.trim().split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed .env.enc content — expected "iv:authTag:ciphertext" hex format');
  }
  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = deriveKey(masterKey);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}

module.exports = { deriveKey, encryptEnvContent, decryptEnvContent };
