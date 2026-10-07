import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { UserRole } from '@ats/shared';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { ZodValidationPipe } from '../common';
import { PrismaService } from '../prisma';
import { LearningEventsService } from './learning-events.service';

interface RequestUser {
  id: string;
  role: UserRole;
}

const ParameterSetSchema = z.object({
  values: z.record(z.unknown()),
  note: z.string().max(500).optional(),
});

const versionQuery = (v?: string) => (v ? Number(v) || undefined : undefined);

// Two-door: researcher/teacher surface only — every route is
// @Roles('teacher','admin') → PRIVATE (default-denied on the public door).
@Controller('learning-events')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class LearningEventsController {
  constructor(
    private readonly service: LearningEventsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Same rule as SessionService.assertTeacherOwnsSession; admins see all. */
  private async assertSession(user: RequestUser, sessionId: string) {
    const session = await this.prisma.studentSession.findUnique({
      where: { id: sessionId },
      select: { courseId: true },
    });
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    if (user.role === 'admin') return;
    if (!session.courseId)
      throw new ForbiddenException('This session is not associated with a course you teach');
    await this.assertCourse(user, session.courseId);
  }

  private async assertCourse(user: RequestUser, courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (user.role !== 'admin' && course.teacherId !== user.id) {
      throw new ForbiddenException('You can only analyse your own courses');
    }
  }

  @Get('library')
  library() {
    return this.service.library();
  }

  @Get('parameter-sets')
  parameterSets() {
    return this.service.listParameterSets();
  }

  @Post('parameter-sets')
  createParameterSet(
    @Request() req: { user: RequestUser },
    @Body(new ZodValidationPipe(ParameterSetSchema)) body: z.infer<typeof ParameterSetSchema>,
  ) {
    return this.service.createParameterSet(body.values, body.note, req.user.id);
  }

  @Get('sessions/:sessionId')
  async sessionEvents(
    @Request() req: { user: RequestUser },
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
  ) {
    await this.assertSession(req.user, sessionId);
    return this.service.sessionEvents(sessionId);
  }

  @Post('sessions/:sessionId/recompute')
  async recomputeSession(
    @Request() req: { user: RequestUser },
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Query('parameterSetVersion') version?: string,
  ) {
    await this.assertSession(req.user, sessionId);
    return this.service.computeSession(sessionId, versionQuery(version));
  }

  @Post('courses/:courseId/recompute')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async recomputeCourse(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
    @Query('parameterSetVersion') version?: string,
  ) {
    await this.assertCourse(req.user, courseId);
    return this.service.computeCourse(courseId, versionQuery(version));
  }

  @Get('courses/:courseId/coverage')
  async coverage(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
  ) {
    await this.assertCourse(req.user, courseId);
    return this.service.coverage(courseId);
  }
}
