import {
  Controller,
  Get,
  Post,
  Put,
  Query,
  Param,
  Body,
  Request,
  UseGuards,
  UsePipes,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth';
import { ZodValidationPipe } from '../common';
import {
  BulkProvisionUsersSchema,
  BulkEnrollSchema,
  ResetStudentPasswordSchema,
} from '@ats/shared';
import type { BulkProvisionUsers, BulkEnroll, ResetStudentPassword } from '@ats/shared';
import { UserManagementService } from './user-management.service';

interface RequestUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

@Controller('user-management')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UserManagementController {
  constructor(private readonly service: UserManagementService) {}

  // ─── Students ─────────────────────────────────────────

  @Get('students')
  @Roles('teacher', 'admin')
  async getStudents(
    @Request() req: { user: RequestUser },
    @Query('courseId') courseId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    return this.service.getStudents(req.user.id, {
      courseId,
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      sortBy: sortBy as 'name' | 'lastActive' | 'cost' | 'joinedAt',
      sortOrder: sortOrder as 'asc' | 'desc',
    });
  }

  @Get('students/export')
  @Roles('teacher', 'admin')
  async exportStudents(
    @Request() req: { user: RequestUser },
    @Query('courseId') courseId?: string,
    @Res() res?: Response,
  ) {
    const csv = await this.service.exportStudentsCsv(req.user.id, courseId);
    res!.setHeader('Content-Type', 'text/csv');
    res!.setHeader('Content-Disposition', 'attachment; filename=students.csv');
    res!.send(csv);
  }

  @Get('students/:studentId')
  @Roles('teacher', 'admin')
  async getStudentDetail(
    @Request() req: { user: RequestUser },
    @Param('studentId') studentId: string,
  ) {
    return this.service.getStudentDetail(req.user.id, studentId);
  }

  @Post('students')
  @Roles('teacher', 'admin')
  async addStudent(
    @Request() req: { user: RequestUser },
    @Body() body: { name: string; email: string; courseIds: string[] },
  ) {
    return this.service.addStudent(req.user.id, body);
  }

  @Post('students/bulk')
  @Roles('teacher', 'admin')
  async bulkAddStudents(
    @Request() req: { user: RequestUser },
    @Body() body: { students: Array<{ email: string; name: string }>; courseIds: string[] },
  ) {
    return this.service.bulkAddStudents(req.user.id, body);
  }

  @Post('students/:studentId/resend-invitation')
  @Roles('teacher', 'admin')
  async resendInvitation(
    @Request() req: { user: RequestUser },
    @Param('studentId') studentId: string,
  ) {
    return this.service.resendInvitation(req.user.id, studentId);
  }

  // Prompt 05: teacher/admin-issued password reset. Sets the student's
  // password to a teacher-chosen plaintext value (re-hashed with
  // bcryptjs at salt rounds 10, same library as everywhere else).
  // Body shape is validated via Zod (`ResetStudentPasswordSchema`) so
  // weak inputs reject before the service runs. Students have NO
  // matching self-service endpoint — see auth.controller.ts.
  @Post('users/:userId/reset-password')
  @Roles('teacher', 'admin')
  @UsePipes(new ZodValidationPipe(ResetStudentPasswordSchema))
  async resetStudentPassword(
    @Request() req: { user: RequestUser },
    @Param('userId') userId: string,
    @Body() dto: ResetStudentPassword,
  ) {
    return this.service.resetStudentPassword(req.user.id, userId, dto);
  }

  // ─── Bulk provisioning (prompt 02) ────────────────────
  //
  // Teacher spreadsheet → batch of { email, loginId, password, ... }.
  // Returns per-row status (created / skipped / error) plus optional
  // per-row enrollment status when enrollCourseId is supplied. The
  // response never includes the plaintext password.
  @Post('users/bulk-provision')
  @Roles('teacher', 'admin')
  @UsePipes(new ZodValidationPipe(BulkProvisionUsersSchema))
  async bulkProvisionUsers(
    @Request() req: { user: RequestUser },
    @Body() dto: BulkProvisionUsers,
  ) {
    return this.service.bulkProvisionUsers(req.user.id, dto);
  }

  // Idempotent bulk enrollment for a fixed { courseId, userIds[] }.
  // Skips users already enrolled and reactivates DROPPED rows.
  @Post('enrollments/bulk')
  @Roles('teacher', 'admin')
  @UsePipes(new ZodValidationPipe(BulkEnrollSchema))
  async bulkEnroll(
    @Request() req: { user: RequestUser },
    @Body() dto: BulkEnroll,
  ) {
    return this.service.bulkEnroll(req.user.id, dto);
  }

  // ─── Teacher Usage ────────────────────────────────────

  @Get('my-usage')
  @Roles('teacher', 'admin')
  async getMyUsage(
    @Request() req: { user: RequestUser },
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.getTeacherUsage(req.user.id, dateFrom, dateTo);
  }

  // ─── Course Usage ─────────────────────────────────────

  @Get('courses-overview')
  @Roles('teacher', 'admin')
  async getCoursesOverview(@Request() req: { user: RequestUser }) {
    return this.service.getCoursesOverview(req.user.id);
  }

  @Get('usage-summary')
  @Roles('teacher', 'admin')
  async getCourseUsageSummary(
    @Request() req: { user: RequestUser },
    @Query('courseId') courseId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.getCourseUsageSummary(req.user.id, courseId, dateFrom, dateTo);
  }

  // ─── Pricing ──────────────────────────────────────────

  @Get('pricing')
  @Roles('teacher', 'admin')
  async getPricing() {
    return this.service.getPricing();
  }

  @Put('pricing/:id')
  @Roles('admin')
  async updatePricing(
    @Param('id') id: string,
    @Body() body: { inputPricePer1k: number; outputPricePer1k: number },
  ) {
    return this.service.updatePricing(id, body);
  }
}
