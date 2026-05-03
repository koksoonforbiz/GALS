import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotImplementedException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CONSTRUCTS } from './detection/constructs';
import { TeacherSettingsService } from './settings/teacher-settings.service';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('text-mining')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TextMiningController {
  constructor(private readonly teacherSettings: TeacherSettingsService) {}

  @Get('constructs')
  @Roles('teacher', 'admin')
  getConstructs() {
    return CONSTRUCTS;
  }

  // ─── Dashboard (stage 3) ──────────────────────────────

  @Get('sessions/:sessionId/dashboard')
  @Roles('teacher', 'admin')
  getSessionDashboard() {
    throw new NotImplementedException(); // TODO stage 3
  }

  @Get('sessions/:sessionId/detections')
  @Roles('teacher', 'admin')
  getDetections() {
    throw new NotImplementedException(); // TODO stage 3
  }

  @Get('sessions/:sessionId/detections.csv')
  @Roles('teacher', 'admin')
  getDetectionsCsv() {
    throw new NotImplementedException(); // TODO stage 3
  }

  @Get('students/:studentId/dashboard')
  @Roles('teacher', 'admin')
  getStudentDashboard() {
    throw new NotImplementedException(); // TODO stage 3
  }

  // ─── Prompts (stage 4) ────────────────────────────────

  @Get('courses/:courseId/prompts')
  @Roles('teacher', 'admin')
  getCoursePrompts() {
    throw new NotImplementedException(); // TODO stage 4
  }

  @Put('courses/:courseId/prompts')
  @Roles('teacher', 'admin')
  updateCoursePrompt() {
    throw new NotImplementedException(); // TODO stage 4
  }

  @Post('courses/:courseId/prompts/reset')
  @Roles('teacher', 'admin')
  @HttpCode(HttpStatus.OK)
  resetCoursePrompts() {
    throw new NotImplementedException(); // TODO stage 4
  }

  @Get('courses/:courseId/prompts/:constructKey/versions/:version')
  @Roles('teacher', 'admin')
  getPromptVersion() {
    throw new NotImplementedException(); // TODO stage 4
  }

  @Post('prompts/try')
  @Roles('teacher', 'admin')
  @HttpCode(HttpStatus.OK)
  tryPrompt() {
    throw new NotImplementedException(); // TODO stage 4
  }

  // ─── Teacher Settings ─────────────────────────────────

  @Get('teacher-settings')
  @Roles('teacher', 'admin')
  getTeacherSettings(@Request() req: { user: RequestUser }) {
    return this.teacherSettings.getSettings(req.user.id);
  }

  @Put('teacher-settings')
  @Roles('teacher', 'admin')
  updateTeacherSettings(
    @Request() req: { user: RequestUser },
    @Body()
    body: Partial<{
      rollingWindowN: number;
      detectionConcurrency: number;
      disableLowFeasibility: boolean;
      pauseIngestion: boolean;
      detectionProviderOverride: string | null;
      detectionModelOverride: string | null;
    }>,
  ) {
    return this.teacherSettings.updateSettings(req.user.id, body);
  }

  // ─── Reprocess (stage 2) ──────────────────────────────

  @Post('sessions/:sessionId/reprocess')
  @Roles('teacher', 'admin')
  @HttpCode(HttpStatus.OK)
  reprocessSession() {
    throw new NotImplementedException(); // TODO stage 2
  }
}
