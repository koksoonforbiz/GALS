import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { ZodValidationPipe } from '../common';
import { ANNOUNCEMENT_KINDS, AnnouncementsService, SEVERITIES } from './announcements.service';

const iso = z.string().datetime({ offset: true }).nullish();
const InputSchema = z.object({
  kind: z.enum(ANNOUNCEMENT_KINDS),
  severity: z.enum(SEVERITIES),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  courseId: z.string().uuid().nullish(),
  startsAt: iso,
  endsAt: iso,
  maintenanceStart: iso,
  maintenanceEnd: iso,
  requireAck: z.boolean().optional(),
});

interface RequestUser {
  id: string;
  role: string;
}

// Two-door: GET active and POST :id/ack are PUBLIC (students); the rest is
// PRIVATE (teacher of the course, admin). docs/two-door/api-classification.md.
@Controller('announcements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnnouncementsController {
  constructor(private readonly service: AnnouncementsService) {}

  @Get('active')
  @Roles('student')
  active(@Request() req: { user: RequestUser }) {
    return this.service.activeFor(req.user.id);
  }

  @Post(':id/ack')
  @Roles('student')
  ack(@Request() req: { user: RequestUser }, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.acknowledge(req.user.id, id);
  }

  @Get()
  @Roles('teacher', 'admin')
  list(@Request() req: { user: RequestUser }) {
    return this.service.list(req.user);
  }

  @Post()
  @Roles('teacher', 'admin')
  create(
    @Request() req: { user: RequestUser },
    @Body(new ZodValidationPipe(InputSchema)) body: z.infer<typeof InputSchema>,
  ) {
    return this.service.create(req.user, body);
  }

  @Patch(':id')
  @Roles('teacher', 'admin')
  update(
    @Request() req: { user: RequestUser },
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(InputSchema)) body: z.infer<typeof InputSchema>,
  ) {
    return this.service.update(req.user, id, body);
  }

  @Delete(':id')
  @Roles('teacher', 'admin')
  archive(@Request() req: { user: RequestUser }, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.archive(req.user, id);
  }
}
