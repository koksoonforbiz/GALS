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
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { UserRole } from '@ats/shared';
import { JwtAuthGuard, RolesGuard, Roles } from '../../auth';
import { ZodValidationPipe } from '../../common';
import { PrismaService } from '../../prisma';
import { NudgeService } from './nudge.service';

interface RequestUser {
  id: string;
  role: UserRole;
}

const EvaluateSchema = z.object({
  moduleItemId: z.string().uuid(),
  sessionId: z.string().uuid(),
  slideKey: z.string().max(32).optional(),
});
const RespondSchema = z.object({ status: z.enum(['accepted', 'dismissed']) });
const PolicySchema = z.object({
  enabled: z.boolean().optional(),
  requiresValidated: z.boolean().optional(),
  messageTemplate: z.string().min(5).max(500).optional(),
  rationale: z.string().min(5).max(500).optional(),
  maxPerActivity: z.number().int().min(1).max(10).optional(),
  cooldownMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .optional(),
  abTreatmentShare: z.number().min(0).max(1).nullable().optional(),
});

// Two-door: evaluate/respond are @Roles('student') → PUBLIC (exact allowlist
// entries); policies and the nudge log are teacher/admin → PRIVATE.
@Controller('nudges')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NudgeController {
  constructor(
    private readonly nudges: NudgeService,
    private readonly prisma: PrismaService,
  ) {}

  private async assertCourse(user: RequestUser, courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (user.role !== 'admin' && course.teacherId !== user.id)
      throw new ForbiddenException('Not your course');
  }

  /** Called by the lesson after key moments; returns at most one nudge. */
  @Post('evaluate')
  @Roles('student')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  evaluate(
    @Request() req: { user: RequestUser },
    @Body(new ZodValidationPipe(EvaluateSchema)) body: z.infer<typeof EvaluateSchema>,
  ) {
    return this.nudges.evaluate(req.user.id, body);
  }

  @Post(':id/respond')
  @Roles('student')
  respond(
    @Request() req: { user: RequestUser },
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(RespondSchema)) body: z.infer<typeof RespondSchema>,
  ) {
    return this.nudges.respond(req.user.id, id, body.status);
  }

  @Get('policies/courses/:courseId')
  @Roles('teacher', 'admin')
  async policies(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
  ) {
    await this.assertCourse(req.user, courseId);
    return this.nudges.policies(courseId);
  }

  @Patch('policies/courses/:courseId/:ruleId')
  @Roles('teacher', 'admin')
  async updatePolicy(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
    @Param('ruleId') ruleId: string,
    @Body(new ZodValidationPipe(PolicySchema)) body: z.infer<typeof PolicySchema>,
  ) {
    await this.assertCourse(req.user, courseId);
    return this.nudges.updatePolicy(courseId, ruleId, body, req.user.id);
  }

  @Get('courses/:courseId/log')
  @Roles('teacher', 'admin')
  async log(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
  ) {
    await this.assertCourse(req.user, courseId);
    return this.nudges.log(courseId);
  }
}
