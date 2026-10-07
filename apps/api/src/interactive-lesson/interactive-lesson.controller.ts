import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SaveLessonSlideStateSchema, type SaveLessonSlideState, type UserRole } from '@ats/shared';
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
}
