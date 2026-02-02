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
import { KcGraphService } from './kc-graph.service';
import { KnowledgeVersionService } from '../knowledge-version/knowledge-version.service';
import type { UserRole } from '@ats/shared';

interface RequestUser {
  id: string;
  role: UserRole;
}

@Controller('kc-graph')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class KcGraphController {
  constructor(
    private readonly kcGraphService: KcGraphService,
    private readonly versionService: KnowledgeVersionService,
  ) {}

  /** Generate knowledge graph edges using AI */
  @Post('generate')
  async generate(
    @Request() req: { user: RequestUser },
    @Body() dto: { courseId: string },
  ) {
    const result = await this.kcGraphService.generateGraph(dto.courseId, req.user.id);
    this.versionService.createSnapshot(
      dto.courseId, 'EDGE_GENERATE',
      'AI-generated graph edges', 'ai', req.user.id,
    ).catch(() => {});
    return result;
  }

  /** Get the full graph (nodes + edges) for a course */
  @Get()
  getGraph(@Query('courseId') courseId: string) {
    return this.kcGraphService.getGraph(courseId);
  }

  /** Add a manual edge */
  @Post('edges')
  async addEdge(
    @Request() req: { user: RequestUser },
    @Body() dto: { courseId: string; fromKcId: string; toKcId: string; relationship?: string; weight?: number },
  ) {
    const result = await this.kcGraphService.addEdge(
      dto.courseId,
      dto.fromKcId,
      dto.toKcId,
      dto.relationship || 'prerequisite',
      dto.weight ?? 1,
    );
    this.versionService.createSnapshot(
      dto.courseId, 'EDGE_ADD',
      `Added ${dto.relationship || 'prerequisite'} edge`, 'human', req.user.id,
    ).catch(() => {});
    return result;
  }

  /** Update an edge */
  @Patch('edges/:id')
  async updateEdge(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: { relationship?: string; weight?: number; courseId?: string },
  ) {
    const result = await this.kcGraphService.updateEdge(id, dto);
    if (result.courseId) {
      this.versionService.createSnapshot(
        result.courseId, 'EDGE_UPDATE',
        'Updated graph edge', 'human', req.user.id,
      ).catch(() => {});
    }
    return result;
  }

  /** Remove an edge */
  @Delete('edges/:id')
  async removeEdge(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Query('courseId') courseId?: string,
  ) {
    const result = await this.kcGraphService.removeEdge(id);
    if (courseId) {
      this.versionService.createSnapshot(
        courseId, 'EDGE_DELETE',
        'Removed graph edge', 'human', req.user.id,
      ).catch(() => {});
    }
    return result;
  }

  /** Get topological ordering */
  @Get('topological-order')
  topologicalOrder(@Query('courseId') courseId: string) {
    return this.kcGraphService.getTopologicalOrder(courseId);
  }

  /** Detect cycles */
  @Get('cycles')
  detectCycles(@Query('courseId') courseId: string) {
    return this.kcGraphService.detectCycles(courseId);
  }

  /** Save graph layout (node positions, sizes, viewBox) */
  @Post('layout')
  saveLayout(@Body() dto: { courseId: string; layout: any }) {
    return this.kcGraphService.saveLayout(dto.courseId, dto.layout);
  }

  /** Load graph layout */
  @Get('layout')
  loadLayout(@Query('courseId') courseId: string) {
    return this.kcGraphService.loadLayout(courseId);
  }

  /** Update a single KC's hierarchy (topicId / subtopicId) */
  @Patch('hierarchy/:kcId')
  async updateKcHierarchy(
    @Request() req: { user: RequestUser },
    @Param('kcId') kcId: string,
    @Body() dto: { topicId?: string | null; subtopicId?: string | null; courseId?: string },
  ) {
    const result = await this.kcGraphService.updateKcHierarchy(kcId, dto);
    if (dto.courseId) {
      this.versionService.createSnapshot(
        dto.courseId, 'KC_EDIT',
        'Updated KC hierarchy assignment', 'human', req.user.id,
      ).catch(() => {});
    }
    return result;
  }

  /** Batch-update hierarchy for multiple KCs */
  @Post('hierarchy/batch')
  async batchUpdateHierarchy(
    @Request() req: { user: RequestUser },
    @Body() dto: { courseId: string; assignments: Array<{ kcId: string; topicId?: string | null; subtopicId?: string | null }> },
  ) {
    const result = await this.kcGraphService.batchUpdateHierarchy(dto.courseId, dto.assignments);
    this.versionService.createSnapshot(
      dto.courseId, 'KC_EDIT',
      `Batch-updated hierarchy for ${result.updated} KCs`, 'human', req.user.id,
    ).catch(() => {});
    return result;
  }

  /** Get available topics and modules for hierarchy sidebar */
  @Get('hierarchy-options')
  getHierarchyOptions(@Query('courseId') courseId: string) {
    return this.kcGraphService.getHierarchyOptions(courseId);
  }
}
