import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { LearningInterventionsService } from './learning-interventions.service';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { SessionId } from '../common';
import type {
  CreateSavedReviewDto,
  UpdateSavedReviewDto,
  GeneratePracticeTestDto,
  SubmitPracticeTestAnswersDto,
  GenerateSuggestionsDto,
  AskQuestionDto,
  GenerateStepwiseDto,
  SubmitStepCheckDto,
  StepwiseCourseCheckDto,
  GenerateCardsDto,
  ReviewCardDto,
  ChatRequestDto,
} from './dto';
import type { InterventionType } from '@prisma/client';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('learning-interventions')
@UseGuards(JwtAuthGuard)
export class LearningInterventionsController {
  constructor(private readonly service: LearningInterventionsService) {}

  // ─── Prompt Config (Teacher Only) ─────────────────────────

  @Get('prompt-config/:courseId')
  @UseGuards(RolesGuard)
  @Roles('teacher', 'admin')
  getAllPromptConfigs(@Param('courseId') courseId: string) {
    return this.service.getAllPromptConfigs(courseId);
  }

  @Get('prompt-config/:courseId/:interventionType')
  @UseGuards(RolesGuard)
  @Roles('teacher', 'admin')
  getPromptConfig(
    @Param('courseId') courseId: string,
    @Param('interventionType') interventionType: InterventionType,
  ) {
    return this.service.getPromptConfig(courseId, interventionType);
  }

  @Put('prompt-config/:courseId/:interventionType')
  @UseGuards(RolesGuard)
  @Roles('teacher', 'admin')
  updatePromptConfig(
    @Request() req: { user: RequestUser },
    @Param('courseId') courseId: string,
    @Param('interventionType') interventionType: InterventionType,
    @Body() body: { systemPrompt: string },
  ) {
    return this.service.updatePromptConfig(
      courseId,
      interventionType,
      req.user.id,
      body.systemPrompt,
    );
  }

  @Delete('prompt-config/:courseId/:interventionType')
  @UseGuards(RolesGuard)
  @Roles('teacher', 'admin')
  deletePromptConfig(
    @Param('courseId') courseId: string,
    @Param('interventionType') interventionType: InterventionType,
  ) {
    return this.service.deletePromptConfig(courseId, interventionType);
  }

  // P4 — Practice Testing default counts editor. Separate from the
  // prompt PUT so we don't pollute the system-prompt validation
  // path with optional numeric body fields. Always targets the
  // PRACTICE_TESTING row.
  @Patch('prompt-config/:courseId/PRACTICE_TESTING/defaults')
  @UseGuards(RolesGuard)
  @Roles('teacher', 'admin')
  updatePracticeTestDefaults(
    @Request() req: { user: RequestUser },
    @Param('courseId') courseId: string,
    @Body()
    body: {
      defaultMcqCount: number | null;
      defaultShortAnswerCount: number | null;
    },
  ) {
    return this.service.updatePracticeTestDefaults(courseId, req.user.id, body);
  }

  @Post('prompt-config/preview')
  @UseGuards(RolesGuard)
  @Roles('teacher', 'admin')
  previewPrompt(
    @Request() req: { user: RequestUser },
    @Body()
    body: {
      systemPrompt: string;
      sampleText: string;
      interventionType: InterventionType;
    },
  ) {
    return this.service.previewPrompt(
      req.user.id,
      body.systemPrompt,
      body.sampleText,
      body.interventionType,
    );
  }

  // ─── Practice Testing ─────────────────────────────────────

  @Post('practice-testing/generate')
  generatePracticeTest(
    @Request() req: { user: RequestUser },
    @Body() dto: GeneratePracticeTestDto,
    @SessionId() sessionId?: string,
  ) {
    return this.service.generatePracticeTest(req.user.id, dto, sessionId);
  }

  @Post('practice-testing/:interventionId/submit')
  submitPracticeTestAnswers(
    @Request() req: { user: RequestUser },
    @Param('interventionId') interventionId: string,
    @Body() dto: SubmitPracticeTestAnswersDto,
  ) {
    return this.service.submitPracticeTestAnswers(req.user.id, interventionId, dto);
  }

  @Get('practice-testing/:interventionId')
  getPracticeTest(
    @Request() req: { user: RequestUser },
    @Param('interventionId') interventionId: string,
  ) {
    return this.service.getPracticeTest(req.user.id, interventionId);
  }

  // ─── Interrogative Elaboration (Conversational Q&A) ─────

  @Post('interrogative-elaboration/generate')
  generateSuggestions(
    @Request() req: { user: RequestUser },
    @Body() dto: GenerateSuggestionsDto,
    @SessionId() sessionId?: string,
  ) {
    return this.service.generateSuggestions(req.user.id, dto, sessionId);
  }

