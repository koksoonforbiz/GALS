import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { KcMappingService } from './kc-mapping.service';

@Controller('kc-mappings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class KcMappingController {
  constructor(private readonly kcMappingService: KcMappingService) {}

  /** List all mappings for a course */
  @Get()
  list(@Query('courseId') courseId: string) {
    return this.kcMappingService.listByCourse(courseId);
  }

  /** List mappings for a KC */
  @Get('by-kc/:kcId')
  listByKc(@Param('kcId') kcId: string) {
    return this.kcMappingService.listByKc(kcId);
  }

  /** List mappings for a page */
  @Get('by-page/:pageId')
  listByPage(@Param('pageId') pageId: string) {
    return this.kcMappingService.listByPage(pageId);
  }

  /** Get bidirectional summary */
  @Get('summary')
  summary(@Query('courseId') courseId: string) {
    return this.kcMappingService.getSummary(courseId);
  }

  /** Create or update a mapping */
  @Post()
  upsert(
    @Body() dto: {
      courseId: string;
      kcId: string;
      pageId: string;
      strength: string;
      blockIds?: string[];
    },
  ) {
    return this.kcMappingService.upsertMapping({ ...dto, createdBy: 'human' });
  }

  /** Update mapping strength */
  @Patch(':id')
  updateStrength(
    @Param('id') id: string,
    @Body() dto: { strength: string },
  ) {
    return this.kcMappingService.updateStrength(id, dto.strength);
  }

  /** Remove a mapping */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.kcMappingService.remove(id);
  }

  /** Auto-generate mappings from KC evidence */
  @Post('auto-generate')
  autoGenerate(@Body() dto: { courseId: string }) {
    return this.kcMappingService.autoGenerateFromEvidence(dto.courseId);
  }
}
