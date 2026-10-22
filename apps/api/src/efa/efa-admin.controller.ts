import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { EfaCodeSubmitSchema, type EfaCodeSubmitRequest, type UserRole } from '@ats/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ZodValidationPipe } from '../common';
import { PrismaService } from '../prisma';
import { EfaCodingService } from './coding/coding.service';
import { EFA_EXPORTS, EfaExportsService, type EfaExport } from './exports/efa-exports.service';
import { EfaScoringService } from './scoring/scoring.service';
import { assertEfaStaff } from './staff-access';

interface RequestUser {
  id: string;
  role: UserRole;
}

// Two-door: staff only → PRIVATE. /api/efa-admin/ is denied on the public
// door (nginx) and the path never appears in the student bundle.
@Controller('efa-admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class EfaAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: EfaScoringService,
    private readonly coding: EfaCodingService,
    private readonly exports: EfaExportsService,
  ) {}

  // ── scoring ─────────────────────────────────────────────────────────────

  @Post('courses/:courseId/rescore')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async rescore(
    @Request() req: { user: RequestUser },
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    await assertEfaStaff(this.prisma, req.user, courseId);
    return this.scoring.rescoreCourse(courseId);
  }

  // ── coding ──────────────────────────────────────────────────────────────

  @Get('courses/:courseId/coding/summary')
  summary(
    @Request() req: { user: RequestUser },
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.coding.summary(req.user, courseId);
  }

  @Get('courses/:courseId/coding/:task/queue')
  queue(
    @Request() req: { user: RequestUser },
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('task') task: string,
  ) {
    return this.coding.queue(req.user, courseId, task);
  }

  @Get('courses/:courseId/coding/:task/disagreements')
  disagreements(
    @Request() req: { user: RequestUser },
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('task') task: string,
  ) {
    return this.coding.disagreements(req.user, courseId, task);
  }

  @Post('courses/:courseId/coding/items/:trialId')
  code(
    @Request() req: { user: RequestUser },
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('trialId', ParseUUIDPipe) trialId: string,
    @Body(new ZodValidationPipe(EfaCodeSubmitSchema)) body: EfaCodeSubmitRequest,
  ) {
    return this.coding.submit(req.user, courseId, trialId, body.codes);
  }

  @Post('courses/:courseId/coding/items/:trialId/final')
  adjudicate(
    @Request() req: { user: RequestUser },
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('trialId', ParseUUIDPipe) trialId: string,
    @Body(new ZodValidationPipe(EfaCodeSubmitSchema)) body: EfaCodeSubmitRequest,
  ) {
    return this.coding.adjudicate(req.user, courseId, trialId, body.codes);
  }

  // ── exports ─────────────────────────────────────────────────────────────

  @Get('courses/:courseId/export/:file')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async export(
    @Request() req: { user: RequestUser },
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('file') file: string,
    @Query('version') version: string | undefined,
    @Res() res: Response,
  ) {
    const kind = file.replace(/\.csv$/, '') as EfaExport;
    if (!file.endsWith('.csv') || !EFA_EXPORTS.includes(kind))
      throw new NotFoundException('Not found');
    const body = await this.exports.csv(req.user, courseId, kind, version || undefined);
    res
      .status(200)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="ef_${kind.replace('-', '_')}.csv"`)
      .send(body);
  }
}
