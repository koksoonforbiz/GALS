import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
  Res,
  Header,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { CurriculumCoverageService } from './curriculum-coverage.service';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('courses/:courseId/curriculum-coverage')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class CurriculumCoverageController {
  constructor(private readonly coverageService: CurriculumCoverageService) {}

  /** Start a curriculum coverage analysis run */
  @Post('run')
  startRun(
    @Param('courseId') courseId: string,
    @Request() req: { user: RequestUser },
    @Body() dto: { syllabusText: string },
  ) {
    return this.coverageService.startCoverage({
      courseId,
      userId: req.user.id,
      syllabusText: dto.syllabusText,
    });
  }

  /** List all coverage runs for this course */
  @Get('runs')
  listRuns(
    @Param('courseId') courseId: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.coverageService.listRuns(courseId, req.user.id);
  }

  /** Get a specific run with full results */
  @Get('runs/:runId')
  getRun(
    @Param('runId') runId: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.coverageService.getRun(runId, req.user.id);
  }

  /** Update a single outcome→KC mapping (admin override) */
  @Post('runs/:runId/mappings')
  updateMapping(
    @Param('runId') runId: string,
    @Request() req: { user: RequestUser },
    @Body() dto: { outcomeId: string; kcId: string; confidence: number; rationale: string },
  ) {
    return this.coverageService.updateOutcomeKcMap(
      runId,
      req.user.id,
      dto.outcomeId,
      dto.kcId,
      dto.confidence,
      dto.rationale,
    );
  }

  /** Remove a single outcome→KC mapping */
  @Delete('runs/:runId/mappings')
  removeMapping(
    @Param('runId') runId: string,
    @Request() req: { user: RequestUser },
    @Body() dto: { outcomeId: string; kcId: string },
  ) {
    return this.coverageService.removeOutcomeKcMap(
      runId,
      req.user.id,
      dto.outcomeId,
      dto.kcId,
    );
  }

  /** Re-analyze coverage after manual mapping changes */
  @Post('runs/:runId/reanalyze')
  reanalyze(
    @Param('runId') runId: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.coverageService.reanalyze(runId, req.user.id);
  }

  /** Export coverage results as JSON */
  @Get('runs/:runId/export-json')
  @Header('Content-Type', 'application/json')
  async exportJson(
    @Param('runId') runId: string,
    @Request() req: { user: RequestUser },
    @Res() res: Response,
  ) {
    const run = await this.coverageService.getRun(runId, req.user.id);
    const filename = `curriculum-coverage-${runId.slice(0, 8)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json({
      parsedOutcomes: run.parsedOutcomes,
      outcomeKcMaps: run.outcomeKcMaps,
      coverageResults: run.coverageResults,
    });
  }
}
