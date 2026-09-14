const redisState = new Map<string, string>();
const redisTtl = new Map<string, number>();

const mockRedisInstance = {
  get: jest.fn(async (key: string) => redisState.get(key) ?? null),
  incrbyfloat: jest.fn(async (key: string, amount: number) => {
    const next = (Number(redisState.get(key)) || 0) + amount;
    redisState.set(key, String(next));
    return String(next);
  }),
  expire: jest.fn(async (key: string, seconds: number) => {
    redisTtl.set(key, seconds);
    return 1;
  }),
  quit: jest.fn(async () => undefined),
};

// Must precede the service import below: ts-jest compiles each `import`
// to a `require()` in source order, so this mock has to be registered
// before that require() pulls in `ioredis` transitively.
jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn(() => mockRedisInstance) }));

import { HttpException } from '@nestjs/common';
import { LlmUsageQuotaService } from './llm-usage-quota.service';

function createConfig(dailyCapUsd?: string) {
  return {
    get: jest.fn((key: string) => (key === 'LLM_DAILY_COST_CAP_USD' ? dailyCapUsd : undefined)),
    getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379'),
  };
}

function createSecurityEvents() {
  return { record: jest.fn() };
}

describe('LlmUsageQuotaService', () => {
  beforeEach(() => {
    redisState.clear();
    redisTtl.clear();
    jest.clearAllMocks();
  });

  describe("when LLM_DAILY_COST_CAP_USD is unset (default — matches today's behavior)", () => {
    it('never blocks, regardless of recorded spend', async () => {
      const service = new LlmUsageQuotaService(
        createConfig() as any,
        createSecurityEvents() as any,
      );
      await service.recordSpend('teacher-1', 9999);
      await expect(service.assertNotExceeded('teacher-1')).resolves.toBeUndefined();
    });

    it('still records spend so the counter is warm if a cap is turned on later', async () => {
      const service = new LlmUsageQuotaService(
        createConfig() as any,
        createSecurityEvents() as any,
      );
      await service.recordSpend('teacher-1', 2.5);
      expect(mockRedisInstance.incrbyfloat).toHaveBeenCalledWith(expect.any(String), 2.5);
    });
  });

  describe('when LLM_DAILY_COST_CAP_USD is set', () => {
    it('allows calls while under the cap', async () => {
      const service = new LlmUsageQuotaService(
        createConfig('10') as any,
        createSecurityEvents() as any,
      );
      await service.recordSpend('teacher-1', 4);
      await expect(service.assertNotExceeded('teacher-1')).resolves.toBeUndefined();
    });

    it('blocks with a 429 once cumulative spend reaches the cap', async () => {
      const service = new LlmUsageQuotaService(
        createConfig('10') as any,
        createSecurityEvents() as any,
      );
      await service.recordSpend('teacher-1', 6);
      await service.recordSpend('teacher-1', 4); // total now exactly 10
      await expect(service.assertNotExceeded('teacher-1')).rejects.toThrow(HttpException);
      await expect(service.assertNotExceeded('teacher-1')).rejects.toMatchObject({
        status: 429,
      });
    });

    it('does not block a different user sharing no state with the one over cap', async () => {
      const service = new LlmUsageQuotaService(
        createConfig('10') as any,
        createSecurityEvents() as any,
      );
      await service.recordSpend('teacher-1', 50);
      await expect(service.assertNotExceeded('teacher-2')).resolves.toBeUndefined();
    });

    it('sets a ~25h TTL on the first spend recorded for a given day', async () => {
      const service = new LlmUsageQuotaService(
        createConfig('10') as any,
        createSecurityEvents() as any,
      );
      await service.recordSpend('teacher-1', 1);
      expect(mockRedisInstance.expire).toHaveBeenCalledWith(expect.any(String), 25 * 60 * 60);
    });

    it('does not re-set the TTL on subsequent spends the same day', async () => {
      const service = new LlmUsageQuotaService(
        createConfig('10') as any,
        createSecurityEvents() as any,
      );
      await service.recordSpend('teacher-1', 1);
      await service.recordSpend('teacher-1', 1);
      expect(mockRedisInstance.expire).toHaveBeenCalledTimes(1);
    });

    it('ignores zero/negative amounts (never blocks on a $0 template-mode call)', async () => {
      const service = new LlmUsageQuotaService(
        createConfig('10') as any,
        createSecurityEvents() as any,
      );
      await service.recordSpend('teacher-1', 0);
      expect(mockRedisInstance.incrbyfloat).not.toHaveBeenCalled();
    });

    it('treats an invalid (non-numeric, zero, or negative) cap as unconfigured', async () => {
      const service = new LlmUsageQuotaService(
        createConfig('not-a-number') as any,
        createSecurityEvents() as any,
      );
      await service.recordSpend('teacher-1', 9999);
      await expect(service.assertNotExceeded('teacher-1')).resolves.toBeUndefined();
    });
  });

  describe('USAGE_QUOTA_EXCEEDED security-event recording', () => {
    it('records exactly once, on the spend that first crosses the cap', async () => {
      const securityEvents = createSecurityEvents();
      const service = new LlmUsageQuotaService(createConfig('10') as any, securityEvents as any);
      await service.recordSpend('teacher-1', 6); // under cap — no event
      expect(securityEvents.record).not.toHaveBeenCalled();
      await service.recordSpend('teacher-1', 5); // crosses to 11 — event fires
      expect(securityEvents.record).toHaveBeenCalledTimes(1);
      expect(securityEvents.record).toHaveBeenCalledWith({
        type: 'USAGE_QUOTA_EXCEEDED',
        userId: 'teacher-1',
        metadata: { dailyCapUsd: 10, totalSpentUsd: 11 },
      });
    });

    it('does not record again on further spend after already over the cap', async () => {
      const securityEvents = createSecurityEvents();
      const service = new LlmUsageQuotaService(createConfig('10') as any, securityEvents as any);
      await service.recordSpend('teacher-1', 11); // crosses immediately
      await service.recordSpend('teacher-1', 1); // still over — should NOT fire again
      expect(securityEvents.record).toHaveBeenCalledTimes(1);
    });

    it('never records when no cap is configured', async () => {
      const securityEvents = createSecurityEvents();
      const service = new LlmUsageQuotaService(createConfig() as any, securityEvents as any);
      await service.recordSpend('teacher-1', 9999);
      expect(securityEvents.record).not.toHaveBeenCalled();
    });
  });
});
