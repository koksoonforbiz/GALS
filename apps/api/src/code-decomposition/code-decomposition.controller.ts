import { Controller, Get, Post, Patch, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { CodeDecompositionService } from './code-decomposition.service';
import { JwtAuthGuard } from '../auth';
import { SessionId } from '../common';
import type {
  GenerateDecompositionDto,
  InferTreeDto,
  MutateNodeDto,
  NodeHintDto,
  SubmitCodeDto,
  AdoptSolutionDto,
} from './dto';

interface RequestUser {
  id: string;
  role: string;
}

// ThrottlerGuard is opt-in per controller in this codebase (no global
// APP_GUARD binding it — see auth.controller.ts for the only other
// precedent), so it must be applied here explicitly for @Throttle to have
// any effect. check-tree/infer-tree/hint get tighter overrides than the
// global default (30/min) since this module is the most LLM-call-dense
// feature in the app — see the DBox plan's Throttling section. Every
// LLM-calling action also has its own session-level cap enforced in the
// service (formationCheckCount/inferTreeCount), since a per-minute limit
// alone doesn't stop a slow, hour-long spam session.
@Controller('code-decomposition')
@UseGuards(JwtAuthGuard, ThrottlerGuard)
export class CodeDecompositionController {
  constructor(private readonly service: CodeDecompositionService) {}

  @Post('generate')
  generate(@Request() req: { user: RequestUser }, @Body() dto: GenerateDecompositionDto) {
    return this.service.generateSession(req.user.id, dto);
  }

  @Get(':sessionId')
  getSession(@Request() req: { user: RequestUser }, @Param('sessionId') sessionId: string) {
    return this.service.getSession(req.user.id, sessionId);
  }

  @Post(':sessionId/infer-tree')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  inferTree(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
    @Body() dto: InferTreeDto,
  ) {
    return this.service.inferTree(req.user.id, sessionId, dto);
  }

  @Post(':sessionId/check-tree')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  checkTree(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
    @SessionId() activitySessionId?: string,
  ) {
    return this.service.checkTree(req.user.id, sessionId, activitySessionId);
  }

  @Patch(':sessionId/nodes')
  mutateNode(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
    @Body() dto: MutateNodeDto,
  ) {
    return this.service.mutateNode(req.user.id, sessionId, dto);
  }

  @Post(':sessionId/nodes/:nodeId/hint')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  getNodeHint(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: NodeHintDto,
    @SessionId() activitySessionId?: string,
  ) {
    return this.service.getNodeHint(req.user.id, sessionId, nodeId, dto, activitySessionId);
  }

  @Post(':sessionId/nodes/:nodeId/reveal')
  revealNode(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
    @Param('nodeId') nodeId: string,
    @SessionId() activitySessionId?: string,
  ) {
    return this.service.revealNode(req.user.id, sessionId, nodeId, activitySessionId);
  }

  @Post(':sessionId/nodes/:nodeId/show-answer')
  showAnswer(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
    @Param('nodeId') nodeId: string,
    @SessionId() activitySessionId?: string,
  ) {
    return this.service.showAnswer(req.user.id, sessionId, nodeId, activitySessionId);
  }

  @Post(':sessionId/reveal-solution')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  revealFullSolution(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
    @SessionId() activitySessionId?: string,
  ) {
    return this.service.revealFullSolution(req.user.id, sessionId, activitySessionId);
  }

  @Patch(':sessionId/adopt-solution')
  adoptSolution(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
    @Body() dto: AdoptSolutionDto,
    @SessionId() activitySessionId?: string,
  ) {
    return this.service.adoptSolution(req.user.id, sessionId, dto, activitySessionId);
  }

  @Patch(':sessionId/advance-stage')
  advanceStage(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
    @SessionId() activitySessionId?: string,
  ) {
    return this.service.advanceStage(req.user.id, sessionId, activitySessionId);
  }

  @Post(':sessionId/copy-to-comments')
  copyToComments(@Request() req: { user: RequestUser }, @Param('sessionId') sessionId: string) {
    return this.service.copyToComments(req.user.id, sessionId);
  }

  @Patch(':sessionId/code')
  syncCode(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
    @Body() dto: SubmitCodeDto,
  ) {
    return this.service.syncCode(req.user.id, sessionId, dto);
  }

  @Post(':sessionId/check-match')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  checkMatch(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
    @SessionId() activitySessionId?: string,
  ) {
    return this.service.checkMatch(req.user.id, sessionId, activitySessionId);
  }

  @Post(':sessionId/complete')
  complete(@Request() req: { user: RequestUser }, @Param('sessionId') sessionId: string) {
    return this.service.completeSession(req.user.id, sessionId);
  }
}
