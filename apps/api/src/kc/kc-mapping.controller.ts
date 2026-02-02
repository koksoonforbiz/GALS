import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { KcMappingService } from './kc-mapping.service';
import { KnowledgeVersionService } from '../knowledge-version/knowledge-version.service';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('kc-mappings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class KcMappingController {
  constructor(
    private readonly kcMappingService: KcMappingService,
    private readonly versionService: KnowledgeVersionService,
  ) {}

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
  async upsert(
    @Request() req: { user: RequestUser },
    @Body() dto: {
      courseId: string;
      kcId: string;
      pageId: string;
      strength: string;
      blockIds?: string[];
    },
  ) {
    const result = await this.kcMappingService.upsertMapping({ ...dto, createdBy: 'human' });
    this.versionService.createSnapshot(
      dto.courseId, 'MAPPING_ADD',
      `Added/updated KC-content mapping (${dto.strength})`, 'human', req.user.id,
    ).catch(() => {});
    return result;
  }

  /** Update mapping strength */
  @Patch(':id')
  async updateStrength(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: { strength: string; courseId?: string },
  ) {
    const result = await this.kcMappingService.updateStrength(id, dto.strength);
    if (result.courseId) {
      this.versionService.createSnapshot(
        result.courseId, 'MAPPING_UPDATE',
        `Updated mapping strength to ${dto.strength}`, 'human', req.user.id,
      ).catch(() => {});
    }
    return result;
  }

  /** Remove a mapping */
  @Delete(':id')
  async remove(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Query('courseId') courseId?: string,
  ) {
    const result = await this.kcMappingService.remove(id);
    if (courseId) {
      this.versionService.createSnapshot(
        courseId, 'MAPPING_DELETE',
        'Removed KC-content mapping', 'human', req.user.id,
      ).catch(() => {});
    }
    return result;
  }

  /** Auto-generate mappings from KC evidence */
  @Post('auto-generate')
  async autoGenerate(
    @Request() req: { user: RequestUser },
    @Body() dto: { courseId: string },
  ) {
    const result = await this.kcMappingService.autoGenerateFromEvidence(dto.courseId);
    this.versionService.createSnapshot(
      dto.courseId, 'MAPPING_AUTO_GENERATE',
      'Auto-generated KC-content mappings from evidence', 'ai', req.user.id,
    ).catch(() => {});
    return result;
  }
}
