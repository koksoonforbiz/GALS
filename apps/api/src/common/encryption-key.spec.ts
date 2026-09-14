import { resolveEncryptionSecret } from './encryption-key';

describe('resolveEncryptionSecret', () => {
  it('prefers ENCRYPTION_KEY when set', () => {
    const config = {
      get: jest.fn().mockReturnValue('dedicated-secret'),
      getOrThrow: jest.fn().mockReturnValue('jwt-secret'),
    } as any;

    expect(resolveEncryptionSecret(config)).toBe('dedicated-secret');
    expect(config.getOrThrow).not.toHaveBeenCalled();
  });

  it('falls back to JWT_SECRET when ENCRYPTION_KEY is unset (default, non-breaking behavior)', () => {
    const config = {
      get: jest.fn().mockReturnValue(undefined),
      getOrThrow: jest.fn().mockReturnValue('jwt-secret'),
    } as any;

    expect(resolveEncryptionSecret(config)).toBe('jwt-secret');
    expect(config.getOrThrow).toHaveBeenCalledWith('JWT_SECRET');
  });

  it('falls back to JWT_SECRET when ENCRYPTION_KEY is an empty string', () => {
    const config = {
      get: jest.fn().mockReturnValue(''),
      getOrThrow: jest.fn().mockReturnValue('jwt-secret'),
    } as any;

    expect(resolveEncryptionSecret(config)).toBe('jwt-secret');
  });

  it('propagates the failure when neither is configured (fails loudly, no public-default fallback)', () => {
    const config = {
      get: jest.fn().mockReturnValue(undefined),
      getOrThrow: jest.fn().mockImplementation(() => {
        throw new Error('JWT_SECRET is not configured');
      }),
    } as any;

    expect(() => resolveEncryptionSecret(config)).toThrow('JWT_SECRET is not configured');
  });
});
