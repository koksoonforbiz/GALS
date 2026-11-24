import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  CheckpointFeedbackRequestSchema,
  SaveLessonSlideStateSchema,
  type CheckpointFeedbackRequest,
  type SaveLessonSlideState,
  type UserRole,
} from '@ats/shared';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { ZodValidationPipe } from '../common';
import { InteractiveLessonService } from './interactive-lesson.service';

interface RequestUser {
  id: string;
  role: UserRole;
}

// Two-door: GET is BOTH (students read their lesson; teachers preview it
// read-only in the builder); PUT is PUBLIC (student-only working state).
// Both are door-classified by @Roles including 'student' — see
// docs/two-door/api-classification.md and the nginx allowlist.
@Controller('interactive-lessons')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InteractiveLessonController {
  constructor(private readonly service: InteractiveLessonService) {}

  @Get('items/:itemId')
  @Roles('student', 'teacher', 'admin')
  getLesson(
    @Request() req: { user: RequestUser },
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
  ) {
    return this.service.getLesson(itemId, req.user);
  }

  @Put('items/:itemId/slides/:slideKey/state')
  @Roles('student')
  saveSlideState(
    @Request() req: { user: RequestUser },
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Param('slideKey') slideKey: string,
    @Body(new ZodValidationPipe(SaveLessonSlideStateSchema)) body: SaveLessonSlideState,
  ) {
    return this.service.saveSlideState(itemId, slideKey, req.user.id, body.state, body.sessionId);
  }

  // PUBLIC (student-only): AI feedback on a Checkpoint prediction.
  @Post('items/:itemId/slides/:slideKey/feedback')
  @Roles('student')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async checkpointFeedback(
    @Request() req: { user: RequestUser },
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Param('slideKey') slideKey: string,
    @Body(new ZodValidationPipe(CheckpointFeedbackRequestSchema)) body: CheckpointFeedbackRequest,
  ) {
    const feedback = await this.service.checkpointFeedback(
      itemId,
      slideKey,
      req.user.id,
      body.answer,
      body.sessionId,
    );
    return { feedback };
  }
}
