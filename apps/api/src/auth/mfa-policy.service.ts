import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole, type TwoFactorMethod } from '@ats/shared';

/**
 * Mandatory-MFA policy (SMU checklist item 12 — "MFA is enabled for
 * privileged accounts"). Two-factor auth (TOTP or email OTP) has always
 * been available to every role but opt-in; this makes enrolment a
 * precondition for the roles listed in `MFA_REQUIRED_ROLES`
 * (comma-separated, e.g. `admin,teacher`).
 *
 * Deliberately opt-in via env rather than hard-coded: unset (the
 * default, and what every dev/test stack runs with) keeps today's
 * behaviour exactly, so the production runbook is where this gets
 * switched on. Once set, `RolesGuard` blocks every RolesGuard-covered
 * route for an affected account that has no factor enrolled
 * (`MFA_ENROLMENT_REQUIRED`), `WsAuthService` refuses its socket
 * handshakes, and the login / `/auth/me` responses carry
 * `mustEnrolMfa` so the client can route straight to Account Security.
 * The 2FA enrolment routes themselves are on AuthController, which
 * uses JwtAuthGuard alone, so an affected user can always get out of
 * the gate. Mirrors the checklist-item-5 forced-password-change gate.
 */
export interface MfaPolicyUser {
  role: UserRole;
  twoFactorMethod: TwoFactorMethod | null;
}

export function parseMfaRequiredRoles(raw: string | undefined): ReadonlySet<UserRole> {
  const roles = new Set<UserRole>();
  for (const token of (raw ?? '').split(',')) {
    const value = token.trim().toLowerCase();
    if (!value) continue;
    const parsed = UserRole.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `MFA_REQUIRED_ROLES contains unknown role "${value}" — expected a comma-separated subset of ${UserRole.options.join(', ')}`,
      );
    }
    roles.add(parsed.data);
  }
  return roles;
}

@Injectable()
export class MfaPolicyService {
  private readonly logger = new Logger(MfaPolicyService.name);
  readonly requiredRoles: ReadonlySet<UserRole>;

  constructor(config: ConfigService) {
    this.requiredRoles = parseMfaRequiredRoles(config.get<string>('MFA_REQUIRED_ROLES'));
    if (this.requiredRoles.size > 0) {
      this.logger.log(
        `MFA enrolment is mandatory for: ${[...this.requiredRoles].join(', ')} (MFA_REQUIRED_ROLES)`,
      );
    }
  }

  /** True when this account's role requires MFA and no factor is enrolled yet. */
  mustEnrol(user: MfaPolicyUser): boolean {
    return this.requiredRoles.has(user.role) && user.twoFactorMethod === null;
  }
}
