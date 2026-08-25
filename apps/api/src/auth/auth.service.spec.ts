jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));

import * as bcrypt from 'bcryptjs';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

function createMockPrisma() {
  return { user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() } };
}
function createMockJwtService() {
  return { sign: jest.fn().mockReturnValue('signed-jwt') };
}
function createMockSessionService() {
  return { openSession: jest.fn().mockResolvedValue('session-1'), closeSession: jest.fn() };
}
function createMockLoginProtection() {
  return {
    assertNotLockedOut: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
    recordSuccess: jest.fn().mockResolvedValue(undefined),
  };
}
function createMockTwoFactor() {
  return {
    startEmailChallenge: jest.fn(),
    startTotpChallenge: jest.fn(),
    resend: jest.fn(),
    getPending: jest.fn(),
    verifyEmailCode: jest.fn(),
    verifyTotpAttempt: jest.fn(),
  };
}
function createMockTotp() {
  return {
    generateSetup: jest.fn(),
    confirmSetup: jest.fn(),
    verifyLoginCode: jest.fn(),
  };
}
function createMockMailer() {
  return { sendOtpEmail: jest.fn().mockResolvedValue(undefined) };
}

describe('AuthService.login', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let jwtService: ReturnType<typeof createMockJwtService>;
  let sessionService: ReturnType<typeof createMockSessionService>;
  let loginProtection: ReturnType<typeof createMockLoginProtection>;
  let twoFactor: ReturnType<typeof createMockTwoFactor>;
  let totp: ReturnType<typeof createMockTotp>;
  let mailer: ReturnType<typeof createMockMailer>;
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    jwtService = createMockJwtService();
    sessionService = createMockSessionService();
    loginProtection = createMockLoginProtection();
    twoFactor = createMockTwoFactor();
    totp = createMockTotp();
    mailer = createMockMailer();
    service = new AuthService(
      prisma as any,
      jwtService as any,
      sessionService as any,
      loginProtection as any,
      twoFactor as any,
      totp as any,
      mailer as any,
    );
  });

  it('checks the account-level lockout before ever touching the database', async () => {
    loginProtection.assertNotLockedOut.mockRejectedValue(
      new UnauthorizedException('Too many failed login attempts. Please try again later.'),
    );

    await expect(
      service.login({ identifier: 'teacher@example.com', password: 'whatever' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(loginProtection.assertNotLockedOut).toHaveBeenCalledWith('teacher@example.com');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('records a failure and rejects on an unknown identifier, without leaking which case it was', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.login({ identifier: 'ghost@example.com', password: 'x' })).rejects.toThrow(
      'Invalid credentials',
    );

    expect(loginProtection.recordFailure).toHaveBeenCalledWith('ghost@example.com');
    expect(loginProtection.recordSuccess).not.toHaveBeenCalled();
  });

  it('records a failure and rejects on a wrong password', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'teacher@example.com',
      passwordHash: 'stored-hash',
      role: 'teacher',
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(
      service.login({ identifier: 'teacher@example.com', password: 'wrong' }),
    ).rejects.toThrow('Invalid credentials');

    expect(loginProtection.recordFailure).toHaveBeenCalledWith('teacher@example.com');
    expect(loginProtection.recordSuccess).not.toHaveBeenCalled();
  });

  it('clears the failure count and returns a session on a correct login', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'teacher@example.com',
      passwordHash: 'stored-hash',
      role: 'teacher',
      name: 'T',
      twoFactorMethod: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const result = await service.login({ identifier: 'teacher@example.com', password: 'right' });

    if (!('accessToken' in result)) {
      throw new Error('expected a full AuthResponse, got a 2FA-pending response');
    }
    expect(result.accessToken).toBe('signed-jwt');
    expect(result.sessionId).toBe('session-1');
    expect(loginProtection.recordFailure).not.toHaveBeenCalled();
    expect(loginProtection.recordSuccess).toHaveBeenCalledWith('teacher@example.com');
  });

  it('returns an email-OTP challenge instead of a session when that method is active', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'teacher@example.com',
      passwordHash: 'stored-hash',
      role: 'teacher',
      name: 'T',
      twoFactorMethod: 'email',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    twoFactor.startEmailChallenge.mockResolvedValue({ challengeId: 'challenge-1', code: '123456' });

    const result = await service.login({ identifier: 'teacher@example.com', password: 'right' });

    expect(result).toEqual({
      twoFactorRequired: true,
      challengeId: 'challenge-1',
      method: 'email',
    });
    expect(mailer.sendOtpEmail).toHaveBeenCalledWith('teacher@example.com', '123456');
    expect(sessionService.openSession).not.toHaveBeenCalled();
  });

  it('returns a TOTP challenge (no email sent) when that method is active', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'teacher@example.com',
      passwordHash: 'stored-hash',
      role: 'teacher',
      name: 'T',
      twoFactorMethod: 'totp',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    twoFactor.startTotpChallenge.mockResolvedValue({ challengeId: 'challenge-2' });

    const result = await service.login({ identifier: 'teacher@example.com', password: 'right' });

    expect(result).toEqual({ twoFactorRequired: true, challengeId: 'challenge-2', method: 'totp' });
    expect(mailer.sendOtpEmail).not.toHaveBeenCalled();
    expect(sessionService.openSession).not.toHaveBeenCalled();
  });

  it('resolves a loginId (non-email) identifier via the loginId column', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'student@example.com',
      loginId: 'stu001',
      passwordHash: 'stored-hash',
      role: 'student',
      name: 'S',
      twoFactorMethod: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    await service.login({ identifier: 'stu001', password: 'right' });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { loginId: 'stu001' } });
  });
});

