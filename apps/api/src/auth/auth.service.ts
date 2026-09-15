import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma';
import { SessionService } from '../activity-log';
import { sanitizeForLog } from '../common';
import { MailerService } from '../mailer';
import { LoginProtectionService } from './login-protection.service';
import { TwoFactorService } from './two-factor.service';
import { TotpService } from './totp.service';
import { SecurityEventService } from './security-event.service';
import { PasswordHistoryService } from './password-history.service';
import { mustChangePassword } from './password-lifecycle.util';
import { MfaPolicyService } from './mfa-policy.service';
import type { CreateUser, Login, UserRole, TwoFactorMethod } from '@ats/shared';

interface UserWithoutPassword {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  twoFactorMethod: TwoFactorMethod | null;
  createdAt: Date;
  updatedAt: Date;
  // Checklist item 5 — lets the client redirect straight to the
  // change-password screen after login rather than discovering the
  // requirement from a blocked request's PASSWORD_CHANGE_REQUIRED error.
  mustChangePassword: boolean;
  // Checklist item 12 — true when MFA_REQUIRED_ROLES covers this role
  // and no factor is enrolled yet; the client routes to Account
  // Security before any RolesGuard-covered request is blocked.
  mustEnrolMfa: boolean;
}

interface AuthResponse {
  accessToken: string;
  user: UserWithoutPassword;
  sessionId?: string;
}

interface TwoFactorPendingResponse {
  twoFactorRequired: true;
  challengeId: string;
  method: TwoFactorMethod;
}

