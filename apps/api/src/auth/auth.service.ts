import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
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

interface PasswordChangeRequired {
  requirePasswordChange: true;
  passwordChangeToken: string;
  message: string;
}

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
  ): Promise<AuthResponse | PasswordChangeRequired> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.isTemporaryPassword) {
      const limitedToken = this.jwtService.sign(
        { sub: user.id, type: 'password_change' },
        { expiresIn: '15m' },
      );

      return {
        requirePasswordChange: true,
        passwordChangeToken: limitedToken,
        message: 'You must change your password before continuing.',
      };
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

  async changePassword(token: string, newPassword: string): Promise<AuthResponse> {
    // Verify token
    let payload: { sub: string; type?: string };
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException(
        'Invalid or expired password change token. Please log in again.',
      );
    }

    if (payload.type !== 'password_change') {
      throw new UnauthorizedException('Invalid token type');
    }

    // Validate password strength
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    if (!/[A-Z]/.test(newPassword)) {
      throw new BadRequestException('Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(newPassword)) {
      throw new BadRequestException('Password must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(newPassword)) {
      throw new BadRequestException('Password must contain at least one number');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Ensure new password is different from current
    const isSame = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSame) {
      throw new BadRequestException('New password must be different from the temporary password');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    const updatedUser = await this.prisma.user.update({
      where: { id: payload.sub },
      data: {
        passwordHash,
        isTemporaryPassword: false,
        passwordChangedAt: new Date(),
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

    const accessToken = this.signToken(updatedUser);

    return { accessToken, user: updatedUser };
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
