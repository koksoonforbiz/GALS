import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Request,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { ZodValidationPipe } from '../common';
import { CourseFlagsService, LEARNER_PROMPTS } from './course-flags.service';

const SetFlagSchema = z.object({ flag: z.enum(LEARNER_PROMPTS), enabled: z.boolean() });

interface RequestUser {
  id: string;
  role: string;
}

// Two-door: GET is PUBLIC (students read their course's prompts); PATCH and
// history are PRIVATE (teacher of the course, admin).
// docs/two-door/api-classification.md.
@Controller('course-flags')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CourseFlagsController {
  constructor(private readonly service: CourseFlagsService) {}

  @Get(':courseId')
  @Roles('student', 'teacher')
  async get(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
  ) {
    await this.service.assertCanRead(req.user, courseId);
    return { flags: await this.service.flags(courseId) };
  }

  @Patch(':courseId')
  @Roles('teacher')
  async set(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
    @Body(new ZodValidationPipe(SetFlagSchema)) body: z.infer<typeof SetFlagSchema>,
  ) {
    await this.service.assertOwns(req.user, courseId);
    return { flags: await this.service.set(courseId, body.flag, body.enabled, req.user.id) };
  }

  @Get(':courseId/history')
  @Roles('teacher')
  async history(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
  ) {
    await this.service.assertOwns(req.user, courseId);
    return this.service.history(courseId);
  }
}
