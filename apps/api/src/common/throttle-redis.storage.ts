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

  async increment(
    key: string,
    ttl: number,
    _limit: number,
    _blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const totalHits = await this.redis.incr(key);
    if (totalHits === 1) {
      await this.redis.expire(key, Math.ceil(ttl / 1000));
    }
    const ttlRemaining = await this.redis.ttl(key);
    return {
      totalHits,
      timeToExpire: ttlRemaining * 1000,
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
