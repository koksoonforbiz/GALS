import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AssessmentsService } from './assessments.service';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import type { UserRole } from '@ats/shared';

interface RequestUser {
  id: string;
  role: UserRole;
}

@Controller('assessments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AssessmentsController {
  constructor(private readonly assessmentsService: AssessmentsService) {}

  @Post()
  @Roles('teacher', 'admin')
  create(
    @Request() req: { user: RequestUser },
    @Body() dto: {
      courseId: string;
      title: string;
      description?: string;
      mode?: string;
      settings?: any;
      questionIds?: string[];
    },
  ) {
    return this.assessmentsService.create(req.user.id, dto as any);
  }

  @Get()
  findAll(
    @Request() req: { user: RequestUser },
    @Query('courseId') courseId?: string,
  ) {
    if (courseId) {
      return this.assessmentsService.findByCourse(courseId);
    }
    return this.assessmentsService.findAllForTeacher(req.user.id);
  }

  @Get('available')
  @Roles('student')
  findAvailable(@Request() req: { user: RequestUser }) {
    return this.assessmentsService.findAvailable(req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.assessmentsService.findOne(id);
  }

  @Patch(':id')
  @Roles('teacher', 'admin')
  update(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: { isPublished?: boolean; title?: string; description?: string; mode?: string; settings?: any },
  ) {
    return this.assessmentsService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @Roles('teacher', 'admin')
  remove(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.assessmentsService.remove(id, req.user.id);
  }

  /** Add a question to an assessment */
  @Post(':id/questions')
  @Roles('teacher', 'admin')
  addQuestion(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: { questionId: string; points?: number; section?: string },
  ) {
    return this.assessmentsService.addQuestion(id, req.user.id, dto);
  }

  /** Remove a question from an assessment */
  @Delete(':id/questions/:questionId')
  @Roles('teacher', 'admin')
  removeQuestion(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Param('questionId') questionId: string,
  ) {
    return this.assessmentsService.removeQuestion(id, req.user.id, questionId);
  }

  /** Reorder questions in an assessment */
  @Post(':id/reorder')
  @Roles('teacher', 'admin')
  reorderQuestions(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: { questionIds: string[] },
  ) {
    return this.assessmentsService.reorderQuestions(id, req.user.id, dto.questionIds);
  }

  /** Update points/section for a question in an assessment */
  @Patch(':id/questions/:questionId')
  @Roles('teacher', 'admin')
  updateQuestionItem(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body() dto: { points?: number; section?: string },
  ) {
    return this.assessmentsService.updateQuestionItem(id, req.user.id, questionId, dto);
  }
}
