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
import type { UserRole } from '@ats/shared';

interface RequestUser {
  id: string;
  role: UserRole;
}

@Controller('kc-graph')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class KcGraphController {
  constructor(private readonly kcGraphService: KcGraphService) {}

  /** Generate knowledge graph edges using AI */
  @Post('generate')
  generate(
    @Request() req: { user: RequestUser },
    @Body() dto: { courseId: string },
  ) {
    return this.kcGraphService.generateGraph(dto.courseId, req.user.id);
  }

  /** Get the full graph (nodes + edges) for a course */
  @Get()
  getGraph(@Query('courseId') courseId: string) {
    return this.kcGraphService.getGraph(courseId);
  }

  /** Add a manual edge */
  @Post('edges')
  addEdge(
    @Body() dto: { courseId: string; fromKcId: string; toKcId: string; relationship?: string; weight?: number },
  ) {
    return this.kcGraphService.addEdge(
      dto.courseId,
      dto.fromKcId,
      dto.toKcId,
      dto.relationship || 'prerequisite',
      dto.weight ?? 1,
    );
  }

  /** Update an edge */
  @Patch('edges/:id')
  updateEdge(
    @Param('id') id: string,
    @Body() dto: { relationship?: string; weight?: number },
  ) {
    return this.kcGraphService.updateEdge(id, dto);
  }

  /** Remove an edge */
  @Delete('edges/:id')
  removeEdge(@Param('id') id: string) {
    return this.kcGraphService.removeEdge(id);
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
}
