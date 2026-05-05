import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Body,
  Query,
  Request,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AffectiveMappingService } from './affective-mapping.service';
import type { MappingRuleSet } from '@ats/shared';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('affective-mapping')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AffectiveMappingController {
  constructor(private readonly service: AffectiveMappingService) {}

  @Get('config/:courseId')
  @Roles('teacher', 'admin')
  getConfig(@Param('courseId') courseId: string) {
    return this.service.getConfig(courseId);
  }

  @Put('config/:courseId')
  @Roles('teacher', 'admin')
  updateConfig(
    @Param('courseId') courseId: string,
    @Body()
    body: {
      windowSeconds?: number;
      strideSeconds?: number;
      minFramesPerWindow?: number;
      rules?: MappingRuleSet;
    },
    @Request() req: { user: RequestUser },
  ) {
    return this.service.updateConfig(courseId, body, req.user.id);
  }

  @Post('config/:courseId/reset-defaults')
  @Roles('teacher', 'admin')
  @HttpCode(HttpStatus.OK)
  resetDefaults(@Param('courseId') courseId: string, @Request() req: { user: RequestUser }) {
    return this.service.resetToDefaults(courseId, req.user.id);
  }

  @Get('config/:courseId/history')
  @Roles('teacher', 'admin')
  getHistory(@Param('courseId') courseId: string) {
    return this.service.getConfigHistory(courseId);
  }

  @Post('config/:courseId/preview')
  @Roles('teacher', 'admin')
  @HttpCode(HttpStatus.OK)
  preview(
    @Param('courseId') courseId: string,
    @Body()
    body: {
      sessionId: string;
      rules: MappingRuleSet;
      windowSeconds: number;
      strideSeconds: number;
      minFramesPerWindow: number;
    },
  ) {
    return this.service.preview(
      courseId,
      body.sessionId,
      body.rules,
      body.windowSeconds,
      body.strideSeconds,
      body.minFramesPerWindow,
    );
  }

  @Get('windows')
  @Roles('teacher', 'admin')
  getWindows(
    @Query('sessionId') sessionId?: string,
    @Query('courseId') courseId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('configVersion') configVersion?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getWindows({
      sessionId,
      courseId,
      from,
      to,
      configVersion: configVersion ? parseInt(configVersion, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('windows/session/:sessionId/summary')
  @Roles('teacher', 'admin')
  getSessionSummary(@Param('sessionId') sessionId: string) {
    return this.service.getSessionSummary(sessionId);
  }

  @Get('course/:courseId/overview')
  @Roles('teacher', 'admin')
  getCourseOverview(@Param('courseId') courseId: string) {
    return this.service.getCourseOverview(courseId);
  }

  @Get('export/windows.csv')
  @Roles('teacher', 'admin')
  async exportWindowsCsv(
    @Query('sessionId') sessionId: string,
    @Query('configVersion') configVersion: string | undefined,
    @Res() res: Response,
  ) {
    const windows = await this.service.getWindows({
      sessionId,
      configVersion: configVersion ? parseInt(configVersion, 10) : undefined,
      limit: 200000,
    });

    const header =
      'windowStartWallMs,windowEndWallMs,engagement,boredom,confusion,frustration,dominantState,framesInWindow,framesWithFace,meanHappiness,meanSadness,meanSurprise,meanFear,meanAnger,meanDisgust,meanContempt,meanNeutral';
    const rows = windows.map(
      (w) =>
        `${w.windowStartWallMs},${w.windowEndWallMs},${w.engagement},${w.boredom},${w.confusion},${w.frustration},${w.dominantState},${w.framesInWindow},${w.framesWithFace},${w.meanHappiness ?? ''},${w.meanSadness ?? ''},${w.meanSurprise ?? ''},${w.meanFear ?? ''},${w.meanAnger ?? ''},${w.meanDisgust ?? ''},${w.meanContempt ?? ''},${w.meanNeutral ?? ''}`,
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="affective-windows-${sessionId}.csv"`,
    );
    res.send([header, ...rows].join('\n'));
  }
}
