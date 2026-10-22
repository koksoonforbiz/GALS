import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  PUZZLE_OCCASIONS,
  PuzzleAnswerSchema,
  PuzzleColourCheckSchema,
  PuzzleStartSchema,
  PuzzleSubmitSchema,
  PuzzleStepSubmitSchema,
  type PuzzleStepSubmitRequest,
  type PuzzleAnswerRequest,
  type PuzzleColourCheckRequest,
  type PuzzleOccasion,
  type PuzzleStartRequest,
  type PuzzleSubmitRequest,
  type UserRole,
} from '@ats/shared';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SessionId, ZodValidationPipe } from '../common';
import { EfaOccasionService } from './occasion.service';
import { EfaTaskRunService } from './task-run.service';
import type { TaskCode } from './tasks/steps';

interface RequestUser {
  id: string;
  role: UserRole;
}

const OccasionParam = new ZodValidationPipe(z.enum(PUZZLE_OCCASIONS));
const PartQuery = new ZodValidationPipe(z.enum(['before', 'after']));
const TaskParam = new ZodValidationPipe(z.enum(['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']));
const ItemCodeParam = new ZodValidationPipe(z.string().regex(/^[A-C]\d{1,2}$/));

// Two-door: student-only (@Roles('student')) → PUBLIC; nginx allowlist
// /api/puzzles/. Neutral path and payloads by design (blinding): no
// construct names, no scores, no answer keys.
@Controller('puzzles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('student')
export class PuzzlesController {
  constructor(
    private readonly occasions: EfaOccasionService,
    private readonly runs: EfaTaskRunService,
  ) {}

  @Get('courses/:courseId/occasions/:occasion')
  view(
    @Request() req: { user: RequestUser },
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('occasion', OccasionParam) occasion: PuzzleOccasion,
    @SessionId() sessionId?: string,
  ) {
    // Page load: a puzzle still marked running was reloaded/closed → interrupted.
    return this.occasions.view(req.user.id, courseId, occasion, sessionId, {
      interruptRunning: true,
    });
  }

  @Post('courses/:courseId/occasions/:occasion/start')
  start(
    @Request() req: { user: RequestUser },
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('occasion', OccasionParam) occasion: PuzzleOccasion,
    @Body(new ZodValidationPipe(PuzzleStartSchema)) body: PuzzleStartRequest,
    @SessionId() sessionId?: string,
  ) {
    return this.occasions.start(req.user.id, courseId, occasion, body, sessionId);
  }

  @Get('occasions/:occasionId/questionnaire')
  questionnaire(
    @Request() req: { user: RequestUser },
    @Param('occasionId', ParseUUIDPipe) occasionId: string,
    @Query('part', PartQuery) part: 'before' | 'after',
  ) {
    return this.occasions.questionnaire(req.user.id, occasionId, part);
  }

  @Put('occasions/:occasionId/answers/:itemCode')
  answer(
    @Request() req: { user: RequestUser },
    @Param('occasionId', ParseUUIDPipe) occasionId: string,
    @Param('itemCode', ItemCodeParam) itemCode: string,
    @Body(new ZodValidationPipe(PuzzleAnswerSchema)) body: PuzzleAnswerRequest,
  ) {
    return this.occasions.saveAnswer(req.user.id, occasionId, itemCode, body.value);
  }

  @Post('occasions/:occasionId/questionnaire/submit')
  submit(
    @Request() req: { user: RequestUser },
    @Param('occasionId', ParseUUIDPipe) occasionId: string,
    @Body(new ZodValidationPipe(PuzzleSubmitSchema)) body: PuzzleSubmitRequest,
    @SessionId() sessionId?: string,
  ) {
    return this.occasions.submit(req.user.id, occasionId, body.part, sessionId);
  }

  @Post('occasions/:occasionId/colour-check')
  colourCheck(
    @Request() req: { user: RequestUser },
    @Param('occasionId', ParseUUIDPipe) occasionId: string,
    @Body(new ZodValidationPipe(PuzzleColourCheckSchema)) body: PuzzleColourCheckRequest,
  ) {
    return this.occasions.colourCheck(req.user.id, occasionId, body);
  }

  @Post('occasions/:occasionId/tasks/:task/begin')
  beginTask(
    @Request() req: { user: RequestUser },
    @Param('occasionId', ParseUUIDPipe) occasionId: string,
    @Param('task', TaskParam) task: TaskCode,
    @SessionId() sessionId?: string,
  ) {
    return this.runs.begin(req.user.id, occasionId, task, sessionId);
  }

  @Post('runs/:runId/steps')
  submitStep(
    @Request() req: { user: RequestUser },
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body(new ZodValidationPipe(PuzzleStepSubmitSchema)) body: PuzzleStepSubmitRequest,
    @SessionId() sessionId?: string,
  ) {
    return this.runs.submit(req.user.id, runId, body, sessionId);
  }
}
