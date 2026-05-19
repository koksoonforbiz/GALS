import { Controller, Post, Get, Body, UseGuards, Request, UsePipes } from '@nestjs/common';
import { ThrottlerGuard, Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ZodValidationPipe } from '../common';
import { CreateUserSchema, LoginSchema } from '@ats/shared';
import type { CreateUser, Login, UserRole } from '@ats/shared';

interface RequestUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UsePipes(new ZodValidationPipe(CreateUserSchema))
  async register(@Body() dto: CreateUser) {
    return this.authService.register(dto);
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UsePipes(new ZodValidationPipe(LoginSchema))
  async login(@Body() dto: Login, @Request() req: any) {
    return this.authService.login(dto, {
      ip: req?.ip,
      userAgent: req?.headers?.['user-agent'],
    });
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Body() body: { sessionId: string }) {
    return this.authService.logout(body.sessionId);
  }

  @Post('change-password')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async changePassword(@Body() body: { token: string; newPassword: string }) {
    return this.authService.changePassword(body.token, body.newPassword);
  }

  @Get('me')
  @SkipThrottle()
  @UseGuards(JwtAuthGuard)
  async getMe(@Request() req: { user: RequestUser }) {
    return req.user;
  }
}
