import { Injectable, Logger, OnModuleDestroy, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt, randomUUID, createHash } from 'crypto';
import Redis from 'ioredis';

const CODE_TTL_SECONDS = 5 * 60;
const RESEND_COOLDOWN_SECONDS = 45;
const MAX_ATTEMPTS = 5;

type TwoFactorMethod = 'email' | 'totp';

interface Challenge {
  challengeId: string;
  code: string;
}

interface ResendResult extends Challenge {
  userId: string;
}

interface Pending {
  userId: string;
  method: TwoFactorMethod;
}

/**
 * 2FA login-challenge state, for BOTH methods. Email-OTP mints a real code
 * (hashed, held in Redis — see startEmailChallenge); TOTP has no code to
 * mint (the secret lives encrypted in Postgres, checked by AuthService via
 * TotpService), so its challenge is just a pending->user pointer tagged
 * with the method (see startTotpChallenge). Either way, `challengeId` is
 * the opaque handle the client carries from /auth/login through to
 * /auth/2fa/verify, and both methods share the exact same attempt-count/
 * lockout logic (resolveAttempt) so brute-forcing either is equally hard.
 */
@Injectable()
export class TwoFactorService implements OnModuleDestroy {
  private readonly logger = new Logger(TwoFactorService.name);
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'));
  }

  private otpKey(userId: string): string {
    return `2fa-otp:${userId}`;
  }

  private attemptsKey(userId: string): string {
    return `2fa-attempts:${userId}`;
  }

  private resendKey(userId: string): string {
    return `2fa-resend:${userId}`;
  }

  private pendingKey(challengeId: string): string {
    return `2fa-pending:${challengeId}`;
  }

  private hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  /** Resolves a challengeId to its owning user + method, without consuming it. */
  async getPending(challengeId: string): Promise<Pending | null> {
    const raw = await this.redis.get(this.pendingKey(challengeId));
    if (!raw) return null;
    return JSON.parse(raw) as Pending;
  }

  /**
   * Starts a fresh email-OTP challenge for userId: generates a 6-digit
   * code, stores its hash + a method-tagged challenge->user pointer in
   * Redis, and returns the challengeId and plaintext code so the caller
   * can email the code and hand the id back to the client. The plaintext
   * code is never persisted.
   */
  async startEmailChallenge(userId: string): Promise<Challenge> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const challengeId = randomUUID();
    const pending: Pending = { userId, method: 'email' };

    await this.redis
      .multi()
      .set(this.otpKey(userId), this.hashCode(code), 'EX', CODE_TTL_SECONDS)
      .set(this.pendingKey(challengeId), JSON.stringify(pending), 'EX', CODE_TTL_SECONDS)
      .del(this.attemptsKey(userId))
      .set(this.resendKey(userId), '1', 'EX', RESEND_COOLDOWN_SECONDS)
      .exec();

    return { challengeId, code };
  }

  /**
   * Starts a TOTP login challenge: just the method-tagged pending pointer
   * — no code to mint or email, since the code lives in the user's
   * authenticator app. AuthService checks it against the encrypted
   * User.totpSecret and reports the result via verifyTotpAttempt.
   */
  async startTotpChallenge(userId: string): Promise<{ challengeId: string }> {
    const challengeId = randomUUID();
    const pending: Pending = { userId, method: 'totp' };

    await this.redis
      .multi()
      .set(this.pendingKey(challengeId), JSON.stringify(pending), 'EX', CODE_TTL_SECONDS)
      .del(this.attemptsKey(userId))
      .exec();

    return { challengeId };
  }

  /**
   * Re-sends a code for an existing EMAIL challenge, subject to a cooldown
   * per user. Rotates the code (new random value, same challengeId) so a
   * captured old email is worthless once a resend happens. Nothing to
   * resend for a TOTP challenge — the code isn't server-generated.
   */
  async resend(challengeId: string): Promise<ResendResult> {
    const pending = await this.getPending(challengeId);
    if (!pending) {
      throw new UnauthorizedException('This code has expired. Please log in again.');
    }
    if (pending.method === 'totp') {
      throw new UnauthorizedException('Authenticator app codes cannot be resent.');
    }
    const { userId } = pending;

    const onCooldown = await this.redis.get(this.resendKey(userId));
    if (onCooldown) {
      throw new UnauthorizedException('Please wait before requesting another code.');
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.redis
      .multi()
      .set(this.otpKey(userId), this.hashCode(code), 'EX', CODE_TTL_SECONDS)
      .expire(this.pendingKey(challengeId), CODE_TTL_SECONDS)
      .del(this.attemptsKey(userId))
      .set(this.resendKey(userId), '1', 'EX', RESEND_COOLDOWN_SECONDS)
      .exec();

    return { challengeId, code, userId };
  }

  /** Verifies a code against an EMAIL challenge. Returns the userId on success. */
  async verifyEmailCode(challengeId: string, code: string): Promise<string> {
    const pending = await this.getPending(challengeId);
    if (!pending) {
      throw new UnauthorizedException('This code has expired. Please log in again.');
    }

    const storedHash = await this.redis.get(this.otpKey(pending.userId));
    const correct = !!storedHash && storedHash === this.hashCode(code);
    return this.resolveAttempt(challengeId, pending.userId, correct);
  }

  /**
   * Applies the shared attempt-count/lockout logic to a TOTP login guess.
   * The caller (AuthService) already computed `isCorrect` by decrypting
   * User.totpSecret and checking it via TotpService — this service never
   * touches Postgres, so it can't verify TOTP correctness itself.
   */
  async verifyTotpAttempt(
    challengeId: string,
    userId: string,
    isCorrect: boolean,
  ): Promise<string> {
    return this.resolveAttempt(challengeId, userId, isCorrect);
  }

  /**
   * Shared by both verify paths. Correct code always succeeds immediately
   * regardless of attempt count. Wrong guesses count toward MAX_ATTEMPTS;
   * `>=` (not `>`) so the MAX_ATTEMPTS-th wrong guess is the one that
   * reports lockout, matching what MAX_ATTEMPTS is documented to mean
   * ("locks out after 5 wrong guesses") instead of silently permitting
   * one extra guess before the message appears.
   */
  private async resolveAttempt(
    challengeId: string,
    userId: string,
    correct: boolean,
  ): Promise<string> {
    if (correct) {
      await this.clear(challengeId, userId);
      return userId;
    }

    const attempts = await this.redis.incr(this.attemptsKey(userId));
    if (attempts === 1) {
      await this.redis.expire(this.attemptsKey(userId), CODE_TTL_SECONDS);
    }
    if (attempts >= MAX_ATTEMPTS) {
      await this.clear(challengeId, userId);
      this.logger.warn(`2FA challenge locked out after too many attempts: userId=${userId}`);
      throw new UnauthorizedException('Too many incorrect attempts. Please log in again.');
    }

    throw new UnauthorizedException('Incorrect code.');
  }

  private async clear(challengeId: string, userId: string): Promise<void> {
    await this.redis
      .multi()
      .del(this.otpKey(userId))
      .del(this.pendingKey(challengeId))
      .del(this.attemptsKey(userId))
      .exec();
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