describe('AuthService.verifyTwoFactor', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let jwtService: ReturnType<typeof createMockJwtService>;
  let sessionService: ReturnType<typeof createMockSessionService>;
  let loginProtection: ReturnType<typeof createMockLoginProtection>;
  let twoFactor: ReturnType<typeof createMockTwoFactor>;
  let totp: ReturnType<typeof createMockTotp>;
  let mailer: ReturnType<typeof createMockMailer>;
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    jwtService = createMockJwtService();
    sessionService = createMockSessionService();
    loginProtection = createMockLoginProtection();
    twoFactor = createMockTwoFactor();
    totp = createMockTotp();
    mailer = createMockMailer();
    service = new AuthService(
      prisma as any,
      jwtService as any,
      sessionService as any,
      loginProtection as any,
      twoFactor as any,
      totp as any,
      mailer as any,
    );
  });

  it('issues a session once an email-OTP challenge verifies', async () => {
    twoFactor.getPending.mockResolvedValue({ userId: 'user-1', method: 'email' });
    twoFactor.verifyEmailCode.mockResolvedValue('user-1');
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'teacher@example.com',
      role: 'teacher',
      name: 'T',
      passwordHash: 'stored-hash',
      twoFactorMethod: 'email',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.verifyTwoFactor({ challengeId: 'challenge-1', code: '123456' });

    expect(twoFactor.verifyEmailCode).toHaveBeenCalledWith('challenge-1', '123456');
    expect(result.accessToken).toBe('signed-jwt');
    expect(result.sessionId).toBe('session-1');
  });

  it('issues a session once a TOTP challenge verifies, checking the decrypted secret', async () => {
    twoFactor.getPending.mockResolvedValue({ userId: 'user-1', method: 'totp' });
    // First findUnique call: AuthService fetches the pending user to check
    // their totpSecret. Second: refetch after twoFactor.verifyTotpAttempt
    // resolves the userId, ahead of issuing the session.
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'user-1', totpSecret: 'encrypted-secret' })
      .mockResolvedValueOnce({
        id: 'user-1',
        email: 'teacher@example.com',
        role: 'teacher',
        name: 'T',
        passwordHash: 'stored-hash',
        twoFactorMethod: 'totp',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    totp.verifyLoginCode.mockReturnValue(true);
    twoFactor.verifyTotpAttempt.mockResolvedValue('user-1');

    const result = await service.verifyTwoFactor({ challengeId: 'challenge-2', code: '654321' });

    expect(totp.verifyLoginCode).toHaveBeenCalledWith('encrypted-secret', '654321');
    expect(twoFactor.verifyTotpAttempt).toHaveBeenCalledWith('challenge-2', 'user-1', true);
    expect(result.accessToken).toBe('signed-jwt');
  });

  it('propagates the underlying rejection when the email challenge is wrong or expired', async () => {
    twoFactor.getPending.mockResolvedValue({ userId: 'user-1', method: 'email' });
    twoFactor.verifyEmailCode.mockRejectedValue(new UnauthorizedException('Incorrect code.'));

    await expect(
      service.verifyTwoFactor({ challengeId: 'challenge-1', code: '000000' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(sessionService.openSession).not.toHaveBeenCalled();
  });

  it('rejects when the challenge id is unknown or expired', async () => {
    twoFactor.getPending.mockResolvedValue(null);

    await expect(
      service.verifyTwoFactor({ challengeId: 'nonexistent', code: '000000' }),
    ).rejects.toThrow('This code has expired. Please log in again.');
    expect(sessionService.openSession).not.toHaveBeenCalled();
  });
});
