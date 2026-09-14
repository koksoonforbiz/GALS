import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma';
import { SecurityEventService } from './security-event.service';

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly securityEvents: SecurityEventService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET is not configured');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        twoFactorMethod: true,
        createdAt: true,
        updatedAt: true,
        isActive: true,
        isTemporaryPassword: true,
        passwordChangedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Deactivation (checklist item 11) takes effect immediately on the
    // very next request rather than waiting for the JWT to expire,
    // since this runs on every authenticated call.
    if (!user.isActive) {
      this.securityEvents.record({ type: 'DEACTIVATED_TOKEN_REUSE', userId: user.id });
      throw new UnauthorizedException('This account has been deactivated');
    }

    const { isActive: _isActive, ...safeUser } = user;
    return safeUser;
  }
}
