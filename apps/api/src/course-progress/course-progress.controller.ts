import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { CourseProgressService } from './course-progress.service';

// Two-door: PUBLIC (student-only). docs/two-door/api-classification.md.
@Controller('course-progress')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CourseProgressController {
  constructor(private readonly service: CourseProgressService) {}

  /** The signed-in student's progress in each course they are enrolled in. */
  @Get('my')
  @Roles('student')
  my(@Request() req: { user: { id: string } }) {
    return this.service.myProgress(req.user.id);
  }
}
