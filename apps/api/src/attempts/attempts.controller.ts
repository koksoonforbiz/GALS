import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
  UsePipes,
} from '@nestjs/common';
import { AttemptsService } from './attempts.service';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { ZodValidationPipe } from '../common';
import {
  CreateAttemptSchema,
  UpdateAttemptSchema,
  SubmitAttemptSchema,
  ManualGradeSchema,
} from '@ats/shared';
import type {
  CreateAttempt,
  UpdateAttempt,
  SubmitAttempt,
  ManualGrade,
  UserRole,
} from '@ats/shared';

interface RequestUser {
  id: string;
  role: UserRole;
}

@Controller('attempts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttemptsController {
  constructor(private readonly attemptsService: AttemptsService) {}

  @Post()
  @Roles('student')
  @UsePipes(new ZodValidationPipe(CreateAttemptSchema))
  create(@Request() req: { user: RequestUser }, @Body() dto: CreateAttempt) {
    return this.attemptsService.create(req.user.id, dto);
  }

  @Get()
  @Roles('teacher', 'admin')
  findAll() {
    return this.attemptsService.findAll();
  }

  @Get('my')
  @Roles('student')
  findByStudent(@Request() req: { user: RequestUser }) {
    return this.attemptsService.findByStudent(req.user.id);
  }

  @Get('review')
  @Roles('teacher', 'admin')
  findForReview(@Request() req: { user: RequestUser }) {
    return this.attemptsService.findForReview(req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.attemptsService.findOne(id);
  }

  @Patch(':id')
  @Roles('student')
  update(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateAttemptSchema)) dto: UpdateAttempt,
  ) {
    return this.attemptsService.update(id, req.user.id, dto);
  }

  @Post(':id/submit')
  @Roles('student')
  submit(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SubmitAttemptSchema)) dto: SubmitAttempt,
  ) {
    return this.attemptsService.submit(id, req.user.id, dto);
  }

  @Post(':id/grade')
  @Roles('teacher', 'admin')
  manualGrade(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ManualGradeSchema)) dto: ManualGrade,
  ) {
    return this.attemptsService.manualGrade(id, req.user.id, dto);
  }
}
