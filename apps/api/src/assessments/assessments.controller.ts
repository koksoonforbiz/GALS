import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  UsePipes,
} from '@nestjs/common';
import { AssessmentsService } from './assessments.service';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { ZodValidationPipe } from '../common';
import { CreateAssessmentSchema } from '@ats/shared';
import type { CreateAssessment, UserRole } from '@ats/shared';

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
  @UsePipes(new ZodValidationPipe(CreateAssessmentSchema))
  create(@Request() req: { user: RequestUser }, @Body() dto: CreateAssessment) {
    return this.assessmentsService.create(req.user.id, dto);
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

  @Delete(':id')
  @Roles('teacher', 'admin')
  remove(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.assessmentsService.remove(id, req.user.id);
  }
}
