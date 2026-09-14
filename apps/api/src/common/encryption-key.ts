import type { ConfigService } from '@nestjs/config';

/**
 * Resolves the secret used to derive every at-rest encryption key in
 * the app (TOTP secrets, per-teacher LLM/Cohere API keys — see
 * `TotpService`, `LlmService`, `EmbeddingService`). Checklist item 4
 * flagged that all of these were derived from `JWT_SECRET` alone —
 * "one secret protects everything," including signing every session
 * token. This decouples them: set `ENCRYPTION_KEY` to use a secret
 * dedicated to encryption, independent of whatever `JWT_SECRET`
 * rotation policy the auth side ends up with.
 *
 * Deliberately opt-in, not a breaking change: unset `ENCRYPTION_KEY`
 * falls back to exactly today's behavior (`JWT_SECRET`), so existing
 * ciphertext already in the database stays decryptable unless an
 * operator explicitly sets the new var — flipping it on an existing
 * deployment without also re-encrypting stored secrets would make
 * them permanently undecryptable, so this only changes behavior when
 * someone deliberately opts in.
 *
 * Fails loudly either way (`getOrThrow`-style) rather than falling
 * back to a public default string — see `LlmService`'s constructor
 * comment for why that matters.
 */
export function resolveEncryptionSecret(config: ConfigService): string {
  const dedicated = config.get<string>('ENCRYPTION_KEY');
  if (dedicated) return dedicated;
  return config.getOrThrow<string>('JWT_SECRET');
}
