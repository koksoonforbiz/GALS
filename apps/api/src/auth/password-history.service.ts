import { Injectable, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma';

/**
 * SMU checklist item 5 — reuse prevention, shared by every path that
 * sets a password: teacher-driven student resets/bulk-provisioning
 * (user-management.service.ts) and self-service change
 * (auth.service.ts). Extracted so both go through the exact same
 * check rather than maintaining two copies of security-sensitive
 * logic.
 */
@Injectable()
export class PasswordHistoryService {
  static readonly HISTORY_LIMIT = 3;

  constructor(private readonly prisma: PrismaService) {}

  /** Throws if `newPassword` matches the account's current hash or
   *  any of its last HISTORY_LIMIT previous hashes. */
  async assertNotReused(userId: string, newPassword: string): Promise<void> {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    const history = await this.prisma.passwordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: PasswordHistoryService.HISTORY_LIMIT,
      select: { passwordHash: true },
    });
    const priorHashes = [current?.passwordHash, ...history.map((h) => h.passwordHash)].filter(
      (h): h is string => !!h,
    );
    for (const hash of priorHashes) {
      if (await bcrypt.compare(newPassword, hash)) {
        throw new BadRequestException(
          `Password must not match any of the last ${PasswordHistoryService.HISTORY_LIMIT} passwords used on this account`,
        );
      }
    }
  }

  /** Appends the just-replaced hash to history, trimmed to the last N. */
  async recordReplaced(userId: string, replacedHash: string): Promise<void> {
    await this.prisma.passwordHistory.create({ data: { userId, passwordHash: replacedHash } });
    const keep = await this.prisma.passwordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: PasswordHistoryService.HISTORY_LIMIT,
      select: { id: true },
    });
    await this.prisma.passwordHistory.deleteMany({
      where: { userId, id: { notIn: keep.map((k) => k.id) } },
    });
  }
}
