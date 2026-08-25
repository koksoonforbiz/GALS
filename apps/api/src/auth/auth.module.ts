import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './roles.guard';
import { LoginProtectionService } from './login-protection.service';
import { TwoFactorService } from './two-factor.service';
import { TotpService } from './totp.service';
import { ActivityLogModule } from '../activity-log';
import { MailerModule } from '../mailer';

@Global()
@Module({
  imports: [
    PassportModule,
    ActivityLogModule,
    MailerModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '24h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    RolesGuard,
    LoginProtectionService,
    TwoFactorService,
    TotpService,
  ],
  exports: [AuthService, JwtModule, RolesGuard],
})
export class AuthModule {}
