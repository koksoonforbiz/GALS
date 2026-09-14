import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@ats/shared';
import { ROLES_KEY } from './roles.decorator';
import { SecurityEventService } from './security-event.service';
import { mustChangePassword } from './password-lifecycle.util';

interface RequestUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isTemporaryPassword: boolean;
  passwordChangedAt: Date | string | null;
  createdAt: Date | string;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private readonly securityEvents: SecurityEventService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user: RequestUser; method: string; originalUrl?: string; ip?: string }>();
    const user = request.user;

    // Unconditional — runs even on routes with no @Roles() restriction,
    // since any authenticated route should be blocked while a password
    // change is outstanding. NestJS runs JwtAuthGuard (which populates
    // req.user) before RolesGuard on every controller that declares
    // both, per @UseGuards(JwtAuthGuard, RolesGuard) order. A handful of
    // controllers (blob, chat-history, code-decomposition,
    // learning-interventions, question-generation) use JwtAuthGuard
    // alone with no RolesGuard and so aren't covered by this check —
    // the same accepted gap already documented for the MFA-mandatory
    // plan, since none of them expose sensitive admin/teacher actions.
    if (user) {
      this.assertPasswordLifecycleOk(user);
    }

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    if (!user) {
      return false;
    }

    const allowed = requiredRoles.includes(user.role);
    if (!allowed) {
      // Checklist item 25 — a real signal (either a stale/misused
      // token or a bug), unlike routine token expiry, so worth a
      // queryable audit row rather than just Logger output.
      this.securityEvents.record({
        type: 'PERMISSION_DENIED',
        userId: user.id,
        ipAddress: request.ip,
        metadata: {
          requiredRoles,
          actualRole: user.role,
          method: request.method,
          path: request.originalUrl,
        },
      });
    }
    return allowed;
  }

  /**
   * Blocks any request while the account has an outstanding forced
   * password change (teacher-issued reset, never yet followed by a
   * self-service change) or its password has passed the 180-day expiry
   * window. The client is expected to catch PASSWORD_CHANGE_REQUIRED
   * and route the user to POST /auth/change-password, which is exempt
   * because AuthController's mutating routes don't use RolesGuard.
   */
  private assertPasswordLifecycleOk(user: RequestUser): void {
    if (mustChangePassword(user)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: user.isTemporaryPassword
          ? 'Your password was reset by a teacher/admin and must be changed before continuing.'
          : 'Your password has expired and must be changed before continuing.',
      });
    }
  }
}
