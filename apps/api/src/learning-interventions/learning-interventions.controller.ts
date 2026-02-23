import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LearningInterventionsService } from './learning-interventions.service';
import { CreateInterventionDto, CreateInterventionSchema } from './dto/create-intervention.dto';
import {
  GeneratePracticeTestDto,
  GeneratePracticeTestSchema,
  SubmitPracticeTestAnswersDto,
  SubmitPracticeTestAnswersSchema,
} from './dto/practice-testing.dto';
import {
  GenerateElaborationDto,
  GenerateElaborationSchema,
  SubmitElaborationDto,
  SubmitElaborationSchema,
} from './dto/interrogative-elaboration.dto';
import {
  GenerateStepwiseDto,
  GenerateStepwiseSchema,
  SubmitStepCheckDto,
  SubmitStepCheckSchema,
} from './dto/stepwise-learning.dto';

interface RequestUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

@Controller('learning-interventions')
@UseGuards(JwtAuthGuard)
export class LearningInterventionsController {
  constructor(private readonly learningInterventionsService: LearningInterventionsService) {}

  /**
   * Test endpoint to verify module is active
   */
  @Post('test-connection')
  async testConnection() {
    const anthropicAvailable = this.learningInterventionsService.isAnthropicAvailable();
    return {
      status: 'Learning interventions module is active',
      anthropicAvailable,
    };
  }

  /**
   * Create a new learning intervention
   */
  @Post()
  @UsePipes(new ZodValidationPipe(CreateInterventionSchema))
  async createIntervention(
    @Request() req: { user: RequestUser },
    @Body() dto: CreateInterventionDto,
  ) {
    return this.learningInterventionsService.createIntervention(req.user.id, dto);
  }

  /**
   * Get all interventions for the current user
   */
  @Get()
  async getInterventions(
    @Request() req: { user: RequestUser },
    @Query('courseId') courseId?: string,
  ) {
    return this.learningInterventionsService.getInterventions(req.user.id, courseId);
  }

  /**
   * Get a single intervention by ID
   */
  @Get(':id')
  async getIntervention(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.learningInterventionsService.getIntervention(id, req.user.id);
  }

  // ─── Practice Testing Endpoints ─────────────────────────────

  /**
   * Generate a practice test from selected text
   */
  @Post('practice-testing/generate')
  @UsePipes(new ZodValidationPipe(GeneratePracticeTestSchema))
  async generatePracticeTest(
    @Request() req: { user: RequestUser },
    @Body() dto: GeneratePracticeTestDto,
  ) {
    return this.learningInterventionsService.generatePracticeTest(req.user.id, dto);
  }

  /**
   * Submit answers for a practice test
   */
  @Post('practice-testing/:practiceTestId/submit')
  @UsePipes(new ZodValidationPipe(SubmitPracticeTestAnswersSchema))
  async submitPracticeTestAnswers(
    @Request() req: { user: RequestUser },
    @Param('practiceTestId') practiceTestId: string,
    @Body() dto: SubmitPracticeTestAnswersDto,
  ) {
    return this.learningInterventionsService.submitPracticeTestAnswers(
      req.user.id,
      practiceTestId,
      dto,
    );
  }

  /**
   * Get a practice test by ID
   */
  @Get('practice-testing/:practiceTestId')
  async getPracticeTest(
    @Request() req: { user: RequestUser },
    @Param('practiceTestId') practiceTestId: string,
  ) {
    return this.learningInterventionsService.getPracticeTest(req.user.id, practiceTestId);
  }

  // ─── Interrogative Elaboration Endpoints ─────────────────────

  /**
   * Generate elaboration questions from selected text
   */
  @Post('interrogative-elaboration/generate')
  @UsePipes(new ZodValidationPipe(GenerateElaborationSchema))
  async generateElaborationQuestions(
    @Request() req: { user: RequestUser },
    @Body() dto: GenerateElaborationDto,
  ) {
    return this.learningInterventionsService.generateElaborationQuestions(req.user.id, dto);
  }

  /**
   * Evaluate a learner's elaboration
   */
  @Post('interrogative-elaboration/:sessionId/evaluate')
  @UsePipes(new ZodValidationPipe(SubmitElaborationSchema))
  async evaluateElaboration(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
    @Body() dto: SubmitElaborationDto,
  ) {
    return this.learningInterventionsService.evaluateElaboration(req.user.id, sessionId, dto);
  }

  /**
   * Complete an elaboration session
   */
  @Post('interrogative-elaboration/:sessionId/complete')
  async completeElaborationSession(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
  ) {
    return this.learningInterventionsService.completeElaborationSession(req.user.id, sessionId);
  }

  /**
   * Get an elaboration session by ID
   */
  @Get('interrogative-elaboration/:sessionId')
  async getElaborationSession(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
  ) {
    return this.learningInterventionsService.getElaborationSession(req.user.id, sessionId);
  }

  // ─── Stepwise Learning Endpoints ─────────────────────────────

  /**
   * Generate stepwise learning content from selected text
   */
  @Post('stepwise-learning/generate')
  @UsePipes(new ZodValidationPipe(GenerateStepwiseSchema))
  async generateSteps(
    @Request() req: { user: RequestUser },
    @Body() dto: GenerateStepwiseDto,
  ) {
    return this.learningInterventionsService.generateSteps(req.user.id, dto);
  }

  /**
   * Check a comprehension response for a step
   */
  @Post('stepwise-learning/:sessionId/check')
  @UsePipes(new ZodValidationPipe(SubmitStepCheckSchema))
  async checkStepResponse(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
    @Body() dto: SubmitStepCheckDto,
  ) {
    return this.learningInterventionsService.checkStepResponse(req.user.id, sessionId, dto);
  }

  /**
   * Advance to the next step
   */
  @Patch('stepwise-learning/:sessionId/advance')
  async advanceStep(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
  ) {
    return this.learningInterventionsService.advanceStep(req.user.id, sessionId);
  }

  /**
   * Complete a stepwise session
   */
  @Post('stepwise-learning/:sessionId/complete')
  async completeStepwiseSession(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
  ) {
    return this.learningInterventionsService.completeStepwiseSession(req.user.id, sessionId);
  }

  /**
   * Get a stepwise session by ID (for resuming)
   */
  @Get('stepwise-learning/:sessionId')
  async getStepwiseSession(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
  ) {
    return this.learningInterventionsService.getStepwiseSession(req.user.id, sessionId);
  }
}
