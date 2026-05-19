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
import { QuestionGenerationService } from './question-generation.service';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import type {
  GenerateQuestionsDto,
  ReviewQuestionDto,
  GradeOpenEndedDto,
  RegenerateDto,
} from './dto';
import type { HattieFeedbackLevel } from '@prisma/client';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('question-generation')
@UseGuards(JwtAuthGuard)
export class QuestionGenerationController {
  constructor(private readonly service: QuestionGenerationService) {}

  // ─── Question Generation Jobs ─────────────────────────────

  @Post('generate')
  @UseGuards(RolesGuard)
  @Roles('teacher', 'admin')
  generate(@Request() req: { user: RequestUser }, @Body() dto: GenerateQuestionsDto) {
    return this.service.createJob(req.user.id, dto);
  }

  @Get('jobs/:jobId')
  @UseGuards(RolesGuard)
  @Roles('teacher', 'admin')
  getJob(@Request() req: { user: RequestUser }, @Param('jobId') jobId: string) {
    return this.service.getJob(jobId, req.user.id);
  }

  @Get('jobs')
  @UseGuards(RolesGuard)
  @Roles('teacher', 'admin')
  getJobs(@Request() req: { user: RequestUser }, @Query('courseId') courseId: string) {
    return this.service.getJobsForCourse(courseId, req.user.id);
  }

  @Patch('jobs/:jobId/questions/:index/review')
  @UseGuards(RolesGuard)
  @Roles('teacher', 'admin')
  reviewQuestion(
    @Request() req: { user: RequestUser },
    @Param('jobId') jobId: string,
    @Param('index') index: string,
    @Body() dto: ReviewQuestionDto,
  ) {
    return this.service.reviewQuestion(jobId, parseInt(index, 10), req.user.id, dto);
  }

  @Post('jobs/:jobId/approve-all')
  @UseGuards(RolesGuard)
  @Roles('teacher', 'admin')
  approveAll(@Request() req: { user: RequestUser }, @Param('jobId') jobId: string) {
    return this.service.approveAll(jobId, req.user.id);
  }

  @Post('jobs/:jobId/regenerate')
  @UseGuards(RolesGuard)
  @Roles('teacher', 'admin')
  regenerate(
    @Request() req: { user: RequestUser },
    @Param('jobId') jobId: string,
    @Body() dto: RegenerateDto,
  ) {
    return this.service.regenerateRejected(jobId, req.user.id, dto);
  }

  // ─── AI Grading ──────────────────────────────────────────

  @Post('grade-open-ended')
  @UseGuards(RolesGuard)
  @Roles('teacher', 'admin')
  gradeOpenEnded(@Request() req: { user: RequestUser }, @Body() dto: GradeOpenEndedDto) {
    return this.service.gradeOpenEnded(req.user.id, dto);
  }

  // ─── Feedback Prompt Config ──────────────────────────────

  @Get('feedback-config/:courseId')
  @UseGuards(RolesGuard)
  @Roles('teacher', 'admin')
  getAllFeedbackConfigs(@Param('courseId') courseId: string) {
    return this.service.getAllFeedbackConfigs(courseId);
  }

  @Get('feedback-config/:courseId/:feedbackLevel')
  @UseGuards(RolesGuard)
  @Roles('teacher', 'admin')
  getFeedbackConfig(
    @Param('courseId') courseId: string,
    @Param('feedbackLevel') feedbackLevel: HattieFeedbackLevel,
  ) {
    return this.service.getFeedbackPrompt(courseId, feedbackLevel);
  }

  @Put('feedback-config/:courseId/:feedbackLevel')
  @UseGuards(RolesGuard)
  @Roles('teacher', 'admin')
  updateFeedbackConfig(
    @Request() req: { user: RequestUser },
    @Param('courseId') courseId: string,
    @Param('feedbackLevel') feedbackLevel: HattieFeedbackLevel,
    @Body() body: { systemPrompt: string },
  ) {
    return this.service.updateFeedbackConfig(
      courseId,
      feedbackLevel,
      req.user.id,
      body.systemPrompt,
    );
  }

  @Delete('feedback-config/:courseId/:feedbackLevel')
  @UseGuards(RolesGuard)
  @Roles('teacher', 'admin')
  deleteFeedbackConfig(
    @Param('courseId') courseId: string,
    @Param('feedbackLevel') feedbackLevel: HattieFeedbackLevel,
  ) {
    return this.service.deleteFeedbackConfig(courseId, feedbackLevel);
  }

  // ─── Feedback Settings ────────────────────────────────────

  @Get('feedback-settings/:courseId')
  @UseGuards(RolesGuard)
  @Roles('teacher', 'admin')
  getFeedbackSettings(@Param('courseId') courseId: string) {
    return this.service.getFeedbackSettings(courseId);
  }

  @Put('feedback-settings/:courseId')
  @UseGuards(RolesGuard)
  @Roles('teacher', 'admin')
  updateFeedbackSettings(
    @Param('courseId') courseId: string,
    @Body() body: { enabledLevels: string[] },
  ) {
    return this.service.updateFeedbackSettings(courseId, body.enabledLevels);
  }
}
