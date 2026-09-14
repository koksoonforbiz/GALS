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
function createMockSecurityEvents() {
  return { record: jest.fn() };
}
function createMockPasswordHistory() {
  return {
    assertNotReused: jest.fn().mockResolvedValue(undefined),
    recordReplaced: jest.fn().mockResolvedValue(undefined),
  };
}

describe('AuthService.login', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let jwtService: ReturnType<typeof createMockJwtService>;
  let sessionService: ReturnType<typeof createMockSessionService>;
  let loginProtection: ReturnType<typeof createMockLoginProtection>;
  let twoFactor: ReturnType<typeof createMockTwoFactor>;
  let totp: ReturnType<typeof createMockTotp>;
  let mailer: ReturnType<typeof createMockMailer>;
  let securityEvents: ReturnType<typeof createMockSecurityEvents>;
  let passwordHistory: ReturnType<typeof createMockPasswordHistory>;
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
    securityEvents = createMockSecurityEvents();
    passwordHistory = createMockPasswordHistory();
    service = new AuthService(
      prisma as any,
      jwtService as any,
      sessionService as any,
      loginProtection as any,
      twoFactor as any,
      totp as any,
      mailer as any,
      securityEvents as any,
      passwordHistory as any,
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
      isActive: true,
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
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
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
      isActive: true,
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
      isActive: true,
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
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
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
  let securityEvents: ReturnType<typeof createMockSecurityEvents>;
  let passwordHistory: ReturnType<typeof createMockPasswordHistory>;
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
    securityEvents = createMockSecurityEvents();
    passwordHistory = createMockPasswordHistory();
    service = new AuthService(
      prisma as any,
      jwtService as any,
      sessionService as any,
      loginProtection as any,
      twoFactor as any,
      totp as any,
      mailer as any,
      securityEvents as any,
      passwordHistory as any,
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
      isActive: true,
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
        isActive: true,
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

// Checklist item 5 — self-service password change. No email is ever
// sent by this path (product decision); a fully-locked-out user's only
// recovery remains a teacher/admin reset (user-management.service.ts).
describe('AuthService.changePassword', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let jwtService: ReturnType<typeof createMockJwtService>;
  let sessionService: ReturnType<typeof createMockSessionService>;
  let loginProtection: ReturnType<typeof createMockLoginProtection>;
  let twoFactor: ReturnType<typeof createMockTwoFactor>;
  let totp: ReturnType<typeof createMockTotp>;
  let mailer: ReturnType<typeof createMockMailer>;
  let securityEvents: ReturnType<typeof createMockSecurityEvents>;
  let passwordHistory: ReturnType<typeof createMockPasswordHistory>;
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
    securityEvents = createMockSecurityEvents();
    passwordHistory = createMockPasswordHistory();
    service = new AuthService(
      prisma as any,
      jwtService as any,
      sessionService as any,
      loginProtection as any,
      twoFactor as any,
      totp as any,
      mailer as any,
      securityEvents as any,
      passwordHistory as any,
    );
    (bcrypt.hash as jest.Mock).mockResolvedValue('new-hashed-password');
  });

  it('rejects when the current password is wrong, without touching password history', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      passwordHash: 'stored-hash',
      isTemporaryPassword: false,
      passwordChangedAt: null,
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(service.changePassword('user-1', 'wrong', 'NewPassw0rd!')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(passwordHistory.assertNotReused).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('allows an immediate change when isTemporaryPassword is set, bypassing the minimum-age rule', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      passwordHash: 'stored-hash',
      isTemporaryPassword: true,
      // Reset moments ago — would fail the 3-day minimum age if it applied.
      passwordChangedAt: new Date(),
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    await service.changePassword('user-1', 'temp-password', 'NewPassw0rd!');

    expect(passwordHistory.assertNotReused).toHaveBeenCalledWith('user-1', 'NewPassw0rd!');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        passwordHash: 'new-hashed-password',
        passwordChangedAt: expect.any(Date),
        isTemporaryPassword: false,
      },
    });
    expect(passwordHistory.recordReplaced).toHaveBeenCalledWith('user-1', 'stored-hash');
  });

  it('rejects a voluntary change within the 3-day minimum age window', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      passwordHash: 'stored-hash',
      isTemporaryPassword: false,
      passwordChangedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    await expect(service.changePassword('user-1', 'current', 'NewPassw0rd!')).rejects.toThrow(
      'Please wait',
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('allows a voluntary change once the minimum age has passed, and propagates password-history rejection', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      passwordHash: 'stored-hash',
      isTemporaryPassword: false,
      passwordChangedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    passwordHistory.assertNotReused.mockRejectedValue(
      new Error('Password must not match any of the last 3 passwords used on this account'),
    );

    await expect(service.changePassword('user-1', 'current', 'OldPassw0rd!')).rejects.toThrow(
      'must not match',
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
