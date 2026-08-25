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

// Must precede the TotpService import below: ts-jest compiles each
// `import` to a `require()` in source order, so this mock has to be
// registered before that require() pulls in `ioredis` transitively.
jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn(() => mockRedisInstance) }));

import { authenticator } from 'otplib';
import { TotpService } from './totp.service';

function createConfig() {
  return { getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379') };
}

describe('TotpService', () => {
  let service: TotpService;

  beforeEach(() => {
    redisState.clear();
    redisTtl.clear();
    jest.clearAllMocks();
    // Distinct JWT_SECRET per test doesn't matter here — getOrThrow is
    // called twice (REDIS_URL, JWT_SECRET); return the same string for both.
    service = new TotpService(createConfig() as any);
  });

  it('generateSetup returns a secret and a data-URI QR code', async () => {
    const { secret, qrCodeDataUrl } = await service.generateSetup('user-1', 'user1@example.com');
    expect(secret).toMatch(/^[A-Z2-7]+$/); // base32
    expect(qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('confirmSetup succeeds with a real code computed from the pending secret', async () => {
    const { secret } = await service.generateSetup('user-1', 'user1@example.com');
    const code = authenticator.generate(secret);

    const encrypted = await service.confirmSetup('user-1', code);
    expect(encrypted.split(':')).toHaveLength(3); // iv:authTag:ciphertext

    // A subsequent login-time check against the encrypted secret succeeds
    // with a freshly generated code — round-trips through encrypt+decrypt.
    const loginCode = authenticator.generate(secret);
    expect(service.verifyLoginCode(encrypted, loginCode)).toBe(true);
  });

  it('confirmSetup rejects a wrong code without consuming the pending secret — the real code still works after', async () => {
    const { secret } = await service.generateSetup('user-1', 'user1@example.com');
    await expect(service.confirmSetup('user-1', '000000')).rejects.toThrow('Incorrect code.');

    const code = authenticator.generate(secret);
    await expect(service.confirmSetup('user-1', code)).resolves.toEqual(expect.any(String));
  });

  it('confirmSetup rejects when no setup is pending', async () => {
    await expect(service.confirmSetup('user-1', '123456')).rejects.toThrow(
      'Setup expired. Please scan the QR code again.',
    );
  });

  it('confirmSetup locks out after 5 wrong attempts and clears the pending secret', async () => {
    const { secret } = await service.generateSetup('user-1', 'user1@example.com');

    for (let i = 0; i < 4; i++) {
      await expect(service.confirmSetup('user-1', '000000')).rejects.toThrow('Incorrect code.');
    }
    await expect(service.confirmSetup('user-1', '000000')).rejects.toThrow(
      'Too many incorrect attempts. Please scan the QR code again.',
    );

    // Pending secret is gone now — even the real code fails, must restart setup.
    const code = authenticator.generate(secret);
    await expect(service.confirmSetup('user-1', code)).rejects.toThrow(
      'Setup expired. Please scan the QR code again.',
    );
  });

  it('verifyLoginCode returns false for an incorrect code', async () => {
    const { secret } = await service.generateSetup('user-1', 'user1@example.com');
    const encrypted = await service.confirmSetup('user-1', authenticator.generate(secret));
    expect(service.verifyLoginCode(encrypted, '000000')).toBe(false);
  });
});
