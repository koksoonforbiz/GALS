import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Request,
  UseGuards,
  Res,
  Header,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { KnowledgeVersionService } from './knowledge-version.service';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('courses/:courseId/knowledge-versions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class KnowledgeVersionController {
  constructor(private readonly versionService: KnowledgeVersionService) {}

  /** List all knowledge versions for a course */
  @Get()
  listVersions(
    @Param('courseId') courseId: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.versionService.listVersions(courseId, req.user.id);
  }

  /** Get a specific version with full snapshot data */
  @Get(':versionId')
  getVersion(
    @Param('versionId') versionId: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.versionService.getVersion(versionId, req.user.id);
  }

  /** Diff between a version and the current live state */
  @Get(':versionId/diff')
  diffFromCurrent(
    @Param('courseId') courseId: string,
    @Param('versionId') versionId: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.versionService.diffFromCurrent(courseId, req.user.id, versionId);
  }

  /** Diff between two versions */
  @Get('compare')
  diffVersions(
    @Param('courseId') courseId: string,
    @Request() req: { user: RequestUser },
    @Query('from') fromVersionId: string,
    @Query('to') toVersionId: string,
  ) {
    return this.versionService.diffVersions(courseId, req.user.id, fromVersionId, toVersionId);
  }

  /** Restore a version — creates a NEW latest version */
  @Post(':versionId/restore')
  restoreVersion(
    @Param('versionId') versionId: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.versionService.restoreVersion(versionId, req.user.id);
  }

  /** Export a version snapshot as JSON */
  @Get(':versionId/export')
  @Header('Content-Type', 'application/json')
  async exportVersion(
    @Param('versionId') versionId: string,
    @Request() req: { user: RequestUser },
    @Res() res: Response,
  ) {
    const version = await this.versionService.getVersion(versionId, req.user.id);
    const filename = `knowledge-v${version.version}-${versionId.slice(0, 8)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json({
      version: version.version,
      changeType: version.changeType,
      changeSummary: version.changeSummary,
      createdAt: version.createdAt,
      kcs: version.snapshotKcs,
      edges: version.snapshotEdges,
      mappings: version.snapshotMaps,
    });
  }
}
