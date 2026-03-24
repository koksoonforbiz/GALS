import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PyfeatService } from './pyfeat.service';
import type { PyfeatConfigDto } from './dto/pyfeat-config.dto';
import type { EnqueueJobDto } from './dto/enqueue-job.dto';

@Controller('pyfeat')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PyfeatController {
  constructor(private readonly pyfeatService: PyfeatService) {}

  @Get('config/:courseId')
  @Roles('teacher', 'student')
  getConfig(@Param('courseId') courseId: string) {
    return this.pyfeatService.getConfig(courseId);
  }

  @Patch('config/:courseId')
  @Roles('teacher')
  updateConfig(@Param('courseId') courseId: string, @Body() dto: PyfeatConfigDto) {
    return this.pyfeatService.updateConfig(courseId, dto);
  }

  @Post('jobs')
  @Roles('teacher')
  enqueueJob(@Body() dto: EnqueueJobDto) {
    return this.pyfeatService.enqueueJob(dto);
  }

  @Get('jobs/:studentId/:courseId')
  @Roles('teacher')
  getJobs(@Param('studentId') studentId: string, @Param('courseId') courseId: string) {
    return this.pyfeatService.getJobs(studentId, courseId);
  }

  @Get('jobs/:jobId/results')
  @Roles('teacher')
  getJobResults(@Param('jobId') jobId: string) {
    return this.pyfeatService.getJobResults(jobId);
  }

  @Get('jobs/:jobId/export')
  @Roles('teacher')
  exportJobCsv(@Param('jobId') jobId: string) {
    return this.pyfeatService.exportJobCsv(jobId);
  }
}
