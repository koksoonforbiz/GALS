import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { EvaluationService } from './evaluation.service';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import type { UserRole } from '@ats/shared';
import type { EvalConfig } from './evaluation-prompts';

interface RequestUser {
  id: string;
  role: UserRole;
}

@Controller('courses/:courseId/evaluation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class EvaluationController {
  constructor(private readonly evaluationService: EvaluationService) {}

  // GET /courses/:courseId/evaluation/tree — page tree for selector
  @Get('tree')
  getPageTree(@Request() req: { user: RequestUser }, @Param('courseId') courseId: string) {
    return this.evaluationService.getCoursePageTree(courseId, req.user.id);
  }

  // POST /courses/:courseId/evaluation/run — start evaluation
  @Post('run')
  startRun(
    @Request() req: { user: RequestUser },
    @Param('courseId') courseId: string,
    @Body() body: { pageIds: string[]; config: EvalConfig },
  ) {
    return this.evaluationService.startEvaluation({
      courseId,
      userId: req.user.id,
      pageIds: body.pageIds,
      config: body.config,
    });
  }

  // GET /courses/:courseId/evaluation/runs — list runs
  @Get('runs')
  listRuns(@Request() req: { user: RequestUser }, @Param('courseId') courseId: string) {
    return this.evaluationService.listRuns(courseId, req.user.id);
  }

  // GET /courses/:courseId/evaluation/runs/:runId — get run + results
  @Get('runs/:runId')
  getRun(@Request() req: { user: RequestUser }, @Param('runId') runId: string) {
    return this.evaluationService.getRun(runId, req.user.id);
  }

  // POST /courses/:courseId/evaluation/apply-fixes — apply auto-fixes
  @Post('apply-fixes')
  applyFixes(
    @Request() req: { user: RequestUser },
    @Param('courseId') courseId: string,
    @Body()
    body: { resultId: string; fixTypes: ('math' | 'formatting' | 'llm')[]; issueIndex?: number },
  ) {
    return this.evaluationService.applyFixes({
      courseId,
      userId: req.user.id,
      resultId: body.resultId,
      fixTypes: body.fixTypes,
      issueIndex: body.issueIndex,
    });
  }
}
