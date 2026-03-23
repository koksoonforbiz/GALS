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
import type { PupilSizeConfigDto } from './dto/pupil-size-config.dto';
import type { PupilSizeBatchDto } from './dto/create-pupil-log.dto';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('pupil-size')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PupilSizeController {
  constructor(private readonly pupilSizeService: PupilSizeService) {}

  @Get('config/:courseId')
  @Roles('teacher')
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
  bulkCreateLogs(@Request() req: { user: RequestUser }, @Body() dto: PupilSizeBatchDto) {
    return this.pupilSizeService.bulkCreateLogs(
      req.user.id,
      dto.sessionId,
      dto.courseId,
      dto.readings,
    );
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
