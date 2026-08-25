import { Controller, Get, Post, Patch, Param, Body, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RecordingService } from './recording.service';
import type { RecordingConfigDto } from './dto/recording-config.dto';
import type { CreateSegmentDto } from './dto/create-segment.dto';
import type { CompleteSegmentDto } from './dto/complete-segment.dto';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('recording')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecordingController {
  constructor(private readonly recordingService: RecordingService) {}

  // ─── Config (teacher) ─────────────────────────────────

  @Get('config/:courseId')
  @Roles('teacher', 'student')
  getConfig(@Request() req: { user: RequestUser }, @Param('courseId') courseId: string) {
    return this.recordingService.getConfig(courseId, req.user);
  }

  @Patch('config/:courseId')
  @Roles('teacher')
  updateConfig(
    @Request() req: { user: RequestUser },
    @Param('courseId') courseId: string,
    @Body() dto: RecordingConfigDto,
  ) {
    return this.recordingService.updateConfig(courseId, req.user.id, dto);
  }

  // ─── Segments (student) ───────────────────────────────

  @Post('segments/initiate')
  @Roles('student')
  initiateSegment(@Request() req: { user: RequestUser }, @Body() dto: CreateSegmentDto) {
    return this.recordingService.initiateSegment(req.user.id, dto);
  }

  @Patch('segments/:segmentId/complete')
  @Roles('student')
  completeSegment(
    @Request() req: { user: RequestUser },
    @Param('segmentId') segmentId: string,
    @Body() dto: CompleteSegmentDto,
  ) {
    return this.recordingService.completeSegment(segmentId, req.user.id, dto);
  }

  @Patch('segments/:segmentId/fail')
  @Roles('student')
  failSegment(
    @Request() req: { user: RequestUser },
    @Param('segmentId') segmentId: string,
    @Body() body: { error: string },
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
