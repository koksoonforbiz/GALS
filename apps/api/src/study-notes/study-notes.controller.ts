import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CreateStudyNoteSchema, UpdateStudyNoteSchema, type UpdateStudyNote } from '@ats/shared';
import type { z } from 'zod';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { ZodValidationPipe } from '../common';
import { StudyNotesService } from './study-notes.service';

interface RequestUser {
  id: string;
}

// Two-door: PUBLIC (student-only, own notes). docs/two-door/api-classification.md.
@Controller('study-notes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudyNotesController {
  constructor(private readonly service: StudyNotesService) {}

  @Get()
  @Roles('student')
  list(
    @Request() req: { user: RequestUser },
    @Query('courseId', new ParseUUIDPipe()) courseId: string,
  ) {
    return this.service.list(req.user.id, courseId);
  }

  @Post()
  @Roles('student')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  create(
    @Request() req: { user: RequestUser },
    @Body(new ZodValidationPipe(CreateStudyNoteSchema))
    body: z.output<typeof CreateStudyNoteSchema>,
  ) {
    return this.service.create(req.user.id, body);
  }

  @Patch(':id')
  @Roles('student')
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  update(
    @Request() req: { user: RequestUser },
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateStudyNoteSchema)) body: UpdateStudyNote,
  ) {
    return this.service.update(req.user.id, id, body);
  }

  @Delete(':id')
  @Roles('student')
  remove(@Request() req: { user: RequestUser }, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.remove(req.user.id, id);
  }
}