// Loose email shape — strict enough to disambiguate from a loginId
// handle (which cannot contain `@`). Backend lookups always use the
// `users.email` unique index regardless.
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // Persisted lockout (checklist item 5) — same 5-attempt threshold as
  // the Redis-based check, but a longer, DB-visible lock duration since
  // this one is meant to be the durable/administrable layer.
  private static readonly LOCKOUT_THRESHOLD = 5;
  private static readonly LOCKOUT_DURATION_MS = 30 * 60 * 1000;

  // Checklist item 5 — minimum password age. Only applies to voluntary
  // self-service changes; a forced change (isTemporaryPassword) always
  // bypasses this so a teacher-issued or just-reset password can be
  // replaced immediately.
  private static readonly MIN_PASSWORD_AGE_MS = 3 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly sessionService: SessionService,
    private readonly loginProtection: LoginProtectionService,
    private readonly twoFactor: TwoFactorService,
    private readonly totp: TotpService,
    private readonly mailer: MailerService,
    private readonly securityEvents: SecurityEventService,
    private readonly passwordHistory: PasswordHistoryService,
    private readonly mfaPolicy: MfaPolicyService,
  ) {}

  async register(dto: CreateUser): Promise<AuthResponse> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
        role: dto.role,
        // dto.termsAccepted is a Zod z.literal(true) — always true here,
        // just recording when it happened (checklist item 35).
        termsAcceptedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        twoFactorMethod: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const token = this.signToken(user);

    return {
      accessToken: token,
      // A brand-new account is never temporary/expired — no need to
      // fetch isTemporaryPassword/passwordChangedAt just to compute it.
      user: { ...user, mustChangePassword: false, mustEnrolMfa: this.mfaPolicy.mustEnrol(user) },
    };
  }

  async login(
    dto: Login,
    requestMeta?: { ip?: string; userAgent?: string },
  ): Promise<AuthResponse | TwoFactorPendingResponse> {
    // Prompt 05: single `identifier` (email OR teacher-assigned loginId)
    // resolved against the canonical `users.id` UUID. Deterministic
    // rule (no ambiguity even if a stale client supplied both):
    //   - Looks like an email (contains `@`)  → look up by email.
    //   - Otherwise                          → look up by loginId.
    // Both columns are UNIQUE, so each path returns 0 or 1 user. We
    // verify the SAME single stored password hash regardless of which
    // path resolved the row. Even if a teacher accidentally assigns a
    // loginId that looks email-like, the email column is checked first
    // and any miss falls through to the loginId column. The other
    // half of that fallthrough is what we do NOT do: we never try the
    // second column when the first matched, so a single login attempt
    // can be tied to a single User.id deterministically.
    //
    // `passwordChangeToken` / `requirePasswordChange` was removed in
    // prompt 05: students cannot change their own password. The
    // `isTemporaryPassword` column is left populated (it remains a
    // useful "teacher-issued, not yet rotated" hint visible to the
    // teacher roster) but it no longer gates login.
    const identifier = dto.identifier.trim();
    const safeIdentifier = sanitizeForLog(identifier);
    const safeIp = sanitizeForLog(requestMeta?.ip);

    if (!identifier) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Account-keyed brute-force check — independent of the IP-keyed
    // @Throttle on the route, so distributing attempts across source IPs
    // doesn't buy an attacker a fresh budget against the same account.
    await this.loginProtection.assertNotLockedOut(identifier);

    let user = null as Awaited<ReturnType<typeof this.prisma.user.findUnique>> | null;
    if (EMAIL_LIKE.test(identifier)) {
      user = await this.prisma.user.findUnique({
        where: { email: identifier.toLowerCase() },
      });
    } else {
      user = await this.prisma.user.findUnique({ where: { loginId: identifier } });
    }

    if (!user) {
      this.logger.warn(
        `Login failed (unknown identifier): identifier=${safeIdentifier} ip=${safeIp}`,
      );
      this.securityEvents.record({
        type: 'FAILED_LOGIN_UNKNOWN_IDENTIFIER',
        identifier: safeIdentifier,
        ipAddress: requestMeta?.ip,
        userAgent: requestMeta?.userAgent,
      });
      await this.loginProtection.recordFailure(identifier);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Deactivated accounts get the same generic message as "unknown
    // identifier" — never confirm to an unauthenticated caller that an
    // account exists but was disabled (checklist item 11).
    if (!user.isActive) {
      this.logger.warn(`Login blocked (deactivated account): userId=${user.id} ip=${safeIp}`);
      this.securityEvents.record({
        type: 'FAILED_LOGIN_DEACTIVATED_ACCOUNT',
        userId: user.id,
        ipAddress: requestMeta?.ip,
        userAgent: requestMeta?.userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // Persisted, admin-visible lockout — a complement to the ephemeral
    // Redis-based check above (checklist item 5). Checked after
    // isActive but before the password compare so a locked account
    // never leaks whether the supplied password was right.
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      this.logger.warn(`Login blocked (account locked): userId=${user.id} ip=${safeIp}`);
      this.securityEvents.record({
        type: 'FAILED_LOGIN_LOCKED_ACCOUNT',
        userId: user.id,
        ipAddress: requestMeta?.ip,
        userAgent: requestMeta?.userAgent,
      });
      throw new UnauthorizedException('Too many failed login attempts. Please try again later.');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!isPasswordValid) {
      this.logger.warn(`Login failed (invalid password): userId=${user.id} ip=${safeIp}`);
      this.securityEvents.record({
        type: 'FAILED_LOGIN_INVALID_PASSWORD',
        userId: user.id,
        ipAddress: requestMeta?.ip,
        userAgent: requestMeta?.userAgent,
      });
      await this.loginProtection.recordFailure(identifier);
      await this.recordFailedLoginAttempt(user.id, user.failedLoginAttempts);
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.loginProtection.recordSuccess(identifier);
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    const userWithoutPassword = this.toSafeUser(user);

    if (user.twoFactorMethod === 'email') {
      const { challengeId, code } = await this.twoFactor.startEmailChallenge(user.id);
      await this.mailer.sendOtpEmail(user.email, code);
      this.logger.log(`Login password OK, 2FA challenge sent: userId=${user.id} ip=${safeIp}`);
      return { twoFactorRequired: true, challengeId, method: 'email' };
    }

    if (user.twoFactorMethod === 'totp') {
      const { challengeId } = await this.twoFactor.startTotpChallenge(user.id);
      this.logger.log(`Login password OK, TOTP challenge started: userId=${user.id} ip=${safeIp}`);
      return { twoFactorRequired: true, challengeId, method: 'totp' };
    }

    const response = await this.issueSession(userWithoutPassword, requestMeta);
    this.logger.log(`Login succeeded: userId=${user.id} role=${user.role} ip=${safeIp}`);
    return response;
  }

  /**
   * Completes a login that required a 2FA code. Dispatches by the
   * challenge's tagged method: email checks a Redis-held code hash; TOTP
   * decrypts the user's persisted secret and checks it via TotpService.
   * Both paths funnel through TwoFactorService's shared attempt/lockout
   * logic either way, then issue the same session a non-2FA login would.
   */
  async verifyTwoFactor(
    dto: { challengeId: string; code: string },
    requestMeta?: { ip?: string; userAgent?: string },
  ): Promise<AuthResponse> {
    const pending = await this.twoFactor.getPending(dto.challengeId);
    if (!pending) {
      throw new UnauthorizedException('This code has expired. Please log in again.');
    }

    let userId: string;
    if (pending.method === 'email') {
      userId = await this.twoFactor.verifyEmailCode(dto.challengeId, dto.code);
    } else {
      const pendingUser = await this.prisma.user.findUnique({ where: { id: pending.userId } });
      const correct =
        !!pendingUser?.totpSecret && this.totp.verifyLoginCode(pendingUser.totpSecret, dto.code);
      userId = await this.twoFactor.verifyTotpAttempt(dto.challengeId, pending.userId, correct);
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const userWithoutPassword = this.toSafeUser(user);
    const response = await this.issueSession(userWithoutPassword, requestMeta);
    this.logger.log(`2FA verified, login succeeded: userId=${user.id} role=${user.role}`);
    return response;
  }

  /**
   * Persisted counterpart to LoginProtectionService's Redis check
   * (checklist item 5). Increments failedLoginAttempts and, once it
   * reaches the threshold, sets lockedUntil LOCKOUT_DURATION_MS in the
   * future and resets the counter — so a subsequent burst starts a
   * fresh count rather than extending the lock indefinitely.
   */
  private async recordFailedLoginAttempt(userId: string, currentAttempts: number): Promise<void> {
    const attempts = currentAttempts + 1;
    if (attempts >= AuthService.LOCKOUT_THRESHOLD) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: new Date(Date.now() + AuthService.LOCKOUT_DURATION_MS),
        },
      });
      this.logger.warn(`Account locked after ${attempts} failed attempts: userId=${userId}`);
      this.securityEvents.record({
        type: 'ACCOUNT_LOCKED_OUT',
        userId,
        metadata: { failedAttempts: attempts },
      });
    } else {
      await this.prisma.user.update({
        where: { id: userId },
        data: { failedLoginAttempts: attempts },
      });
    }
  }

  /**
   * Whitelists the client-facing profile fields off a full Prisma User
   * row. Deliberately a pick, not a `passwordHash`-only omit: the row
   * also carries encrypted LLM/Cohere/TOTP secret ciphertext and invite
   * metadata that has no business leaving the server on a login response.
   */
  private toSafeUser(user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    twoFactorMethod: TwoFactorMethod | null;
    createdAt: Date;
    updatedAt: Date;
    isTemporaryPassword: boolean;
    passwordChangedAt: Date | null;
  }): UserWithoutPassword {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      twoFactorMethod: user.twoFactorMethod,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      mustChangePassword: mustChangePassword(user),
      mustEnrolMfa: this.mfaPolicy.mustEnrol(user),
    };
  }

  /**
   * Starts email-OTP enrollment: sends a code to the logged-in user's own
   * email to prove they still control it before flipping twoFactorMethod.
   */
  async enableTwoFactor(userId: string): Promise<{ challengeId: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const { challengeId, code } = await this.twoFactor.startEmailChallenge(user.id);
    await this.mailer.sendOtpEmail(user.email, code);
    return { challengeId };
  }

  async confirmEnableTwoFactor(
    userId: string,
    dto: { challengeId: string; code: string },
  ): Promise<{ twoFactorMethod: 'email' }> {
    const verifiedUserId = await this.twoFactor.verifyEmailCode(dto.challengeId, dto.code);
    if (verifiedUserId !== userId) {
      throw new UnauthorizedException('Invalid code');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorMethod: 'email', twoFactorEnabledAt: new Date(), totpSecret: null },
    });
    this.logger.log(`2FA enabled (email): userId=${userId}`);
    return { twoFactorMethod: 'email' };
  }

  /** Starts TOTP enrollment: mints a fresh secret + QR code, not yet persisted. */
  async startTotpSetup(userId: string): Promise<{ secret: string; qrCodeDataUrl: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.totp.generateSetup(user.id, user.email);
  }

  /**
   * Confirms TOTP enrollment: proves the user scanned the QR code (or
   * entered the secret manually) by checking a real code from their
   * authenticator app, then persists the encrypted secret. Overwrites
   * whichever method (if any) was previously active — a single nullable
   * column can't represent more than one active method anyway, and
   * switching should be one flow rather than disable-then-enable.
   */
  async confirmTotpSetup(userId: string, code: string): Promise<{ twoFactorMethod: 'totp' }> {
    const encryptedSecret = await this.totp.confirmSetup(userId, code);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorMethod: 'totp',
        totpSecret: encryptedSecret,
        twoFactorEnabledAt: new Date(),
      },
    });
    this.logger.log(`2FA enabled (totp): userId=${userId}`);
    return { twoFactorMethod: 'totp' };
  }

  async disableTwoFactor(userId: string, password: string): Promise<{ twoFactorMethod: null }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorMethod: null, twoFactorEnabledAt: null, totpSecret: null },
    });
    this.logger.log(`2FA disabled: userId=${userId}`);
    return { twoFactorMethod: null };
  }

  /**
   * Self-service password change (checklist item 5). No email is ever
   * sent as part of this — per an explicit product decision, the only
   * recovery path for a fully-locked-out user remains the existing
   * teacher-mediated reset. Requires the current password; a forced
   * change (isTemporaryPassword) skips the minimum-age check since the
   * whole point of a forced change is to let it happen immediately.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (!user.isTemporaryPassword && user.passwordChangedAt) {
      const age = Date.now() - user.passwordChangedAt.getTime();
      if (age < AuthService.MIN_PASSWORD_AGE_MS) {
        const daysRemaining = Math.ceil(
          (AuthService.MIN_PASSWORD_AGE_MS - age) / (24 * 60 * 60 * 1000),
        );
        throw new BadRequestException(
          `Password was changed too recently. Please wait ${daysRemaining} more day(s) before changing it again.`,
        );
      }
    }

    await this.passwordHistory.assertNotReused(userId, newPassword);

    const newHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newHash,
        passwordChangedAt: new Date(),
        isTemporaryPassword: false,
      },
    });
    await this.passwordHistory.recordReplaced(userId, user.passwordHash);
    this.logger.log(`Password changed (self-service): userId=${userId}`);
  }

  async resendTwoFactorCode(challengeId: string): Promise<void> {
    const { code, userId } = await this.twoFactor.resend(challengeId);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('This code has expired. Please log in again.');
    }
    await this.mailer.sendOtpEmail(user.email, code);
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessionService.closeSession(sessionId);
  }

  private async issueSession(
    user: UserWithoutPassword,
    requestMeta?: { ip?: string; userAgent?: string },
  ): Promise<AuthResponse> {
    const token = this.signToken(user);

    const sessionId = await this.sessionService.openSession({
      userId: user.id,
      ipAddress: requestMeta?.ip,
      userAgent: requestMeta?.userAgent,
    });

    // Checklist item 13 — quarterly account review needs a login-recency
    // signal for every role. Fire-and-forget: a write failure here must
    // never block an otherwise-successful login. Wrapped in
    // Promise.resolve() rather than chained directly off .update() so a
    // test double that doesn't return a real promise can't throw
    // synchronously here (undefined has no .catch).
    Promise.resolve(
      this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    ).catch((err) => {
      this.logger.warn(`Failed to record lastLoginAt: userId=${user.id} ${(err as Error).message}`);
    });

    return {
      accessToken: token,
      user,
      sessionId,
    };
  }

  private signToken(user: { id: string; email: string; role: UserRole }): string {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    return this.jwtService.sign(payload);
  }
}
