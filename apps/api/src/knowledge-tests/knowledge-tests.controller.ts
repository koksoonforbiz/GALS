import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  KnowledgeTestSaveSchema,
  KnowledgeTestStartSchema,
  KnowledgeTestSubmitSchema,
  type KnowledgeTestSaveRequest,
  type KnowledgeTestStartRequest,
  type KnowledgeTestSubmitRequest,
  type UserRole,
} from '@ats/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SessionId, ZodValidationPipe } from '../common';
import { KnowledgeTestService } from './knowledge-test.service';

interface RequestUser {
  id: string;
  role: UserRole;
}

// Two-door: student-only (@Roles('student')) → PUBLIC; nginx allowlist
// /api/knowledge-tests/. Never returns keys, rubrics, objectives or scores.
@Controller('knowledge-tests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('student')
// Autosave every 10 s and on blur, per student; per-IP limits are shared
// by a lab behind one NAT address (see PuzzlesController).
@Throttle({ default: { limit: 1200, ttl: 60_000 } })
export class KnowledgeTestsController {
  constructor(private readonly tests: KnowledgeTestService) {}

  @Get('courses/:courseId/status')
  status(
    @Request() req: { user: RequestUser },
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.tests.status(req.user.id, courseId);
  }

  @Post('courses/:courseId/assign-me')
  async assignMe(
    @Request() req: { user: RequestUser },
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    await this.tests.ensureAssignments(req.user.id, courseId);
    return { ok: true };
  }

  @Post('courses/:courseId/attempts')
  start(
    @Request() req: { user: RequestUser },
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body(new ZodValidationPipe(KnowledgeTestStartSchema)) body: KnowledgeTestStartRequest,
    @SessionId() sessionId?: string,
  ) {
    return this.tests.start(req.user.id, courseId, body.kind, body.sessionNo, sessionId);
  }

  @Patch('attempts/:attemptId')
  save(
    @Request() req: { user: RequestUser },
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Body(new ZodValidationPipe(KnowledgeTestSaveSchema)) body: KnowledgeTestSaveRequest,
  ) {
    return this.tests.save(req.user.id, attemptId, body.responses);
  }

  @Post('attempts/:attemptId/submit')
  submit(
    @Request() req: { user: RequestUser },
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Body(new ZodValidationPipe(KnowledgeTestSubmitSchema)) body: KnowledgeTestSubmitRequest,
    @SessionId() sessionId?: string,
  ) {
    return this.tests.submit(req.user.id, attemptId, body.responses, sessionId);
  }
}
