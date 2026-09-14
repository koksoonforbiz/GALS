import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { SecurityEventType, Prisma } from '@prisma/client';

/**
 * Writes to the queryable security-audit table (checklist item 25).
 * Failed logins and permission denials previously only reached
 * application `Logger` output — searchable in container logs, not
 * the database.
 */
@Injectable()
export class SecurityEventService {
  private readonly logger = new Logger(SecurityEventService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Fire-and-forget by design — a logging failure must never break
   *  the auth/authorization flow that triggered it. Callers don't
   *  (and shouldn't) await this. */
  record(event: {
    type: SecurityEventType;
    userId?: string | null;
    identifier?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown>;
  }): void {
    this.prisma.securityEvent
      .create({
        data: {
          type: event.type,
          userId: event.userId ?? null,
          identifier: event.identifier ?? null,
          ipAddress: event.ipAddress ?? null,
          userAgent: event.userAgent ?? null,
          metadata: event.metadata as unknown as Prisma.InputJsonValue | undefined,
        },
      })
      .catch((err) => {
        this.logger.error(
          `Failed to record security event ${event.type}: ${(err as Error).message}`,
        );
      });
  }
}
