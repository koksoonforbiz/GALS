import { Controller, Post, Get, Body, UseGuards, Request, UsePipes } from '@nestjs/common';
import { ThrottlerGuard, Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ZodValidationPipe } from '../common';
import {
  CreateUserSchema,
  LoginSchema,
  TwoFactorVerifySchema,
  TwoFactorResendSchema,
  TwoFactorDisableSchema,
  TotpSetupConfirmSchema,
} from '@ats/shared';
import type {
  CreateUser,
  Login,
  UserRole,
  TwoFactorMethod,
  TwoFactorVerify,
  TwoFactorResend,
  TwoFactorDisable,
  TotpSetupConfirm,
} from '@ats/shared';

interface RequestUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  twoFactorMethod: TwoFactorMethod | null;
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

  @Post('2fa/verify')
  @Throttle({ default: { limit: 8, ttl: 60000 } })
  @UsePipes(new ZodValidationPipe(TwoFactorVerifySchema))
  async verifyTwoFactor(@Body() dto: TwoFactorVerify, @Request() req: any) {
    return this.authService.verifyTwoFactor(dto, {
      ip: req?.ip,
      userAgent: req?.headers?.['user-agent'],
    });
  }

  @Post('2fa/resend')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UsePipes(new ZodValidationPipe(TwoFactorResendSchema))
  async resendTwoFactor(@Body() dto: TwoFactorResend) {
    await this.authService.resendTwoFactorCode(dto.challengeId);
    return { sent: true };
  }

  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard)
  async enableTwoFactor(@Request() req: { user: RequestUser }) {
    return this.authService.enableTwoFactor(req.user.id);
  }

  @Post('2fa/enable/confirm')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ZodValidationPipe(TwoFactorVerifySchema))
  async confirmEnableTwoFactor(
    @Body() dto: TwoFactorVerify,
    @Request() req: { user: RequestUser },
  ) {
    return this.authService.confirmEnableTwoFactor(req.user.id, dto);
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ZodValidationPipe(TwoFactorDisableSchema))
  async disableTwoFactor(@Body() dto: TwoFactorDisable, @Request() req: { user: RequestUser }) {
    return this.authService.disableTwoFactor(req.user.id, dto.password);
  }

  @Post('2fa/totp/setup')
  @UseGuards(JwtAuthGuard)
  async startTotpSetup(@Request() req: { user: RequestUser }) {
    return this.authService.startTotpSetup(req.user.id);
  }

  @Post('2fa/totp/setup/confirm')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ZodValidationPipe(TotpSetupConfirmSchema))
  async confirmTotpSetup(@Body() dto: TotpSetupConfirm, @Request() req: { user: RequestUser }) {
    return this.authService.confirmTotpSetup(req.user.id, dto.code);
  }

  // Prompt 05: the legacy `POST /auth/change-password` endpoint that
  // accepted a short-lived passwordChangeToken has been REMOVED.
  // Students never set or change their own password. Teacher/admin-
  // issued resets go through `POST /user-management/users/:userId/
  // reset-password` (guarded by JwtAuthGuard + RolesGuard +
  // @Roles('teacher','admin')). No forgot-password / self-reset
  // endpoint is exposed.

  @Get('me')
  @SkipThrottle()
  @UseGuards(JwtAuthGuard)
  async getMe(@Request() req: { user: RequestUser }) {
    return req.user;
  }
}
