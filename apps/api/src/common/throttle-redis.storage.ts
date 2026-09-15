import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';
import { validateEnv } from '../env';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

@Injectable()
export class ThrottlerRedisStorage implements ThrottlerStorage, OnModuleDestroy {
  private redis: Redis;

  constructor() {
    const env = validateEnv();
    this.redis = new Redis(env.REDIS_URL);
  }

  // @nestjs/throttler v6 delegates the block decision to the storage: the
  // guard only throws 429 when this returns isBlocked=true (it passes limit
  // and blockDuration in for exactly that purpose). The previous version of
  // this method hardcoded isBlocked=false, which silently disabled rate
  // limiting app-wide — counts and X-RateLimit-* headers looked right, but
  // requests over the limit were never rejected (caught by the §2 live
  // smoke test). timeToExpire/timeToBlockExpire are in seconds, matching
  // the library's own in-memory storage.
  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const blockKey = `${key}:blocked`;
    const blockTtlMs = await this.redis.pttl(blockKey);
    if (blockTtlMs > 0) {
      const secs = Math.ceil(blockTtlMs / 1000);
      return {
        totalHits: limit + 1,
        timeToExpire: secs,
        isBlocked: true,
        timeToBlockExpire: secs,
      };
    }

    const totalHits = await this.redis.incr(key);
    if (totalHits === 1) {
      await this.redis.pexpire(key, ttl);
    }
    const ttlRemainingMs = await this.redis.pttl(key);
    const timeToExpire = Math.ceil(Math.max(ttlRemainingMs, 0) / 1000);

    if (totalHits > limit) {
      await this.redis.set(blockKey, '1', 'PX', blockDuration);
      return {
        totalHits,
        timeToExpire,
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockDuration / 1000),
      };
    }

    return { totalHits, timeToExpire, isBlocked: false, timeToBlockExpire: 0 };
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
