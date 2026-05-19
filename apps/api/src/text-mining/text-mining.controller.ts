import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  Request,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotImplementedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CONSTRUCTS } from './detection/constructs';
import { TeacherSettingsService } from './settings/teacher-settings.service';
import { DashboardService } from './dashboard/dashboard.service';
import { PromptsService } from './prompts/prompts.service';
import { PrismaService } from '../prisma/prisma.service';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('text-mining')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TextMiningController {
  constructor(
    private readonly teacherSettings: TeacherSettingsService,
    private readonly dashboard: DashboardService,
    private readonly prompts: PromptsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('constructs')
  @Roles('teacher', 'admin')
  getConstructs() {
    return CONSTRUCTS;
  }

  // ─── Dashboard (stage 3) ──────────────────────────────

  @Get('sessions/:sessionId/dashboard')
  @Roles('teacher', 'admin')
  async getSessionDashboard(
    @Param('sessionId') sessionId: string,
    @Request() req: { user: RequestUser },
  ) {
    const settings = await this.teacherSettings.getSettings(req.user.id);
    return this.dashboard.getSessionDashboard(sessionId, settings.rollingWindowN);
  }

  @Get('sessions/:sessionId/detections')
  @Roles('teacher', 'admin')
  getDetections(
    @Param('sessionId') sessionId: string,
    @Query('constructKey') constructKey?: string,
    @Query('label') label?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.dashboard.getDetections(sessionId, {
      constructKey,
      label,
      cursor,
      limit: Math.min(200, Math.max(1, parseInt(limit ?? '50', 10) || 50)),
    });
  }

  @Get('sessions/:sessionId/detections.csv')
  @Roles('teacher', 'admin')
  async getDetectionsCsv(@Param('sessionId') sessionId: string, @Res() res: Response) {
    const detections = await this.prisma.efDetection.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });

    const header =
      'timestamp,messageId,studentId,constructKey,label,severity,confidence,rationale,warning,model,promptVersion';
    const rows = detections.map(
      (d) =>
        `${d.createdAt.toISOString()},${d.messageId},${d.studentId},${d.constructKey},${d.label},${d.severity ?? ''},${d.confidence ?? ''},${csvEscape(d.rationale ?? '')},${csvEscape(d.warning ?? '')},${d.model},${d.promptVersion}`,
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="text-mining-${sessionId}.csv"`);
    res.send([header, ...rows].join('\n'));
  }

  @Get('students/:studentId/dashboard')
  @Roles('teacher', 'admin')
  async getStudentDashboard(
    @Param('studentId') studentId: string,
    @Query('courseId') courseId: string | undefined,
    @Request() req: { user: RequestUser },
  ) {
    const settings = await this.teacherSettings.getSettings(req.user.id);
    return this.dashboard.getStudentDashboard(studentId, courseId, settings.rollingWindowN);
  }

  // ─── Prompts (stage 4) ────────────────────────────────

  @Get('courses/:courseId/prompts')
  @Roles('teacher', 'admin')
  getCoursePrompts(@Param('courseId') courseId: string) {
    return this.prompts.getPromptsForCourse(courseId);
  }

  @Put('courses/:courseId/prompts')
  @Roles('teacher', 'admin')
  updateCoursePrompt(
    @Param('courseId') courseId: string,
    @Body() body: { constructKey: string; promptText: string },
    @Request() req: { user: RequestUser },
  ) {
    return this.prompts.updatePrompt(courseId, body.constructKey, body.promptText, req.user.id);
  }

  @Post('courses/:courseId/prompts/reset')
  @Roles('teacher', 'admin')
  @HttpCode(HttpStatus.OK)
  resetCoursePrompts(@Param('courseId') courseId: string, @Body() body: { constructKey?: string }) {
    return this.prompts.resetPrompts(courseId, body.constructKey);
  }

  @Get('courses/:courseId/prompts/:constructKey/versions/:version')
  @Roles('teacher', 'admin')
  async getPromptVersion(
    @Param('courseId') courseId: string,
    @Param('constructKey') constructKey: string,
    @Param('version') version: string,
  ) {
    const prompt = await this.prisma.efConstructPrompt.findFirst({
      where: {
        OR: [
          { courseId, constructKey, version: parseInt(version, 10) },
          { courseId: null, constructKey, version: parseInt(version, 10) },
        ],
      },
    });
    return prompt ?? { error: 'Prompt version not found' };
  }

  @Post('prompts/try')
  @Roles('teacher', 'admin')
  @HttpCode(HttpStatus.OK)
  tryPrompt(
    @Body()
    body: {
      constructKey: string;
      promptText: string;
      utterance: string;
      courseTopic?: string;
      courseId?: string;
    },
    @Request() req: { user: RequestUser },
  ) {
    return this.prompts.tryPrompt({
      teacherId: req.user.id,
      constructKey: body.constructKey,
      promptText: body.promptText,
      utterance: body.utterance,
      courseTopic: body.courseTopic,
      courseId: body.courseId,
    });
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
    throw new NotImplementedException(); // TODO stage 2 enhancement
  }
}

function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}
