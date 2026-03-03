import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { DialogueService } from './dialogue.service';
import { StudioService } from './studio.service';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import type { UserRole } from '@ats/shared';

interface RequestUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

@Controller('dialogue')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('student')
export class DialogueController {
  constructor(
    private readonly dialogueService: DialogueService,
    private readonly studioService: StudioService,
  ) {}

  // ─── Sessions ─────────────────────────────────────────────

  @Post('courses/:courseId/sessions')
  createSession(
    @Request() req: { user: RequestUser },
    @Param('courseId') courseId: string,
    @Body() dto: { title?: string; activeSourceIds?: string[] },
  ) {
    return this.dialogueService.createSession(req.user.id, courseId, dto);
  }

  @Get('courses/:courseId/sessions')
  listSessions(@Request() req: { user: RequestUser }, @Param('courseId') courseId: string) {
    return this.dialogueService.listSessions(req.user.id, courseId);
  }

  @Get('sessions/:sessionId')
  getSession(@Request() req: { user: RequestUser }, @Param('sessionId') sessionId: string) {
    return this.dialogueService.getSession(sessionId, req.user.id);
  }

  @Patch('sessions/:sessionId')
  updateSession(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
    @Body() dto: { title?: string; activeSourceIds?: string[] },
  ) {
    return this.dialogueService.updateSession(sessionId, req.user.id, dto);
  }

  @Delete('sessions/:sessionId')
  deleteSession(@Request() req: { user: RequestUser }, @Param('sessionId') sessionId: string) {
    return this.dialogueService.deleteSession(sessionId, req.user.id);
  }

  // ─── Chat ─────────────────────────────────────────────────

  @Post('sessions/:sessionId/messages')
  sendMessage(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
    @Body() dto: { content: string; activeSourceIds?: string[] },
  ) {
    return this.dialogueService.sendMessage(sessionId, req.user.id, dto);
  }

  @Get('sessions/:sessionId/messages')
  getMessages(@Request() req: { user: RequestUser }, @Param('sessionId') sessionId: string) {
    return this.dialogueService.getMessages(sessionId, req.user.id);
  }

  // ─── Studio ───────────────────────────────────────────────

  @Post('courses/:courseId/studio')
  generateStudioOutput(
    @Request() req: { user: RequestUser },
    @Param('courseId') courseId: string,
    @Body()
    dto: {
      type: 'BRIEFING_DOC' | 'FLASHCARD_SET' | 'TABLE_COMPARISON' | 'MIND_MAP' | 'TIMELINE' | 'FAQ';
      sourceIds: string[];
      promptHint?: string;
      sessionId?: string;
    },
  ) {
    return this.studioService.generate(req.user.id, courseId, dto);
  }

  @Get('sessions/:sessionId/studio')
  listStudioOutputs(@Request() req: { user: RequestUser }, @Param('sessionId') sessionId: string) {
    return this.studioService.listOutputs(sessionId, req.user.id);
  }

  @Delete('studio/:outputId')
  deleteStudioOutput(@Request() req: { user: RequestUser }, @Param('outputId') outputId: string) {
    return this.studioService.deleteOutput(outputId, req.user.id);
  }

  // ─── Intervention Linking ─────────────────────────────────

  @Post('sessions/:sessionId/interventions')
  async linkIntervention(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
    @Body()
    dto: {
      type:
        | 'PRACTICE_TESTING'
        | 'DISTRIBUTED_PRACTICE'
        | 'STEPWISE_LEARNING'
        | 'INTERROGATIVE_ELABORATION';
      selectedText: string;
      contentId?: string;
      pageType?: string;
    },
  ) {
    // Verify session ownership
    const session = await this.dialogueService.getSession(sessionId, req.user.id);

    return this.dialogueService['prisma'].learningIntervention.create({
      data: {
        userId: req.user.id,
        courseId: session.courseId,
        type: dto.type,
        selectedText: dto.selectedText,
        contentId: dto.contentId,
        pageType: dto.pageType,
        dialogueSessionId: sessionId,
      },
    });
  }

  @Get('sessions/:sessionId/interventions')
  async listInterventions(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
  ) {
    await this.dialogueService.getSession(sessionId, req.user.id);

    return this.dialogueService['prisma'].learningIntervention.findMany({
      where: { dialogueSessionId: sessionId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
