import { Injectable, ConflictException, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma';
import { SessionService } from '../activity-log';
import { sanitizeForLog } from '../common';
import { MailerService } from '../mailer';
import { LoginProtectionService } from './login-protection.service';
import { TwoFactorService } from './two-factor.service';
import { TotpService } from './totp.service';
import type { CreateUser, Login, UserRole, TwoFactorMethod } from '@ats/shared';

interface UserWithoutPassword {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  twoFactorMethod: TwoFactorMethod | null;
  createdAt: Date;
  updatedAt: Date;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly sessionService: SessionService,
    private readonly loginProtection: LoginProtectionService,
    private readonly twoFactor: TwoFactorService,
    private readonly totp: TotpService,
    private readonly mailer: MailerService,
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
      user,
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
      await this.loginProtection.recordFailure(identifier);
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!isPasswordValid) {
      this.logger.warn(`Login failed (invalid password): userId=${user.id} ip=${safeIp}`);
      await this.loginProtection.recordFailure(identifier);
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.loginProtection.recordSuccess(identifier);

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
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const userWithoutPassword = this.toSafeUser(user);
    const response = await this.issueSession(userWithoutPassword, requestMeta);
    this.logger.log(`2FA verified, login succeeded: userId=${user.id} role=${user.role}`);
    return response;
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
  }): UserWithoutPassword {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      twoFactorMethod: user.twoFactorMethod,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
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

    return {
      accessToken: token,
      user,
      sessionId,
    };
  }

  private signToken(user: UserWithoutPassword): string {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    return this.jwtService.sign(payload);
  }
}
