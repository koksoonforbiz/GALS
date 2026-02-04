import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { KcCrudService } from './kc-crud.service';
import { KcNormalizationService } from './kc-normalization.service';
import { KnowledgeVersionService } from '../knowledge-version/knowledge-version.service';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('proposed-kcs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class KcController {
  constructor(
    private readonly kcCrudService: KcCrudService,
    private readonly kcNormalizationService: KcNormalizationService,
    private readonly versionService: KnowledgeVersionService,
  ) {}

  /** List proposed KCs for a course, optionally filtered by status */
  @Get()
  list(@Query('courseId') courseId: string, @Query('status') status?: string) {
    return this.kcCrudService.list(courseId, status);
  }

  /** Get summary stats for a course's proposed KCs */
  @Get('stats')
  stats(@Query('courseId') courseId: string) {
    return this.kcCrudService.stats(courseId);
  }

  /** Find similar KC pairs for dedup/merge suggestions */
  @Get('similar-pairs')
  similarPairs(@Query('courseId') courseId: string, @Query('threshold') threshold?: string) {
    const t = threshold ? parseFloat(threshold) : 0.6;
    return this.kcNormalizationService.findSimilarPairs(courseId, t);
  }

  /** Get health indicators for all KCs in a course */
  @Get('health')
  health(@Query('courseId') courseId: string) {
    return this.kcNormalizationService.getHealthIndicators(courseId);
  }

  /** Get a single proposed KC by id */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.kcCrudService.findOne(id);
  }

  /** Update a proposed KC (rename, change description, change status) */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Request() req: { user: RequestUser },
    @Body() dto: { name?: string; description?: string; status?: string; confidenceLevel?: string },
  ) {
    const result = await this.kcCrudService.update(id, dto);
    this.versionService
      .createSnapshot(
        result.courseId,
        'KC_EDIT',
        `Edited KC "${result.name}"`,
        'human',
        req.user.id,
      )
      .catch(() => {});
    return result;
  }

  /** Approve a proposed KC */
  @Post(':id/approve')
  async approve(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    const result = await this.kcCrudService.approve(id);
    this.versionService
      .createSnapshot(
        result.courseId,
        'KC_APPROVE',
        `Approved KC "${result.name}"`,
        'human',
        req.user.id,
      )
      .catch(() => {});
    return result;
  }

  /** Archive a proposed KC */
  @Post(':id/archive')
  async archive(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    const result = await this.kcCrudService.archive(id);
    this.versionService
      .createSnapshot(
        result.courseId,
        'KC_ARCHIVE',
        `Archived KC "${result.name}"`,
        'human',
        req.user.id,
      )
      .catch(() => {});
    return result;
  }

  /** Merge two proposed KCs (keep target, archive source) */
  @Post('merge')
  async merge(
    @Request() req: { user: RequestUser },
    @Body() dto: { targetId: string; sourceId: string },
  ) {
    const result = await this.kcCrudService.merge(dto.targetId, dto.sourceId);
    this.versionService
      .createSnapshot(
        result.courseId,
        'KC_MERGE',
        `Merged KCs into "${result.name}"`,
        'human',
        req.user.id,
      )
      .catch(() => {});
    return result;
  }

  /** Delete a proposed KC */
  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    const kc = await this.kcCrudService.findOne(id);
    const courseId = kc.courseId;
    const kcName = kc.name;
    const result = await this.kcCrudService.remove(id);
    this.versionService
      .createSnapshot(courseId, 'KC_DELETE', `Deleted KC "${kcName}"`, 'human', req.user.id)
      .catch(() => {});
    return result;
  }
}
