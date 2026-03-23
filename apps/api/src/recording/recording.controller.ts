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
  getConfig(@Param('courseId') courseId: string) {
    return this.recordingService.getConfig(courseId);
  }

  @Patch('config/:courseId')
  @Roles('teacher')
  updateConfig(@Param('courseId') courseId: string, @Body() dto: RecordingConfigDto) {
    return this.recordingService.updateConfig(courseId, dto);
  }

  // ─── Segments (student) ───────────────────────────────

  @Post('segments/initiate')
  @Roles('student')
  initiateSegment(@Request() req: { user: RequestUser }, @Body() dto: CreateSegmentDto) {
    return this.recordingService.initiateSegment(req.user.id, dto);
  }

  @Patch('segments/:segmentId/complete')
  completeSegment(@Param('segmentId') segmentId: string, @Body() dto: CompleteSegmentDto) {
    return this.recordingService.completeSegment(segmentId, dto);
  }

  @Patch('segments/:segmentId/fail')
  failSegment(@Param('segmentId') segmentId: string, @Body() body: { error: string }) {
    return this.recordingService.failSegment(segmentId, body.error);
  }

  // ─── Segments (teacher) ───────────────────────────────

  @Get('segments/:studentId/:courseId')
  @Roles('teacher')
  getSegments(@Param('studentId') studentId: string, @Param('courseId') courseId: string) {
    return this.recordingService.getSegments(studentId, courseId);
  }

  @Get('segments/:segmentId/download')
  @Roles('teacher')
  getDownloadUrl(@Param('segmentId') segmentId: string) {
    return this.recordingService.getDownloadUrl(segmentId);
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
