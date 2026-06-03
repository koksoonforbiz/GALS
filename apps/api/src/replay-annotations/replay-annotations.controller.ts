import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ReplayAnnotationsService } from './replay-annotations.service';

interface RequestUser {
  id: string;
  role: string;
}

/**
 * Researcher-facing CRUD for replay codes + annotations (prompt 06).
 * Teacher + admin roles only — annotations are an analysis tool, not
 * something students see or interact with.
 */
@Controller('replay-annotations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReplayAnnotationsController {
  constructor(private readonly service: ReplayAnnotationsService) {}

  // ─── Codes ─────────────────────────────────────────────

  @Get('codes')
  @Roles('teacher', 'admin')
  listCodes(@Request() req: { user: RequestUser }) {
    return this.service.listCodes(req.user.id);
  }

  @Post('codes')
  @Roles('teacher', 'admin')
  createCode(
    @Request() req: { user: RequestUser },
    @Body() body: { label: string; color?: string },
  ) {
    return this.service.createCode(req.user.id, body);
  }

  @Patch('codes/:id')
  @Roles('teacher', 'admin')
  updateCode(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() body: { label?: string; color?: string | null },
  ) {
    return this.service.updateCode(id, req.user.id, body);
  }

  @Delete('codes/:id')
  @Roles('teacher', 'admin')
  deleteCode(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.service.deleteCode(id, req.user.id);
  }

  // ─── Annotations ───────────────────────────────────────

  @Get()
  @Roles('teacher', 'admin')
  list(
    @Request() req: { user: RequestUser },
    @Query('sessionId') sessionId: string,
  ) {
    return this.service.listBySession(sessionId, req.user.id);
  }

  @Post()
  @Roles('teacher', 'admin')
  create(
    @Request() req: { user: RequestUser },
    @Body()
    body: {
      sessionId: string;
      codeId?: string | null;
      startMs: number;
      endMs?: number | null;
      note?: string | null;
    },
  ) {
    return this.service.create(req.user.id, body);
  }

  @Patch(':id')
  @Roles('teacher', 'admin')
  update(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body()
    body: {
      codeId?: string | null;
      startMs?: number;
      endMs?: number | null;
      note?: string | null;
    },
  ) {
    return this.service.update(id, req.user.id, body);
  }

  @Delete(':id')
  @Roles('teacher', 'admin')
  delete(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.service.delete(id, req.user.id);
  }
}
