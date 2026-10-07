import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { TEXT_CONSENT_NOTICE_VERSION, TextConsentDecisionSchema, type UserRole } from '@ats/shared';
import type { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ZodValidationPipe } from '../common';
import { TextConsentService } from './text-consent.service';

interface RequestUser {
  id: string;
  role: UserRole;
}

// Two-door: student routes (@Roles('student')) → PUBLIC; allowlisted.
@Controller('text-consent')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TextConsentController {
  constructor(private readonly consent: TextConsentService) {}

  @Get('courses/:courseId')
  @Roles('student')
  async mine(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
  ) {
    return {
      decision: await this.consent.current(req.user.id, courseId),
      noticeVersion: TEXT_CONSENT_NOTICE_VERSION,
    };
  }

  /** Records a new decision (also how consent is revoked). */
  @Put('courses/:courseId')
  @Roles('student')
  async decide(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
    @Body(new ZodValidationPipe(TextConsentDecisionSchema))
    body: z.infer<typeof TextConsentDecisionSchema>,
  ) {
    return {
      decision: await this.consent.decide(req.user.id, courseId, body),
      noticeVersion: TEXT_CONSENT_NOTICE_VERSION,
    };
  }
}
