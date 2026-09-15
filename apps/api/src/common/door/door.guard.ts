import { Injectable, CanActivate, ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@ats/shared';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { SecurityEventService } from '../../auth/security-event.service';
import { DOOR_KEY, requestDoor, type DoorPolicy } from './door.decorator';

interface DoorRequest {
  headers: Record<string, unknown>;
  method: string;
  originalUrl?: string;
  ip?: string;
  user?: { id: string; role: UserRole };
}

/**
 * Two-door defence-in-depth (docs/two-door/, Phase 4).
 *
 * nginx already 404s every non-allowlisted /api path on the public door
 * (deploy/nginx/snippets/public-api-allowlist.conf). This guard makes the
 * API refuse the same routes itself, from the route metadata, so a
 * mistake in the nginx allowlist cannot expose a teacher route — and so
 * the classification lives next to the code it describes.
 *
 * Runs as a global APP_GUARD before any controller guard; it needs no
 * `req.user`, so unauthenticated routes are covered too. Responds 404,
 * matching nginx, so the public door reveals nothing about what exists
 * behind the private one. Only routes coming through the public door are
 * ever affected — see door.decorator.ts for how "public" is determined.
 */
@Injectable()
export class DoorGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly securityEvents: SecurityEventService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<DoorRequest>();
    if (requestDoor(request.headers) !== 'public') return true;

    if (this.isServableOnPublicDoor(context)) return true;

    // A genuine signal: either the nginx allowlist and the code disagree
    // (a bug to fix) or someone is probing the public door with a
    // hand-crafted request. Either way it belongs in the audit table.
    this.securityEvents.record({
      type: 'PERMISSION_DENIED',
      userId: request.user?.id ?? null,
      ipAddress: request.ip,
      metadata: {
        reason: 'PRIVATE_ROUTE_VIA_PUBLIC_DOOR',
        method: request.method,
        path: request.originalUrl,
      },
    });
    throw new NotFoundException(`Cannot ${request.method} ${request.originalUrl ?? ''}`.trim());
  }

  private isServableOnPublicDoor(context: ExecutionContext): boolean {
    const handlerPolicy = this.reflector.get<DoorPolicy | undefined>(
      DOOR_KEY,
      context.getHandler(),
    );
    if (handlerPolicy) return handlerPolicy === 'public';

    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles && roles.length > 0) return roles.includes('student');

    const classPolicy = this.reflector.get<DoorPolicy | undefined>(DOOR_KEY, context.getClass());
    if (classPolicy) return classPolicy === 'public';

    return false;
  }
}
