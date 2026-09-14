jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
}));

import * as bcrypt from 'bcryptjs';
import { BadRequestException } from '@nestjs/common';
import { PasswordHistoryService } from './password-history.service';

function createMockPrisma() {
  return {
    user: { findUnique: jest.fn() },
    passwordHistory: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(undefined),
      deleteMany: jest.fn().mockResolvedValue(undefined),
    },
  };
}

describe('PasswordHistoryService.assertNotReused', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: PasswordHistoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    service = new PasswordHistoryService(prisma as any);
  });

  it('rejects a password that matches the current hash', async () => {
    prisma.user.findUnique.mockResolvedValue({ passwordHash: 'current-hash' });
    (bcrypt.compare as jest.Mock).mockImplementation(
      async (_pw: string, hash: string) => hash === 'current-hash',
    );

    await expect(service.assertNotReused('user-1', 'reused-password')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a password that matches one of the last 3 historical hashes', async () => {
    prisma.user.findUnique.mockResolvedValue({ passwordHash: 'current-hash' });
    prisma.passwordHistory.findMany.mockResolvedValue([
      { passwordHash: 'old-hash-1' },
      { passwordHash: 'old-hash-2' },
      { passwordHash: 'old-hash-3' },
    ]);
    (bcrypt.compare as jest.Mock).mockImplementation(
      async (_pw: string, hash: string) => hash === 'old-hash-2',
    );

    await expect(service.assertNotReused('user-1', 'reused-password')).rejects.toThrow(
      /last 3 passwords/,
    );
  });

  it('allows a password that matches none of the current or historical hashes', async () => {
    prisma.user.findUnique.mockResolvedValue({ passwordHash: 'current-hash' });
    prisma.passwordHistory.findMany.mockResolvedValue([{ passwordHash: 'old-hash-1' }]);
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(service.assertNotReused('user-1', 'brand-new-password')).resolves.toBeUndefined();
  });

  it('queries history limited to the last 3 entries, newest first', async () => {
    prisma.user.findUnique.mockResolvedValue({ passwordHash: 'current-hash' });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await service.assertNotReused('user-1', 'brand-new-password');

    expect(prisma.passwordHistory.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { passwordHash: true },
    });
  });
});

describe('PasswordHistoryService.recordReplaced', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: PasswordHistoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    service = new PasswordHistoryService(prisma as any);
  });

  it('appends the replaced hash and trims history down to the last 3 entries', async () => {
    prisma.passwordHistory.findMany.mockResolvedValue([{ id: 'h4' }, { id: 'h3' }, { id: 'h2' }]);

    await service.recordReplaced('user-1', 'just-replaced-hash');

    expect(prisma.passwordHistory.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', passwordHash: 'just-replaced-hash' },
    });
    expect(prisma.passwordHistory.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', id: { notIn: ['h4', 'h3', 'h2'] } },
    });
  });
});
