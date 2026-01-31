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
import { ItemsService } from './items.service';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import type { UserRole } from '@ats/shared';

interface RequestUser {
  id: string;
  role: UserRole;
}

@Controller('modules/:moduleId/items')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Post()
  @Roles('teacher', 'admin')
  create(
    @Request() req: { user: RequestUser },
    @Param('moduleId') moduleId: string,
    @Body()
    dto: {
      type: 'PAGE' | 'PDF' | 'LINK' | 'ASSESSMENT';
      title: string;
      contentMdx?: string;
      url?: string;
      assessmentId?: string;
    },
  ) {
    return this.itemsService.create(moduleId, req.user.id, dto);
  }

  @Patch(':id')
  @Roles('teacher', 'admin')
  update(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: { title?: string; contentMdx?: string; url?: string },
  ) {
    return this.itemsService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @Roles('teacher', 'admin')
  remove(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.itemsService.remove(id, req.user.id);
  }

  @Post('reorder')
  @Roles('teacher', 'admin')
  reorder(
    @Request() req: { user: RequestUser },
    @Param('moduleId') moduleId: string,
    @Body() body: { orderedIds: string[] },
  ) {
    return this.itemsService.reorder(moduleId, req.user.id, body.orderedIds);
  }
}

// Separate controller for item-level operations (upload/download)
@Controller('items')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ItemActionsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Post(':id/upload-url')
  @Roles('teacher', 'admin')
  getUploadUrl(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() body: { filename: string; size: number },
  ) {
    return this.itemsService.getUploadUrl(id, req.user.id, body.filename, body.size);
  }

  @Get(':id/download-url')
  getDownloadUrl(@Param('id') id: string) {
    return this.itemsService.getDownloadUrl(id);
  }

  // ─── Version History ──────────────────────────────────

  @Get(':id/versions')
  @Roles('teacher', 'admin')
  getVersionHistory(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.itemsService.getVersionHistory(id, req.user.id);
  }

  @Get(':id/versions/:versionId')
  @Roles('teacher', 'admin')
  getVersion(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.itemsService.getVersion(id, versionId, req.user.id);
  }

  @Post(':id/versions/:versionId/rollback')
  @Roles('teacher', 'admin')
  rollbackToVersion(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.itemsService.rollbackToVersion(id, versionId, req.user.id);
  }
}
