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
import { EnrollmentsService } from './enrollments.service';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { ZodValidationPipe } from '../common';
import { CreateEnrollmentSchema } from '@ats/shared';
import type { CreateEnrollment, UserRole } from '@ats/shared';

interface RequestUser {
  id: string;
  role: UserRole;
}

@Controller('enrollments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  // Teacher-initiated enrollment
  @Post()
  @Roles('teacher', 'admin')
  @UsePipes(new ZodValidationPipe(CreateEnrollmentSchema))
  create(@Request() req: { user: RequestUser }, @Body() dto: CreateEnrollment) {
    return this.enrollmentsService.create(req.user.id, dto);
  }

  // Student self-enrollment
  @Post('self')
  @Roles('student')
  selfEnroll(
    @Request() req: { user: RequestUser },
    @Body() body: { courseId: string },
  ) {
    return this.enrollmentsService.selfEnroll(req.user.id, body.courseId);
  }

  // Student drop course
  @Post(':courseId/drop')
  @Roles('student')
  drop(
    @Request() req: { user: RequestUser },
    @Param('courseId') courseId: string,
  ) {
    return this.enrollmentsService.drop(req.user.id, courseId);
  }

  @Get()
  @Roles('teacher', 'admin')
  findByCourse(@Query('courseId') courseId: string) {
    return this.enrollmentsService.findByCourse(courseId);
  }

  @Get('my')
  @Roles('student')
  findMyEnrollments(@Request() req: { user: RequestUser }) {
    return this.enrollmentsService.findMyEnrollments(req.user.id);
  }

  @Delete(':id')
  @Roles('teacher', 'admin')
  remove(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.enrollmentsService.remove(id, req.user.id);
  }

  // Teacher/admin-initiated drop by { courseId, userId } (prompt 03).
  // Soft-marks the enrollment DROPPED so prior work + logs survive.
  // Never gated by the per-course `allowStudentSelfDrop` flag — that
  // flag only affects STUDENT-initiated drops.
  //
  // Why a separate route instead of `DELETE /enrollments/:id`:
  //   - the teacher roster view has { courseId, studentId } in hand,
  //     not the enrollment row id; this avoids a lookup round-trip;
  //   - matches the bulk-enroll endpoint's `{ courseId, userIds[] }`
  //     shape so the two teacher actions are symmetric.
  @Post(':courseId/drop-student')
  @Roles('teacher', 'admin')
  dropStudent(
    @Request() req: { user: RequestUser },
    @Param('courseId') courseId: string,
    @Body() body: { userId: string },
  ) {
    return this.enrollmentsService.dropStudent(req.user.id, courseId, body.userId);
  }
}
