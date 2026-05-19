import {
  Controller,
  Post,
  Body,
  Param,
  Request,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PageContentService } from './page-content.service';

interface RequestUser {
  user: { id: string; role: string };
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class PageContentController {
  private readonly logger = new Logger(PageContentController.name);

  constructor(private readonly pageContentService: PageContentService) {}

  // ─── Suggest Prompt ────────────────────────────────────

  @Post('admin/ai/suggest-prompt')
  @Roles('teacher', 'admin')
  async suggestPrompt(
    @Body()
    body: {
      courseId: string;
      moduleId: string;
      pageIds: string[];
      selectedSourceIds?: string[];
      strictSources?: boolean;
      scopePreference?: string;
    },
  ) {
    if (!body.courseId) throw new BadRequestException('courseId required');
    if (!body.moduleId) throw new BadRequestException('moduleId required');
    if (!body.pageIds?.length) throw new BadRequestException('pageIds required');

    return this.pageContentService.suggestPrompt({
      courseId: body.courseId,
      moduleId: body.moduleId,
      pageIds: body.pageIds,
      selectedSourceIds: body.selectedSourceIds || [],
      strictSources: body.strictSources ?? true,
      scopePreference: body.scopePreference || 'module_then_course',
    });
  }

  // ─── Single Page Generation ────────────────────────────

  @Post('admin/pages/:pageId/generate-content')
  @Roles('teacher', 'admin')
  async generateSinglePage(
    @Param('pageId') pageId: string,
    @Body()
    body: {
      courseId: string;
      moduleId: string;
      selectedSourceIds?: string[];
      strictSources?: boolean;
      scopePreference?: string;
      adminPrompt?: string;
    },
    @Request() req: RequestUser,
  ) {
    if (!body.courseId) throw new BadRequestException('courseId required');
    if (!body.moduleId) throw new BadRequestException('moduleId required');

    this.logger.log(
      `Single page generation: page=${pageId}, course=${body.courseId}, user=${req.user.id}`,
    );

    return this.pageContentService.generatePageContent({
      courseId: body.courseId,
      userId: req.user.id,
      pageId,
      moduleId: body.moduleId,
      selectedSourceIds: body.selectedSourceIds || [],
      strictSources: body.strictSources ?? true,
      scopePreference: (body.scopePreference as any) || 'module_then_course',
      adminPrompt: body.adminPrompt || '',
    });
  }

  // ─── Batch Generation ──────────────────────────────────

  @Post('admin/pages/generate-content-batch')
  @Roles('teacher', 'admin')
  async generateBatch(
    @Body()
    body: {
      courseId: string;
      moduleId: string;
      pageIds: string[];
      selectedSourceIds?: string[];
      strictSources?: boolean;
      scopePreference?: string;
      adminPrompt?: string;
    },
    @Request() req: RequestUser,
  ) {
    if (!body.courseId) throw new BadRequestException('courseId required');
    if (!body.moduleId) throw new BadRequestException('moduleId required');
    if (!body.pageIds?.length) throw new BadRequestException('pageIds required (non-empty array)');
    if (body.pageIds.length > 20) {
      throw new BadRequestException('Maximum 20 pages per batch');
    }

    this.logger.log(
      `Batch generation: ${body.pageIds.length} pages, course=${body.courseId}, user=${req.user.id}`,
    );

    return this.pageContentService.generateBatch({
      courseId: body.courseId,
      userId: req.user.id,
      moduleId: body.moduleId,
      pageIds: body.pageIds,
      selectedSourceIds: body.selectedSourceIds || [],
      strictSources: body.strictSources ?? true,
      scopePreference: (body.scopePreference as any) || 'module_then_course',
      adminPrompt: body.adminPrompt || '',
    });
  }
}
