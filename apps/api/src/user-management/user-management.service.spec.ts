import { ForbiddenException } from '@nestjs/common';
import { UserManagementService } from './user-management.service';

// ─── Helpers ────────────────────────────────────────────

function createMockPrisma(callerRole: string) {
  return {
    user: {
      // First lookup is the caller's role; row lookups (by email /
      // loginId) find no existing user.
      findUnique: jest.fn(({ where }: { where: { id?: string } }) =>
        Promise.resolve(where.id === 'caller-1' ? { role: callerRole } : null),
      ),
      create: jest.fn().mockResolvedValue({ id: 'new-user' }),
    },
    course: { findUnique: jest.fn() },
  };
}

const row = (role?: 'student' | 'teacher' | 'admin') => ({
  email: `${role ?? 'student'}@example.edu`,
  loginId: `${role ?? 'student'}-1`,
  password: 'Str0ng-Passw0rd!',
  ...(role ? { role } : {}),
});

// ─── Tests ──────────────────────────────────────────────

describe('UserManagementService.resetTwoFactor — lost-phone recovery', () => {
  function setup(callerRole: string, targetRole: string, enrolledWithCaller: boolean) {
    const users: Record<string, { id: string; email: string; role: string }> = {
      'caller-1': { id: 'caller-1', email: 'caller@example.edu', role: callerRole },
      'target-1': { id: 'target-1', email: 'target@example.edu', role: targetRole },
    };
    const prisma = {
      user: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(users[where.id] ?? null),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      course: { findMany: jest.fn().mockResolvedValue([{ id: 'course-1' }]) },
      enrollment: {
        findFirst: jest.fn().mockResolvedValue(enrolledWithCaller ? { id: 'enr-1' } : null),
      },
    };
    return { prisma, service: new UserManagementService(prisma as any, {} as any) };
  }

  it('clears every 2FA field when a teacher resets their own student', async () => {
    const { prisma, service } = setup('teacher', 'student', true);
    await expect(service.resetTwoFactor('caller-1', 'target-1')).resolves.toMatchObject({
      userId: 'target-1',
      twoFactorMethod: null,
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { twoFactorMethod: null, twoFactorEnabledAt: null, totpSecret: null },
    });
  });

  it.each([
    ['a student outside their courses', 'teacher', 'student', false],
    ['another teacher', 'teacher', 'teacher', true],
    ['an admin', 'teacher', 'admin', true],
  ])('refuses a teacher resetting %s', async (_label, callerRole, targetRole, enrolled) => {
    const { prisma, service } = setup(callerRole, targetRole, enrolled);
    await expect(service.resetTwoFactor('caller-1', 'target-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('lets an admin reset a teacher', async () => {
    const { prisma, service } = setup('admin', 'teacher', false);
    await service.resetTwoFactor('caller-1', 'target-1');
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('refuses resetting your own account', async () => {
    const { prisma, service } = setup('admin', 'admin', false);
    await expect(service.resetTwoFactor('caller-1', 'caller-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('UserManagementService.bulkProvisionUsers — role escalation', () => {
  it.each(['admin', 'teacher'] as const)(
    'rejects a teacher provisioning a %s account and creates nothing',
    async (role) => {
      const prisma = createMockPrisma('teacher');
      const service = new UserManagementService(prisma as any, {} as any);

      await expect(
        service.bulkProvisionUsers('caller-1', { rows: [row(), row(role)] } as any),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    },
  );

  it('lets a teacher provision students', async () => {
    const prisma = createMockPrisma('teacher');
    const service = new UserManagementService(prisma as any, {} as any);

    const res = await service.bulkProvisionUsers('caller-1', { rows: [row('student')] } as any);
    expect(res.summary.created).toBe(1);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'student' }) }),
    );
  });

  it('lets an admin provision a teacher', async () => {
    const prisma = createMockPrisma('admin');
    const service = new UserManagementService(prisma as any, {} as any);

    const res = await service.bulkProvisionUsers('caller-1', { rows: [row('teacher')] } as any);
    expect(res.summary.created).toBe(1);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'teacher' }) }),
    );
  });
});
