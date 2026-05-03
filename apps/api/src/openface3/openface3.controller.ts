import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Openface3Service } from './openface3.service';

@Controller('openface3')
@UseGuards(JwtAuthGuard, RolesGuard)
export class Openface3Controller {
  constructor(private readonly service: Openface3Service) {}

  @Get('jobs/:id')
  @Roles('teacher', 'admin')
  getJob(@Param('id') id: string) {
    return this.service.getJob(id);
  }

  @Get('jobs')
  @Roles('teacher', 'admin')
  listJobs(@Query('sessionId') sessionId?: string, @Query('status') status?: string) {
    return this.service.listJobs({ sessionId, status });
  }

  @Post('jobs/:id/retry')
  @Roles('teacher', 'admin')
  retryJob(@Param('id') id: string) {
    return this.service.retryJob(id);
  }

  @Get('frames')
  @Roles('teacher', 'admin')
  getFrames(
    @Query('sessionId') sessionId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getFrames({
      sessionId,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('frames/student/:studentId')
  @Roles('teacher', 'admin')
  getStudentFrames(
    @Param('studentId') studentId: string,
    @Query('courseId') courseId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getStudentFrames(studentId, { courseId, from, to });
  }

  @Get('frames/session/:sessionId/summary')
  @Roles('teacher', 'admin')
  getSessionSummary(@Param('sessionId') sessionId: string) {
    return this.service.getSessionSummary(sessionId);
  }
}
