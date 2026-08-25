import { Injectable, Logger, OnModuleDestroy, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { sanitizeForLog } from '../common';

const MAX_FAILURES = 5;
const WINDOW_SECONDS = 15 * 60;

/**
 * Account-keyed brute-force protection, separate from the IP-keyed
 * @Throttle on POST /auth/login. IP throttling alone lets an attacker
 * distribute a brute-force across many source addresses and get a fresh
 * budget against the same account from each one — this closes that gap by
 * tracking failures against the identifier itself (email/loginId), so the
 * limit follows the account no matter where the requests come from.
 */
@Injectable()
export class LoginProtectionService implements OnModuleDestroy {
  private readonly logger = new Logger(LoginProtectionService.name);
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'));
  }

  private key(identifier: string): string {
    return `login-fail:${identifier.trim().toLowerCase()}`;
  }

  /** Throws UnauthorizedException if this identifier has too many recent failures. */
  async assertNotLockedOut(identifier: string): Promise<void> {
    const count = await this.redis.get(this.key(identifier));
    if (count && Number(count) >= MAX_FAILURES) {
      this.logger.warn(
        `Login blocked — too many recent failures: identifier=${sanitizeForLog(identifier)}`,
      );
      throw new UnauthorizedException('Too many failed login attempts. Please try again later.');
    }
  }

  /** Called after a failed login attempt (wrong password or unknown identifier alike). */
  async recordFailure(identifier: string): Promise<void> {
    const key = this.key(identifier);
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, WINDOW_SECONDS);
    }
  }

  /** Called after a successful login — clears any accumulated failure count. */
  async recordSuccess(identifier: string): Promise<void> {
    await this.redis.del(this.key(identifier));
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
