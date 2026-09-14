import { Injectable, Logger, OnModuleDestroy, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { SecurityEventService } from '../auth/security-event.service';

/**
 * Per-key-owner daily spend cap — a cost circuit breaker, not a
 * per-minute rate limit (that's `@Throttle()` on the routes, which
 * only bounds request *frequency*, not cumulative *cost*; a caller
 * that stays under a 10/60s limit for hours can still run up an
 * unbounded bill with nothing else in place). Answers the production
 * question directly: what happens if a user (or the students sharing
 * their configured key) burns through a huge amount of API spend?
 * Today: nothing stopped them. After this: further calls are refused
 * once the day's spend crosses `LLM_DAILY_COST_CAP_USD`, until the
 * UTC day rolls over.
 *
 * Deliberately opt-in: unset `LLM_DAILY_COST_CAP_USD` (the default)
 * means no cap is enforced, preserving today's behavior — this is a
 * production-hardening knob to turn on when this deploys somewhere
 * with real usage, not a change to local-dev behavior. Scoped to the
 * user whose credentials/key actually pay for the call (resolved by
 * each `LlmService` call site BEFORE reaching this), not to whichever
 * user gets attributed in `LlmUsageLog` for analytics — a student's
 * chat message is billed against their teacher's key, so the cap
 * tracks the teacher, matching who'd actually see the bill.
 *
 * Same Redis INCR-then-EXPIRE pattern as LoginProtectionService, with
 * INCRBYFLOAT instead of INCR since cost is a dollar amount, not a
 * count. Soft/best-effort by design (check-before, record-after — not
 * atomically reserved), same class of imprecision as the existing
 * per-route rate limiter: a burst of concurrent requests can overshoot
 * the cap slightly. That's an acceptable tradeoff for a circuit
 * breaker; it is not a hard security boundary.
 */
@Injectable()
export class LlmUsageQuotaService implements OnModuleDestroy {
  private readonly logger = new Logger(LlmUsageQuotaService.name);
  private readonly redis: Redis;

  constructor(
    private readonly config: ConfigService,
    private readonly securityEvents: SecurityEventService,
  ) {
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'));
  }

  private dailyCapUsd(): number | null {
    const raw = this.config.get<string>('LLM_DAILY_COST_CAP_USD');
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private key(userId: string): string {
    // UTC calendar-day bucket — simple, predictable, self-cleaning.
    const day = new Date().toISOString().slice(0, 10);
    return `llm-daily-cost:${userId}:${day}`;
  }

  /** Throws a 429 if this user's key has already spent the configured
   *  daily cap. No-op (always passes) when the cap is unconfigured.
   *  Deliberately does NOT write a SecurityEvent on every blocked
   *  retry — that's `recordSpend`'s job, exactly once, at the moment
   *  the cap is first crossed, so re-tries from an already-blocked
   *  caller don't spam the audit table for the rest of the day. */
  async assertNotExceeded(userId: string): Promise<void> {
    const cap = this.dailyCapUsd();
    if (cap === null) return;

    const spent = await this.redis.get(this.key(userId));
    if (spent && Number(spent) >= cap) {
      this.logger.warn(
        `LLM daily cost cap reached: userId=${userId} spent=$${Number(spent).toFixed(2)} cap=$${cap}`,
      );
      throw new HttpException(
        'Daily AI usage limit reached for this account. Try again tomorrow, or contact an administrator if this seems wrong.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Records actual spend after a completed call. Always records
   *  (even if the cap is unconfigured) so the counter is warm and
   *  accurate the moment an operator turns the cap on. */
  async recordSpend(userId: string, costUsd: number): Promise<void> {
    if (!costUsd || costUsd <= 0) return;
    const key = this.key(userId);
    const total = await this.redis.incrbyfloat(key, costUsd);
    const newTotal = Number(total);
    const previousTotal = newTotal - costUsd;
    // First write of the day for this user — set the bucket to expire
    // well after the UTC day rolls over (25h headroom for clock/tz
    // edge cases), so it self-cleans without a cron job.
    if (newTotal === costUsd) {
      await this.redis.expire(key, 25 * 60 * 60);
    }

    // Checklist item 25 — the moment THIS call pushed the day's total
    // over the cap (not every subsequent blocked retry), record it
    // into the queryable security-audit table, not just Logger.warn.
    // "Just crossed" = new total is over cap but the value before this
    // increment wasn't — fires once per user per day, not on repeat.
    const cap = this.dailyCapUsd();
    if (cap !== null && newTotal >= cap && previousTotal < cap) {
      this.securityEvents.record({
        type: 'USAGE_QUOTA_EXCEEDED',
        userId,
        metadata: { dailyCapUsd: cap, totalSpentUsd: newTotal },
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
