jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));

import * as bcrypt from 'bcryptjs';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

function createMockPrisma() {
  return { user: { findUnique: jest.fn(), create: jest.fn() } };
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

describe('AuthService.login', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let jwtService: ReturnType<typeof createMockJwtService>;
  let sessionService: ReturnType<typeof createMockSessionService>;
  let loginProtection: ReturnType<typeof createMockLoginProtection>;
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    jwtService = createMockJwtService();
    sessionService = createMockSessionService();
    loginProtection = createMockLoginProtection();
    service = new AuthService(
      prisma as any,
      jwtService as any,
      sessionService as any,
      loginProtection as any,
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
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const result = await service.login({ identifier: 'teacher@example.com', password: 'right' });

    expect(result.accessToken).toBe('signed-jwt');
    expect(result.sessionId).toBe('session-1');
    expect(loginProtection.recordFailure).not.toHaveBeenCalled();
    expect(loginProtection.recordSuccess).toHaveBeenCalledWith('teacher@example.com');
  });

  it('resolves a loginId (non-email) identifier via the loginId column', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'student@example.com',
      loginId: 'stu001',
      passwordHash: 'stored-hash',
      role: 'student',
      name: 'S',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    await service.login({ identifier: 'stu001', password: 'right' });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { loginId: 'stu001' } });
  });
});
