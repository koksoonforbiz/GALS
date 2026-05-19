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
} from '@nestjs/common';
import { ModulesService } from './modules.service';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import type { UserRole } from '@ats/shared';

interface RequestUser {
  id: string;
  role: UserRole;
}

@Controller('courses/:courseId/modules')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ModulesController {
  constructor(private readonly modulesService: ModulesService) {}

  @Post()
  @Roles('teacher', 'admin')
  create(
    @Request() req: { user: RequestUser },
    @Param('courseId') courseId: string,
    @Body() dto: { title: string },
  ) {
    return this.modulesService.create(courseId, req.user.id, dto);
  }

  @Patch(':id')
  @Roles('teacher', 'admin')
  update(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: { title?: string },
  ) {
    return this.modulesService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @Roles('teacher', 'admin')
  remove(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.modulesService.remove(id, req.user.id);
  }

  @Post('reorder')
  @Roles('teacher', 'admin')
  reorder(
    @Request() req: { user: RequestUser },
    @Param('courseId') courseId: string,
    @Body() body: { orderedIds: string[] },
  ) {
    return this.modulesService.reorder(courseId, req.user.id, body.orderedIds);
  }
}
