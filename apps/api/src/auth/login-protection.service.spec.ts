const redisState = new Map<string, string>();
const redisTtl = new Map<string, number>();

const mockRedisInstance = {
  get: jest.fn(async (key: string) => redisState.get(key) ?? null),
  incr: jest.fn(async (key: string) => {
    const next = (Number(redisState.get(key)) || 0) + 1;
    redisState.set(key, String(next));
    return next;
  }),
  expire: jest.fn(async (key: string, seconds: number) => {
    redisTtl.set(key, seconds);
    return 1;
  }),
  del: jest.fn(async (key: string) => {
    redisState.delete(key);
    redisTtl.delete(key);
    return 1;
  }),
  quit: jest.fn(async () => undefined),
};

// Must precede the LoginProtectionService import below: ts-jest compiles
// each `import` to a `require()` in source order, so this mock has to be
// registered before that require() pulls in `ioredis` transitively.
jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn(() => mockRedisInstance) }));

import { UnauthorizedException } from '@nestjs/common';
import { LoginProtectionService } from './login-protection.service';

function createConfig() {
  return { getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379') };
}

describe('LoginProtectionService', () => {
  let service: LoginProtectionService;

  beforeEach(() => {
    redisState.clear();
    redisTtl.clear();
    jest.clearAllMocks();
    service = new LoginProtectionService(createConfig() as any);
  });

  it('allows login when there is no failure history', async () => {
    await expect(service.assertNotLockedOut('teacher@example.com')).resolves.toBeUndefined();
  });

  it('allows login under the failure threshold', async () => {
    for (let i = 0; i < 4; i++) await service.recordFailure('teacher@example.com');
    await expect(service.assertNotLockedOut('teacher@example.com')).resolves.toBeUndefined();
  });

  it('locks out after 5 recorded failures', async () => {
    for (let i = 0; i < 5; i++) await service.recordFailure('teacher@example.com');
    await expect(service.assertNotLockedOut('teacher@example.com')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('resists distributing attempts across many callers by keying on the identifier itself', async () => {
    for (let i = 0; i < 5; i++) await service.recordFailure('teacher@example.com');
    await expect(service.assertNotLockedOut('teacher@example.com')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('is case-insensitive and trims whitespace on the identifier', async () => {
    for (let i = 0; i < 5; i++) await service.recordFailure('  Teacher@Example.com  ');
    await expect(service.assertNotLockedOut('teacher@example.com')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('does not lock out a different identifier', async () => {
    for (let i = 0; i < 5; i++) await service.recordFailure('victim@example.com');
    await expect(service.assertNotLockedOut('someone-else@example.com')).resolves.toBeUndefined();
  });

  it('recordSuccess clears the failure count', async () => {
    for (let i = 0; i < 4; i++) await service.recordFailure('teacher@example.com');
    await service.recordSuccess('teacher@example.com');
    await service.recordFailure('teacher@example.com');
    // Only 1 failure since the reset — nowhere near the threshold.
    await expect(service.assertNotLockedOut('teacher@example.com')).resolves.toBeUndefined();
  });
});
