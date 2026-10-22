import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { GateUnlockSchema, type GateUnlockRequest, type UserRole } from '@ats/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ZodValidationPipe } from '../common';
import { CourseGateService } from './course-gate.service';

interface RequestUser {
  id: string;
  role: UserRole;
}

// Two-door: staff only (@Roles('teacher','admin')) → PRIVATE; /api/course-gates/
// is not in the public allowlist. Students see their checklist through
// GET /courses/:id (neutral labels), never through this controller.
@Controller('course-gates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class CourseGateController {
  constructor(private readonly gates: CourseGateService) {}

  @Get('courses/:courseId')
  list(@Request() req: { user: RequestUser }, @Param('courseId', ParseUUIDPipe) courseId: string) {
    return this.gates.listForCourse(req.user, courseId);
  }

  @Get('courses/:courseId/students/:studentId')
  student(
    @Request() req: { user: RequestUser },
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.gates.studentStateForStaff(req.user, courseId, studentId);
  }

  @Post(':gateId/students/:studentId/unlock')
  unlock(
    @Request() req: { user: RequestUser; ip?: string; headers: Record<string, string | undefined> },
    @Param('gateId', ParseUUIDPipe) gateId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body(new ZodValidationPipe(GateUnlockSchema)) body: GateUnlockRequest,
  ) {
    return this.gates.override(req.user, gateId, studentId, body.reason, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