  @Post('interrogative-elaboration/:sessionId/ask')
  askQuestion(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
    @Body() dto: AskQuestionDto,
  ) {
    return this.service.askQuestion(req.user.id, sessionId, dto);
  }

  @Post('interrogative-elaboration/:sessionId/complete')
  completeElaborationSession(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
  ) {
    return this.service.completeElaborationSession(req.user.id, sessionId);
  }

  @Get('interrogative-elaboration/:sessionId')
  getElaborationSession(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
  ) {
    return this.service.getElaborationSession(req.user.id, sessionId);
  }

  // ─── Stepwise Learning ─────────────────────────────────

  @Post('stepwise-learning/course-check')
  checkStepwiseCourseType(@Body() dto: StepwiseCourseCheckDto) {
    return this.service.checkCodingCourse(dto);
  }

  @Post('stepwise-learning/generate')
  generateSteps(
    @Request() req: { user: RequestUser },
    @Body() dto: GenerateStepwiseDto,
    @SessionId() sessionId?: string,
  ) {
    return this.service.generateSteps(req.user.id, dto, sessionId);
  }

  @Post('stepwise-learning/:sessionId/check')
  checkStepResponse(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
    @Body() dto: SubmitStepCheckDto,
  ) {
    return this.service.checkStepResponse(req.user.id, sessionId, dto);
  }

  @Patch('stepwise-learning/:sessionId/advance')
  advanceStep(@Request() req: { user: RequestUser }, @Param('sessionId') sessionId: string) {
    return this.service.advanceStep(req.user.id, sessionId);
  }

  @Get('stepwise-learning/:sessionId')
  getStepwiseSession(@Request() req: { user: RequestUser }, @Param('sessionId') sessionId: string) {
    return this.service.getStepwiseSession(req.user.id, sessionId);
  }

  @Post('stepwise-learning/:sessionId/complete')
  completeStepwiseSession(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
  ) {
    return this.service.completeStepwiseSession(req.user.id, sessionId);
  }

  // ─── Distributed Practice ────────────────────────────────

  @Post('distributed-practice/generate')
  generateCards(
    @Request() req: { user: RequestUser },
    @Body() dto: GenerateCardsDto,
    @SessionId() sessionId?: string,
  ) {
    return this.service.generateCards(req.user.id, dto, sessionId);
  }

  @Get('distributed-practice/due')
  getDueCards(
    @Request() req: { user: RequestUser },
    @Query('limit') limit?: string,
    @Query('courseId') courseId?: string,
  ) {
    return this.service.getDueCards(req.user.id, limit ? parseInt(limit, 10) : 20, courseId);
  }

  @Patch('distributed-practice/cards/:cardId/review')
  reviewCard(
    @Request() req: { user: RequestUser },
    @Param('cardId') cardId: string,
    @Body() dto: ReviewCardDto,
    @SessionId() sessionId?: string,
  ) {
    return this.service.reviewCard(req.user.id, cardId, dto, sessionId);
  }

  @Get('distributed-practice/stats')
  getCardStats(@Request() req: { user: RequestUser }) {
    return this.service.getCardStats(req.user.id);
  }

  @Get('distributed-practice/cards/:cardId/preview')
  previewCardRatings(@Request() req: { user: RequestUser }, @Param('cardId') cardId: string) {
    return this.service.previewCardRatings(req.user.id, cardId);
  }

  @Delete('distributed-practice/cards/:cardId')
  deleteCard(@Request() req: { user: RequestUser }, @Param('cardId') cardId: string) {
    return this.service.deleteCard(req.user.id, cardId);
  }

  // ─── Saved Reviews ───────────────────────────────────────

  @Post('saved-reviews')
  createSavedReview(@Request() req: { user: RequestUser }, @Body() dto: CreateSavedReviewDto) {
    return this.service.createSavedReview(req.user.id, dto);
  }

  @Get('saved-reviews')
  findAllSavedReviews(
    @Request() req: { user: RequestUser },
    @Query('interventionType') interventionType?: InterventionType,
    @Query('courseId') courseId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAllSavedReviews(req.user.id, {
      interventionType,
      courseId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('saved-reviews/:id')
  findOneSavedReview(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.service.findOneSavedReview(req.user.id, id);
  }

  @Patch('saved-reviews/:id')
  updateSavedReview(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: UpdateSavedReviewDto,
  ) {
    return this.service.updateSavedReview(req.user.id, id, dto);
  }

  @Delete('saved-reviews/:id')
  deleteSavedReview(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.service.deleteSavedReview(req.user.id, id);
  }

  // ─── Chat ──────────────────────────────────────────────────

  @Post('chat')
  chat(
    @Request() req: { user: RequestUser },
    @Body() dto: ChatRequestDto,
    @SessionId() activitySessionId?: string,
  ) {
    return this.service.chat(req.user.id, dto, activitySessionId);
  }
}
