import { Controller, Get, Post, Patch, Param, Body, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SecurityEventService } from '../auth/security-event.service';
import { ZodValidationPipe } from '../common';
import { RecordingService } from './recording.service';
import type { RecordingConfigDto } from './dto/recording-config.dto';
import type { CreateSegmentDto } from './dto/create-segment.dto';
import type { CompleteSegmentDto } from './dto/complete-segment.dto';
import {
  RecordingConfigSchema,
  CreateSegmentSchema,
  CompleteSegmentSchema,
  FailSegmentSchema,
} from '@ats/shared';
import type { FailSegmentInput } from '@ats/shared';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('recording')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecordingController {
  constructor(
    private readonly recordingService: RecordingService,
    private readonly securityEvents: SecurityEventService,
  ) {}

  // ─── Config (teacher) ─────────────────────────────────

  @Get('config/:courseId')
  @Roles('teacher', 'student')
  getConfig(@Request() req: { user: RequestUser }, @Param('courseId') courseId: string) {
    return this.recordingService.getConfig(courseId, req.user);
  }

  @Patch('config/:courseId')
  @Roles('teacher')
  async updateConfig(
    @Request() req: { user: RequestUser },
    @Param('courseId') courseId: string,
    @Body(new ZodValidationPipe(RecordingConfigSchema)) dto: RecordingConfigDto,
  ) {
    const result = await this.recordingService.updateConfig(courseId, req.user.id, dto);
    // Checklist item 25 — this config directly controls what biometric
    // data gets collected from students, so it's worth its own audit
    // trail with the actual values, not just which fields changed.
    this.securityEvents.record({
      type: 'CONFIG_CHANGED',
      userId: req.user.id,
      metadata: { resource: 'recording_config', courseId, ...dto },
    });
    return result;
  }

  // ─── Segments (student) ───────────────────────────────

  @Post('segments/initiate')
  @Roles('student')
  initiateSegment(
    @Request() req: { user: RequestUser },
    @Body(new ZodValidationPipe(CreateSegmentSchema)) dto: CreateSegmentDto,
  ) {
    return this.recordingService.initiateSegment(req.user.id, dto);
  }

  @Patch('segments/:segmentId/complete')
  @Roles('student')
  completeSegment(
    @Request() req: { user: RequestUser },
    @Param('segmentId') segmentId: string,
    @Body(new ZodValidationPipe(CompleteSegmentSchema)) dto: CompleteSegmentDto,
  ) {
    return this.recordingService.completeSegment(segmentId, req.user.id, dto);
  }

  @Patch('segments/:segmentId/fail')
  @Roles('student')
  failSegment(
    @Request() req: { user: RequestUser },
    @Param('segmentId') segmentId: string,
    @Body(new ZodValidationPipe(FailSegmentSchema)) body: FailSegmentInput,
  ) {
    return this.recordingService.failSegment(segmentId, req.user.id, body.error);
  }

  // ─── Segments (teacher) ───────────────────────────────

  @Get('segments/:segmentId/download')
  @Roles('teacher')
  async getDownloadUrl(
    @Request() req: { user: RequestUser },
    @Param('segmentId') segmentId: string,
  ) {
    const url = await this.recordingService.getDownloadUrl(segmentId, req.user.id);
    return { url };
  }

  @Get('segments/:studentId/:courseId')
  @Roles('teacher')
  getSegments(
    @Request() req: { user: RequestUser },
    @Param('studentId') studentId: string,
    @Param('courseId') courseId: string,
  ) {
    return this.recordingService.getSegments(studentId, courseId, req.user.id);
  }

  // ─── Consent (student) ────────────────────────────────

  @Get('consent/:courseId')
  @Roles('student')
  getConsent(@Request() req: { user: RequestUser }, @Param('courseId') courseId: string) {
    return this.recordingService.getConsent(req.user.id, courseId);
  }

  @Post('consent/:courseId')
  @Roles('student')
  giveConsent(@Request() req: { user: RequestUser }, @Param('courseId') courseId: string) {
    return this.recordingService.giveConsent(req.user.id, courseId);
  }
}
