import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PupilSizeService } from './pupil-size.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-action.enum';
import type { PupilSizeConfigDto } from './dto/pupil-size-config.dto';
import type { PupilSizeBatchDto } from './dto/create-pupil-log.dto';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('pupil-size')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PupilSizeController {
  constructor(
    private readonly pupilSizeService: PupilSizeService,
    private readonly activityLog: ActivityLogService,
  ) {}

  @Get('config/:courseId')
  @Roles('teacher', 'student')
  getConfig(@Param('courseId') courseId: string) {
    return this.pupilSizeService.getConfig(courseId);
  }

  @Patch('config/:courseId')
  @Roles('teacher')
  updateConfig(@Param('courseId') courseId: string, @Body() dto: PupilSizeConfigDto) {
    return this.pupilSizeService.updateConfig(courseId, dto);
  }

  @Post('logs')
  @Roles('student')
  async bulkCreateLogs(@Request() req: { user: RequestUser }, @Body() dto: PupilSizeBatchDto) {
    await this.pupilSizeService.bulkCreateLogs(
      req.user.id,
      dto.sessionId,
      dto.courseId,
      dto.readings,
    );
    this.activityLog.record({
      sessionId: dto.sessionId,
      userId: req.user.id,
      action: ActivityAction.PUPIL_SIZE_BATCH_SUBMITTED,
      courseId: dto.courseId,
      metadata: { readingCount: dto.readings.length },
    });
  }

  @Get('logs/:studentId/:courseId')
  @Roles('teacher')
  getLogs(
    @Param('studentId') studentId: string,
    @Param('courseId') courseId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.pupilSizeService.getLogsForStudent(studentId, courseId, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  @Get('logs/:studentId/:sessionId/export')
  exportCsv(@Param('studentId') studentId: string, @Param('sessionId') sessionId: string) {
    return this.pupilSizeService.exportSessionCsv(studentId, sessionId);
  }
}
