import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma';
import { SessionService } from '../activity-log';
import type { CreateUser, Login, UserRole } from '@ats/shared';

interface UserWithoutPassword {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

interface AuthResponse {
  accessToken: string;
  user: UserWithoutPassword;
  sessionId?: string;
}

// Loose email shape — strict enough to disambiguate from a loginId
// handle (which cannot contain `@`). Backend lookups always use the
// `users.email` unique index regardless.
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly sessionService: SessionService,
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
  ): Promise<AuthResponse> {
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
    if (!identifier) {
      throw new UnauthorizedException('Invalid credentials');
    }

    let user = null as Awaited<ReturnType<typeof this.prisma.user.findUnique>> | null;
    if (EMAIL_LIKE.test(identifier)) {
      user = await this.prisma.user.findUnique({
        where: { email: identifier.toLowerCase() },
      });
    } else {
      user = await this.prisma.user.findUnique({ where: { loginId: identifier } });
    }

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _unused, ...userWithoutPassword } = user;

    const token = this.signToken(userWithoutPassword);

    const sessionId = await this.sessionService.openSession({
      userId: user.id,
      ipAddress: requestMeta?.ip,
      userAgent: requestMeta?.userAgent,
    });

    return {
      accessToken: token,
      user: userWithoutPassword,
      sessionId,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessionService.closeSession(sessionId);
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
