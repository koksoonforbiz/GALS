import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  Res,
  Header,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { KcEvaluationService } from './kc-evaluation.service';
import { KcEvalScope, KcEvalDepth } from './kc-evaluation.types';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('courses/:courseId/kc-evaluation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class KcEvaluationController {
  constructor(private readonly kcEvalService: KcEvaluationService) {}

  /** Start a KC-aware evaluation run */
  @Post('run')
  startRun(
    @Param('courseId') courseId: string,
    @Request() req: { user: RequestUser },
    @Body() dto: { scope: KcEvalScope; depth: KcEvalDepth },
  ) {
    return this.kcEvalService.startEvaluation({
      courseId,
      userId: req.user.id,
      scope: dto.scope,
      depth: dto.depth,
    });
  }

  /** Get a specific run */
  @Get('runs/:runId')
  getRun(
    @Param('runId') runId: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.kcEvalService.getRun(runId, req.user.id);
  }

  /** List all KC evaluation runs for this course */
  @Get('runs')
  listRuns(
    @Param('courseId') courseId: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.kcEvalService.listRuns(courseId, req.user.id);
  }

  /** Export evaluation results as JSON */
  @Get('runs/:runId/export-json')
  @Header('Content-Type', 'application/json')
  async exportJson(
    @Param('runId') runId: string,
    @Request() req: { user: RequestUser },
    @Res() res: Response,
  ) {
    const run = await this.kcEvalService.getRun(runId, req.user.id);
    const filename = `kc-evaluation-${runId.slice(0, 8)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(run.results);
  }
}
