import {
  Controller,
  Get,
  Put,
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
import { JwtAuthGuard, RolesGuard, Roles, SecurityEventService } from '../auth';
import { ZodValidationPipe } from '../common';
import { CreateCourseSchema, UpdateCourseSchema, UpdateEnrollmentPolicySchema } from '@ats/shared';
import type { CreateCourse, UpdateCourse, UpdateEnrollmentPolicy, UserRole } from '@ats/shared';

interface RequestUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

@Controller('courses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CoursesController {
  constructor(
    private readonly coursesService: CoursesService,
    private readonly securityEvents: SecurityEventService,
  ) {}

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

  @Get('catalog')
  catalog() {
    return this.coursesService.findCatalog();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.coursesService.findOne(id);
  }

  // OWASP API3:2023 (Broken Object Property Level Authorization) — this
  // route used to accept `UpdateCourse & Record<string, unknown>` with
  // no validation pipe, so a caller could pass ANY Course column
  // (`teacherId`, `status`, `visibility`, `archivedAt`, ...) straight
  // into the raw `data: dto` Prisma update in CoursesService.update.
  // The ownership check only verifies the CALLER owns the course before
  // the write — it does nothing to stop that owner from reassigning
  // `teacherId` to someone else, or setting fields (`status`,
  // `visibility`) that have their own dedicated, more carefully gated
  // endpoints below. Whitelisting via UpdateCourseSchema closes this.
  @Patch(':id')
  @Roles('teacher', 'admin')
  @UsePipes(new ZodValidationPipe(UpdateCourseSchema))
  async update(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: UpdateCourse,
  ) {
    const result = await this.coursesService.update(id, req.user.id, dto);
    // Checklist item 25 — config-change audit trail.
    this.securityEvents.record({
      type: 'CONFIG_CHANGED',
      userId: req.user.id,
      metadata: { resource: 'course', courseId: id, fields: Object.keys(dto) },
    });
    return result;
  }

  @Post(':id/duplicate')
  @Roles('teacher', 'admin')
  duplicate(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.coursesService.duplicate(id, req.user.id);
  }

  @Post(':id/publish')
  @Roles('teacher', 'admin')
  async publish(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    const result = await this.coursesService.publish(id, req.user.id);
    this.securityEvents.record({
      type: 'CONFIG_CHANGED',
      userId: req.user.id,
      metadata: { resource: 'course', courseId: id, action: 'publish' },
    });
    return result;
  }

  @Post(':id/unpublish')
  @Roles('teacher', 'admin')
  async unpublish(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    const result = await this.coursesService.unpublish(id, req.user.id);
    this.securityEvents.record({
      type: 'CONFIG_CHANGED',
      userId: req.user.id,
      metadata: { resource: 'course', courseId: id, action: 'unpublish' },
    });
    return result;
  }

  @Delete(':id')
  @Roles('teacher', 'admin')
  remove(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.coursesService.remove(id, req.user.id);
  }

  // Prompt 03: per-course enrollment policy update. Dedicated route +
  // pipe so the partial DTO is validated independently of the full
  // course PATCH. Mirrors the bulk-enroll role-guard pattern. Teachers
  // can update policy only for their own courses; admins for any.
  @Patch(':id/enrollment-policy')
  @Roles('teacher', 'admin')
  async updateEnrollmentPolicy(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateEnrollmentPolicySchema)) dto: UpdateEnrollmentPolicy,
  ) {
    const result = await this.coursesService.updateEnrollmentPolicy(id, req.user.id, dto);
    this.securityEvents.record({
      type: 'CONFIG_CHANGED',
      userId: req.user.id,
      metadata: { resource: 'course_enrollment_policy', courseId: id, ...dto },
    });
    return result;
  }

  @Get(':id/dialogue-settings')
  @Roles('teacher', 'admin')
  getDialogueSettings(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.coursesService.getDialogueSettings(id, req.user.id);
  }

  @Put(':id/dialogue-settings')
  @Roles('teacher', 'admin')
  async updateDialogueSettings(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() settings: Record<string, unknown>,
  ) {
    const result = await this.coursesService.updateDialogueSettings(id, req.user.id, settings);
    this.securityEvents.record({
      type: 'CONFIG_CHANGED',
      userId: req.user.id,
      metadata: {
        resource: 'course_dialogue_settings',
        courseId: id,
        fields: Object.keys(settings),
      },
    });
    return result;
  }
}
