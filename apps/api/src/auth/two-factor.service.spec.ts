const redisState = new Map<string, string>();
const redisTtl = new Map<string, number>();

function createMultiChain() {
  const ops: Array<() => void> = [];
  const chain = {
    set: (key: string, value: string, mode?: string, ttl?: number) => {
      ops.push(() => {
        redisState.set(key, value);
        if (mode === 'EX' && typeof ttl === 'number') redisTtl.set(key, ttl);
      });
      return chain;
    },
    expire: (key: string, seconds: number) => {
      ops.push(() => redisTtl.set(key, seconds));
      return chain;
    },
    del: (key: string) => {
      ops.push(() => {
        redisState.delete(key);
        redisTtl.delete(key);
      });
      return chain;
    },
    exec: async () => {
      ops.forEach((op) => op());
      return [];
    },
  };
  return chain;
}

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
  multi: jest.fn(() => createMultiChain()),
  quit: jest.fn(async () => undefined),
};

// Must precede the TwoFactorService import below: ts-jest compiles each
// `import` to a `require()` in source order, so this mock has to be
// registered before that require() pulls in `ioredis` transitively.
jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn(() => mockRedisInstance) }));

import { UnauthorizedException } from '@nestjs/common';
import { TwoFactorService } from './two-factor.service';

function createConfig() {
  return { getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379') };
}

describe('TwoFactorService — email challenges', () => {
  let service: TwoFactorService;

  beforeEach(() => {
    redisState.clear();
    redisTtl.clear();
    jest.clearAllMocks();
    service = new TwoFactorService(createConfig() as any);
  });

  it('verifies the correct code for a freshly started challenge', async () => {
    const { challengeId, code } = await service.startEmailChallenge('user-1');
    await expect(service.verifyEmailCode(challengeId, code)).resolves.toBe('user-1');
  });

  it('rejects a wrong code', async () => {
    const { challengeId } = await service.startEmailChallenge('user-1');
    await expect(service.verifyEmailCode(challengeId, '000000')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects verification against an unknown or expired challenge id', async () => {
    await expect(service.verifyEmailCode('nonexistent-id', '123456')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('consumes the challenge on success — a second verify with the same code fails', async () => {
    const { challengeId, code } = await service.startEmailChallenge('user-1');
    await service.verifyEmailCode(challengeId, code);
    await expect(service.verifyEmailCode(challengeId, code)).rejects.toThrow(UnauthorizedException);
  });

  it('locks out on the 5th wrong attempt (not the 6th) with a distinct message', async () => {
    const { challengeId, code } = await service.startEmailChallenge('user-1');

    for (let i = 0; i < 4; i++) {
      await expect(service.verifyEmailCode(challengeId, '000000')).rejects.toThrow(
        'Incorrect code.',
      );
    }

    // The 5th wrong guess is the one that reports lockout — MAX_ATTEMPTS
    // wrong guesses are the limit, not MAX_ATTEMPTS + 1.
    await expect(service.verifyEmailCode(challengeId, '000000')).rejects.toThrow(
      'Too many incorrect attempts. Please log in again.',
    );

    // Challenge is gone now, even for the code that would have been correct.
    await expect(service.verifyEmailCode(challengeId, code)).rejects.toThrow(UnauthorizedException);
  });

  it('still succeeds on the final allowed attempt if the code is actually correct', async () => {
    const { challengeId, code } = await service.startEmailChallenge('user-1');

    for (let i = 0; i < 4; i++) {
      await expect(service.verifyEmailCode(challengeId, '000000')).rejects.toThrow(
        UnauthorizedException,
      );
    }

    // 4 wrong guesses used up — the 5th (and final) guess is correct and
    // must still succeed rather than being blocked by the attempt count.
    await expect(service.verifyEmailCode(challengeId, code)).resolves.toBe('user-1');
  });

  it('blocks an immediate resend under the cooldown', async () => {
    const { challengeId } = await service.startEmailChallenge('user-1');
    await expect(service.resend(challengeId)).rejects.toThrow(UnauthorizedException);
  });

  it('resend rotates the code — the old code no longer verifies', async () => {
    const { challengeId, code: oldCode } = await service.startEmailChallenge('user-1');
    // Clear the cooldown set by startEmailChallenge so resend() is allowed.
    redisState.delete('2fa-resend:user-1');

    const { code: newCode, userId } = await service.resend(challengeId);
    expect(userId).toBe('user-1');
    expect(newCode).not.toBe(oldCode);

    await expect(service.verifyEmailCode(challengeId, oldCode)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(service.verifyEmailCode(challengeId, newCode)).resolves.toBe('user-1');
  });

  it('getPending resolves the challenge to its user and method', async () => {
    const { challengeId } = await service.startEmailChallenge('user-1');
    await expect(service.getPending(challengeId)).resolves.toEqual({
      userId: 'user-1',
      method: 'email',
    });
  });

  it('getPending returns null for an unknown challenge', async () => {
    await expect(service.getPending('nonexistent-id')).resolves.toBeNull();
  });
});

describe('TwoFactorService — TOTP challenges', () => {
  let service: TwoFactorService;

  beforeEach(() => {
    redisState.clear();
    redisTtl.clear();
    jest.clearAllMocks();
    service = new TwoFactorService(createConfig() as any);
  });

  it('starts a pending-only challenge tagged with method totp', async () => {
    const { challengeId } = await service.startTotpChallenge('user-1');
    await expect(service.getPending(challengeId)).resolves.toEqual({
      userId: 'user-1',
      method: 'totp',
    });
  });

  it('resend is refused for a TOTP challenge — nothing to resend', async () => {
    const { challengeId } = await service.startTotpChallenge('user-1');
    await expect(service.resend(challengeId)).rejects.toThrow(
      'Authenticator app codes cannot be resent.',
    );
  });

  it('verifyTotpAttempt succeeds and consumes the challenge when the caller reports correct', async () => {
    const { challengeId } = await service.startTotpChallenge('user-1');
    await expect(service.verifyTotpAttempt(challengeId, 'user-1', true)).resolves.toBe('user-1');
    await expect(service.getPending(challengeId)).resolves.toBeNull();
  });

  it('verifyTotpAttempt shares the same 5-attempt lockout as email', async () => {
    const { challengeId } = await service.startTotpChallenge('user-1');

    for (let i = 0; i < 4; i++) {
      await expect(service.verifyTotpAttempt(challengeId, 'user-1', false)).rejects.toThrow(
        'Incorrect code.',
      );
    }
    // The 5th wrong report is the one that reports lockout, same threshold
    // as the email path.
    await expect(service.verifyTotpAttempt(challengeId, 'user-1', false)).rejects.toThrow(
      'Too many incorrect attempts. Please log in again.',
    );
  });

  it('still succeeds on the final allowed attempt if the caller reports correct', async () => {
    const { challengeId } = await service.startTotpChallenge('user-1');

    for (let i = 0; i < 4; i++) {
      await expect(service.verifyTotpAttempt(challengeId, 'user-1', false)).rejects.toThrow(
        UnauthorizedException,
      );
    }
    await expect(service.verifyTotpAttempt(challengeId, 'user-1', true)).resolves.toBe('user-1');
  });
});
