import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  UsePipes,
} from '@nestjs/common';
import { CoursesService } from './courses.service';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { ZodValidationPipe } from '../common';
import { CreateCourseSchema, UpdateCourseSchema } from '@ats/shared';
import type { CreateCourse, UpdateCourse, UserRole } from '@ats/shared';

interface RequestUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

@Controller('courses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Post()
  @Roles('teacher', 'admin')
  @UsePipes(new ZodValidationPipe(CreateCourseSchema))
  create(@Request() req: { user: RequestUser }, @Body() dto: CreateCourse) {
    return this.coursesService.create(req.user.id, dto);
  }

  @Get()
  findAll(@Request() req: { user: RequestUser }) {
    return this.coursesService.findAll(req.user.id, req.user.role);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.coursesService.findOne(id);
  }

  @Patch(':id')
  @Roles('teacher', 'admin')
  update(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: UpdateCourse & Record<string, unknown>,
  ) {
    return this.coursesService.update(id, req.user.id, dto);
  }

  @Post(':id/duplicate')
  @Roles('teacher', 'admin')
  duplicate(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.coursesService.duplicate(id, req.user.id);
  }

  @Post(':id/publish')
  @Roles('teacher', 'admin')
  publish(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.coursesService.publish(id, req.user.id);
  }

  @Post(':id/unpublish')
  @Roles('teacher', 'admin')
  unpublish(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.coursesService.unpublish(id, req.user.id);
  }

  @Delete(':id')
  @Roles('teacher', 'admin')
  remove(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.coursesService.remove(id, req.user.id);
  }
}
