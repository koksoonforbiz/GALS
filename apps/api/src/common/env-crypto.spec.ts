/**
 * Checklist item 4 — round-trip test for the encrypted-.env-at-rest
 * scheme. Tests the actual module the CLI scripts use
 * (apps/api/scripts/env-crypto-lib.js) rather than a duplicated copy,
 * so this fails if that file's behavior ever drifts from what the
 * scripts actually ship.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { encryptEnvContent, decryptEnvContent, deriveKey } = require('../../scripts/env-crypto-lib');

describe('env-crypto-lib', () => {
  const masterKey = 'a'.repeat(64); // a plausible ENV_MASTER_KEY (hex-looking, but any string works)

  it('round-trips a realistic .env file exactly', () => {
    const plain = [
      'DATABASE_URL=postgresql://ats_user:s3cr3t@localhost:5432/ats_db',
      'JWT_SECRET=dev-secret-change-in-production',
      'SMTP_PASS=app-password-123',
      'AWS_BEARER_TOKEN=bedrock-key-abc',
      '',
    ].join('\n');

    const cipher = encryptEnvContent(plain, masterKey);
    expect(cipher).not.toContain('s3cr3t');
    expect(cipher).not.toContain('dev-secret-change-in-production');

    const decrypted = decryptEnvContent(cipher, masterKey);
    expect(decrypted).toBe(plain);
  });

  it('produces the documented "iv:authTag:ciphertext" hex format', () => {
    const cipher = encryptEnvContent('FOO=bar', masterKey);
    const parts = cipher.split(':');
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part).toMatch(/^[0-9a-f]+$/);
    }
  });

  it('fails to decrypt with the wrong master key (auth tag mismatch)', () => {
    const cipher = encryptEnvContent('SECRET=value', masterKey);
    expect(() => decryptEnvContent(cipher, 'b'.repeat(64))).toThrow();
  });

  it('produces a different ciphertext each time (random IV) even for identical plaintext', () => {
    const a = encryptEnvContent('SAME=content', masterKey);
    const b = encryptEnvContent('SAME=content', masterKey);
    expect(a).not.toBe(b);
    expect(decryptEnvContent(a, masterKey)).toBe('SAME=content');
    expect(decryptEnvContent(b, masterKey)).toBe('SAME=content');
  });

  it('rejects malformed ciphertext instead of silently returning garbage', () => {
    expect(() => decryptEnvContent('not-the-right-format', masterKey)).toThrow(/Malformed/);
  });

  it('deriveKey is deterministic for the same master key', () => {
    expect(deriveKey(masterKey)).toEqual(deriveKey(masterKey));
  });
});
