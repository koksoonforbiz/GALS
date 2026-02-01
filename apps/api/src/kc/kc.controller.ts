import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { KcCrudService } from './kc-crud.service';

@Controller('proposed-kcs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class KcController {
  constructor(private readonly kcCrudService: KcCrudService) {}

  /** List proposed KCs for a course, optionally filtered by status */
  @Get()
  list(
    @Query('courseId') courseId: string,
    @Query('status') status?: string,
  ) {
    return this.kcCrudService.list(courseId, status);
  }

  /** Get a single proposed KC by id */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.kcCrudService.findOne(id);
  }

  /** Update a proposed KC (rename, change description, change status) */
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: { name?: string; description?: string; status?: string; confidenceLevel?: string },
  ) {
    return this.kcCrudService.update(id, dto);
  }

  /** Approve a proposed KC */
  @Post(':id/approve')
  approve(@Param('id') id: string) {
    return this.kcCrudService.approve(id);
  }

  /** Archive a proposed KC */
  @Post(':id/archive')
  archive(@Param('id') id: string) {
    return this.kcCrudService.archive(id);
  }

  /** Merge two proposed KCs (keep target, archive source) */
  @Post('merge')
  merge(@Body() dto: { targetId: string; sourceId: string }) {
    return this.kcCrudService.merge(dto.targetId, dto.sourceId);
  }

  /** Delete a proposed KC */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.kcCrudService.remove(id);
  }

  /** Get summary stats for a course's proposed KCs */
  @Get('stats')
  stats(@Query('courseId') courseId: string) {
    return this.kcCrudService.stats(courseId);
  }
}
