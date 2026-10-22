import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import {
  KnowledgeTestWrittenScoreSchema,
  type KnowledgeTestWrittenScoreRequest,
  type UserRole,
} from '@ats/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ZodValidationPipe } from '../common';
import { KnowledgeTestAdminService } from './knowledge-test-admin.service';

interface RequestUser {
  id: string;
  role: UserRole;
}

const SetupSchema = z.object({ enabled: z.boolean() });
const EXPORTS = ['assignments', 'attempts', 'responses'] as const;

// Two-door: staff only → PRIVATE. /api/knowledge-tests-admin/ is denied on
// the public door (nginx) and the path never appears in the student bundle.
@Controller('knowledge-tests-admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class KnowledgeTestsAdminController {
  constructor(private readonly admin: KnowledgeTestAdminService) {}

  @Get('courses/:courseId/setup')
  setup(@Request() req: { user: RequestUser }, @Param('courseId', ParseUUIDPipe) courseId: string) {
    return this.admin.setup(req.user, courseId);
  }

  @Put('courses/:courseId/setup')
  setEnabled(
    @Request() req: { user: RequestUser },
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body(new ZodValidationPipe(SetupSchema)) body: { enabled: boolean },
  ) {
    return this.admin.setEnabled(req.user, courseId, body.enabled);
  }

  @Get('courses/:courseId/definitions')
  definitions(
    @Request() req: { user: RequestUser },
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.admin.definitions(req.user, courseId);
  }

  @Get('courses/:courseId/written/next')
  nextWritten(
    @Request() req: { user: RequestUser },
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.admin.nextWritten(req.user, courseId);
  }

  @Get('courses/:courseId/written/disagreements')
  disagreements(
    @Request() req: { user: RequestUser },
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.admin.disagreements(req.user, courseId);
  }

  @Get('courses/:courseId/inter-rater')
  interRater(
    @Request() req: { user: RequestUser },
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.admin.interRater(req.user, courseId);
  }

  @Get('attempts/:attemptId/written')
  written(
    @Request() req: { user: RequestUser },
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
  ) {
    return this.admin.writtenForAttempt(req.user, attemptId);
  }

  @Get('attempts/:attemptId/written/:slot')
  writtenItem(
    @Request() req: { user: RequestUser },
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Param('slot', ParseIntPipe) slot: number,
  ) {
    return this.admin.writtenItem(req.user, null, attemptId, slot);
  }

  @Post('attempts/:attemptId/written/:slot/score')
  score(
    @Request() req: { user: RequestUser },
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Param('slot', ParseIntPipe) slot: number,
    @Body(new ZodValidationPipe(KnowledgeTestWrittenScoreSchema))
    body: KnowledgeTestWrittenScoreRequest,
  ) {
    return this.admin.score(req.user, attemptId, slot, body);
  }

  // Last: `:file` would otherwise capture the routes above (e.g. inter-rater).
  @Get('courses/:courseId/:file')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async export(
    @Request() req: { user: RequestUser },
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('file') file: string,
    @Res() res: Response,
  ) {
    const kind = file.replace(/\.csv$/, '') as (typeof EXPORTS)[number];
    if (!file.endsWith('.csv') || !EXPORTS.includes(kind)) throw new NotFoundException('Not found');
    const body =
      kind === 'assignments'
        ? await this.admin.assignmentsCsv(req.user, courseId)
        : kind === 'attempts'
          ? await this.admin.attemptsCsv(req.user, courseId)
          : await this.admin.responsesCsv(req.user, courseId);
    res
      .status(200)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="knowledge_test_${kind}.csv"`)
      .send(body);
  }
}
