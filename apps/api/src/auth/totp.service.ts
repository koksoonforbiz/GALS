import { Injectable, Logger, OnModuleDestroy, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import Redis from 'ioredis';

const ENCRYPTION_ALGO = 'aes-256-gcm';
const SETUP_TTL_SECONDS = 10 * 60;
const MAX_SETUP_ATTEMPTS = 5;
const ISSUER = 'GALS';

/**
 * TOTP (authenticator-app) enrollment and verification. The secret lives
 * in Redis only until the user proves they scanned it (see confirmSetup);
 * once confirmed, AuthService persists the ciphertext from encrypt() onto
 * User.totpSecret. Never touches Postgres itself — stays a peer of
 * TwoFactorService (Redis-only), with AuthService as the orchestrator that
 * has both DB and Redis access.
 */
@Injectable()
export class TotpService implements OnModuleDestroy {
  private readonly logger = new Logger(TotpService.name);
  private readonly redis: Redis;
  private readonly encryptionKey: Buffer;

  constructor(config: ConfigService) {
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'));
    // Same derivation scheme as LlmService's API-key encryption
    // (apps/api/src/rag/llm.service.ts), distinct salt so key material
    // is independent between the two secrets.
    const secret = config.getOrThrow<string>('JWT_SECRET');
    this.encryptionKey = crypto.scryptSync(secret, 'totp-secret-salt', 32);
  }

  private setupKey(userId: string): string {
    return `2fa-totp-setup:${userId}`;
  }

  private setupAttemptsKey(userId: string): string {
    return `2fa-totp-setup-attempts:${userId}`;
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decrypt(data: string): string {
    const parts = data.split(':');
    const iv = Buffer.from(parts[0]!, 'hex');
    const authTag = Buffer.from(parts[1]!, 'hex');
    const encrypted = Buffer.from(parts[2]!, 'hex');
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  /**
   * Starts (or restarts) enrollment: mints a fresh secret, stashes it in
   * Redis keyed by userId (trusted — caller is JwtAuthGuard-protected, so
   * there's no client-supplied id to spoof, unlike the email challengeId),
   * and returns both the QR code and the raw secret for manual entry.
   */
  async generateSetup(
    userId: string,
    email: string,
  ): Promise<{ secret: string; qrCodeDataUrl: string }> {
    const secret = authenticator.generateSecret();
    await this.redis
      .multi()
      .set(this.setupKey(userId), secret, 'EX', SETUP_TTL_SECONDS)
      .del(this.setupAttemptsKey(userId))
      .exec();

    const otpauthUrl = authenticator.keyuri(email, ISSUER, secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
    return { secret, qrCodeDataUrl };
  }

  /**
   * Confirms enrollment: verifies the first code against the pending
   * secret, applying the same 5-attempt lockout shape as login (see
   * TwoFactorService) so setup is no easier to brute-force than login.
   * Returns the encrypted secret, ready for AuthService to persist.
   */
  async confirmSetup(userId: string, code: string): Promise<string> {
    const secret = await this.redis.get(this.setupKey(userId));
    if (!secret) {
      throw new UnauthorizedException('Setup expired. Please scan the QR code again.');
    }

    if (authenticator.verify({ token: code, secret })) {
      await this.redis.multi().del(this.setupKey(userId)).del(this.setupAttemptsKey(userId)).exec();
      return this.encrypt(secret);
    }

    const attempts = await this.redis.incr(this.setupAttemptsKey(userId));
    if (attempts === 1) {
      await this.redis.expire(this.setupAttemptsKey(userId), SETUP_TTL_SECONDS);
    }
    if (attempts >= MAX_SETUP_ATTEMPTS) {
      await this.redis.multi().del(this.setupKey(userId)).del(this.setupAttemptsKey(userId)).exec();
      this.logger.warn(`TOTP setup locked out after too many attempts: userId=${userId}`);
      throw new UnauthorizedException(
        'Too many incorrect attempts. Please scan the QR code again.',
      );
    }

    throw new UnauthorizedException('Incorrect code.');
  }

  /** Verifies a login-time code against an already-persisted, encrypted secret. */
  verifyLoginCode(encryptedSecret: string, code: string): boolean {
    return authenticator.verify({ token: code, secret: this.decrypt(encryptedSecret) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
