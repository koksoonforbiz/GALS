import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  PromptLabRatingSchema,
  PromptLabRunSchema,
  PromptLabTagsSchema,
  PromptLabTestCaseSchema,
  PromptLabTestResultSchema,
  PromptLabVersionSchema,
  type PromptLabRatingRequest,
  type PromptLabRunRequest,
  type PromptLabTestCaseRequest,
  type PromptLabTestResultRequest,
  type PromptLabVersionRequest,
  type UserRole,
} from '@ats/shared';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { ZodValidationPipe } from '../common';
import { PromptLabService } from './prompt-lab.service';

interface RequestUser {
  id: string;
  role: UserRole;
}

// Two-door: every student route is @Roles('student') → PUBLIC (student door,
// nginx allowlist /api/prompt-lab/); the teacher read is @Roles('teacher',
// 'admin') under /api/prompt-lab/courses/... → PRIVATE, explicitly denied in
// the allowlist. See docs/two-door/api-classification.md.
@Controller('prompt-lab')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PromptLabController {
  constructor(private readonly service: PromptLabService) {}

  @Get('me')
  @Roles('student')
  mine(
    @Request() req: { user: RequestUser },
    @Query('moduleItemId', new ParseUUIDPipe()) moduleItemId: string,
    @Query('slideKey') slideKey: string,
  ) {
    return this.service.mine(req.user.id, moduleItemId, slideKey);
  }

  // Calls the LLM: route throttle on top of the per-student hourly/daily
  // limits enforced in the service.
  @Post('run')
  @Roles('student')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  run(
    @Request() req: { user: RequestUser },
    @Body(new ZodValidationPipe(PromptLabRunSchema)) body: PromptLabRunRequest,
  ) {
    return this.service.run(req.user.id, body);
  }

  @Post('versions')
  @Roles('student')
  saveVersion(
    @Request() req: { user: RequestUser },
    @Body(new ZodValidationPipe(PromptLabVersionSchema)) body: PromptLabVersionRequest,
  ) {
    return this.service.saveVersion(req.user.id, body);
  }

  @Patch('versions/:id/tags')
  @Roles('student')
  setTags(
    @Request() req: { user: RequestUser },
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(PromptLabTagsSchema)) body: { revisionTags: string[] },
  ) {
    return this.service.setTags(req.user.id, id, body.revisionTags);
  }

  @Post('test-cases')
  @Roles('student')
  addTestCase(
    @Request() req: { user: RequestUser },
    @Body(new ZodValidationPipe(PromptLabTestCaseSchema)) body: PromptLabTestCaseRequest,
  ) {
    return this.service.addTestCase(req.user.id, body);
  }

  @Post('test-results')
  @Roles('student')
  recordTestResult(
    @Request() req: { user: RequestUser },
    @Body(new ZodValidationPipe(PromptLabTestResultSchema)) body: PromptLabTestResultRequest,
  ) {
    return this.service.recordTestResult(req.user.id, body);
  }

  @Post('ratings')
  @Roles('student')
  rate(
    @Request() req: { user: RequestUser },
    @Body(new ZodValidationPipe(PromptLabRatingSchema)) body: PromptLabRatingRequest,
  ) {
    return this.service.rate(req.user.id, body);
  }

  @Get('courses/:courseId/students/:studentId')
  @Roles('teacher', 'admin')
  forStudent(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
  ) {
    return this.service.forStudent(req.user, courseId, studentId);
  }
}
