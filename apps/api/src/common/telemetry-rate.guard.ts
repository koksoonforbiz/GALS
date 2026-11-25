import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { getStorageToken, type ThrottlerStorage } from '@nestjs/throttler';

/**
 * Rate limit for learner telemetry (Prompt B, P1; the PI's condition for
 * recording keystroke and clipboard text).
 *
 * The global limit (30 requests per minute) is keyed on the client IP. A lab
 * behind one NAT address shares it, so logging would be refused and lost.
 * Telemetry routes skip the global limit (@SkipThrottle) and use this guard
 * instead: keyed on the signed-in user, after JwtAuthGuard has run, with a
 * budget sized for normal logging (about 20 requests a minute per learner)
 * and room for retries.
 *
 * Over the limit the route answers 429 with Retry-After. The browser keeps
 * the events in its persistent queue and retries after a back-off, so
 * nothing is lost.
 */
export const TELEMETRY_LIMIT_PER_MIN = Number(process.env.TELEMETRY_RATE_PER_MIN) || 600;
const WINDOW_MS = 60_000;

@Injectable()
export class TelemetryRateGuard implements CanActivate {
  constructor(@Inject(getStorageToken()) private readonly storage: ThrottlerStorage) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.NODE_ENV === 'test') return true;
    const req = context.switchToHttp().getRequest<{ user?: { id?: string }; ip?: string }>();
    const who = req.user?.id ? `user:${req.user.id}` : `ip:${req.ip ?? 'unknown'}`;
    const rec = await this.storage.increment(
      `telemetry:${who}`,
      WINDOW_MS,
      TELEMETRY_LIMIT_PER_MIN,
      1_000,
      'telemetry',
    );
    if (!rec.isBlocked) return true;
    const res = context.switchToHttp().getResponse<{ setHeader(k: string, v: string): void }>();
    res.setHeader('Retry-After', String(Math.max(1, rec.timeToExpire)));
    throw new HttpException(
      'Telemetry rate limit reached, retry later',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
