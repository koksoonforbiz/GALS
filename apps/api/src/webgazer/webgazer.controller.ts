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
import { WebgazerService } from './webgazer.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-action.enum';
import type { WebgazerConfigDto } from './dto/webgazer-config.dto';
import type { WebgazerBatchDto } from './dto/create-gaze-log.dto';
import type { CalibrationEventDto } from './dto/calibration-event.dto';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('webgazer')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WebgazerController {
  constructor(
    private readonly webgazerService: WebgazerService,
    private readonly activityLog: ActivityLogService,
  ) {}

  @Get('config/:courseId')
  @Roles('teacher', 'student')
  getConfig(@Param('courseId') courseId: string) {
    return this.webgazerService.getConfig(courseId);
  }

  @Patch('config/:courseId')
  @Roles('teacher')
  updateConfig(@Param('courseId') courseId: string, @Body() dto: WebgazerConfigDto) {
    return this.webgazerService.updateConfig(courseId, dto);
  }

  @Post('logs')
  @Roles('student')
  async bulkCreateLogs(@Request() req: { user: RequestUser }, @Body() dto: WebgazerBatchDto) {
    await this.webgazerService.bulkCreateLogs(
      req.user.id,
      dto.sessionId,
      dto.courseId,
      dto.readings,
    );
    this.activityLog.record({
      sessionId: dto.sessionId,
      userId: req.user.id,
      action: ActivityAction.WEBGAZER_BATCH_SUBMITTED,
      courseId: dto.courseId,
      metadata: { readingCount: dto.readings.length },
    });
  }

  @Post('calibration')
  @Roles('student')
  async recordCalibration(@Request() req: { user: RequestUser }, @Body() dto: CalibrationEventDto) {
    const event = await this.webgazerService.recordCalibrationEvent(req.user.id, dto);
    const action = dto.completedAt
      ? ActivityAction.WEBGAZER_CALIBRATION_COMPLETED
      : ActivityAction.WEBGAZER_CALIBRATION_STARTED;
    this.activityLog.record({
      sessionId: dto.sessionId,
      userId: req.user.id,
      action,
      courseId: dto.courseId,
      metadata: { triggeredBy: dto.triggeredBy, accuracy: dto.accuracy },
    });
    return event;
  }

  @Get('logs/:studentId/:courseId')
  @Roles('teacher')
  getLogs(
    @Param('studentId') studentId: string,
    @Param('courseId') courseId: string,
    @Query('sessionId') sessionId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.webgazerService.getLogs(studentId, courseId, {
      sessionId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  @Get('logs/:studentId/:sessionId/export')
  exportCsv(@Param('studentId') studentId: string, @Param('sessionId') sessionId: string) {
    return this.webgazerService.exportSessionCsv(studentId, sessionId);
  }

  @Get('calibration/:studentId/:courseId')
  @Roles('teacher')
  getCalibrationHistory(
    @Param('studentId') studentId: string,
    @Param('courseId') courseId: string,
  ) {
    return this.webgazerService.getCalibrationHistory(studentId, courseId);
  }
}
