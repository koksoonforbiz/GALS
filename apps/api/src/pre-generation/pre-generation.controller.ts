import { Controller, Get, Patch, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PreGenerationService } from './pre-generation.service';
import type { PreGenerationConfigDto } from './dto/pre-generation-config.dto';

@Controller('pre-generation')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PreGenerationController {
  constructor(private readonly svc: PreGenerationService) {}

  @Get('config/:courseId')
  @Roles('teacher', 'admin')
  getConfig(@Param('courseId') courseId: string) {
    return this.svc.getConfig(courseId);
  }

  @Patch('config/:courseId')
  @Roles('teacher', 'admin')
  updateConfig(@Param('courseId') courseId: string, @Body() dto: PreGenerationConfigDto) {
    return this.svc.updateConfig(courseId, dto);
  }

  @Get('match-document')
  @Roles('teacher', 'admin', 'student')
  matchDocument(@Query('courseId') courseId: string, @Query('filename') filename: string) {
    return this.svc.matchDocument(courseId, filename);
  }

  @Get('ready')
  @Roles('teacher', 'admin', 'student')
  getReadiness(@Query('documentId') documentId: string, @Query('pageNumber') pageNumber: string) {
    return this.svc.getReadiness(documentId, parseInt(pageNumber, 10));
  }

  @Get('status/:documentId')
  @Roles('teacher', 'admin')
  getDocumentStatus(@Param('documentId') documentId: string) {
    return this.svc.getDocumentStatus(documentId);
  }

  @Get('exercises')
  @Roles('teacher', 'admin')
  getExercises(
    @Query('documentId') documentId: string,
    @Query('pageNumber') pageNumber?: string,
    @Query('strategy') strategy?: string,
  ) {
    const page = pageNumber != null && pageNumber !== '' ? parseInt(pageNumber, 10) : undefined;
    return this.svc.getExercises(documentId, page, strategy);
  }

  @Get('cost/:courseId')
  @Roles('teacher', 'admin')
  getCost(@Param('courseId') courseId: string) {
    return this.svc.getPregenCost(courseId);
  }

  @Post('regenerate')
  @Roles('teacher', 'admin')
  regenerate(@Query('documentId') documentId: string) {
    return this.svc.regenerateDocument(documentId);
  }

  @Post('regenerate-course')
  @Roles('teacher', 'admin')
  regenerateCourse(@Query('courseId') courseId: string) {
    return this.svc.regenerateCourse(courseId);
  }

  @Get('module-items/list')
  @Roles('teacher', 'admin')
  listModuleItems(@Query('courseId') courseId: string) {
    return this.svc.listModuleItemPdfs(courseId);
  }

  @Post('module-items/:itemId/queue')
  @Roles('teacher', 'admin')
  queueModuleItem(@Param('itemId') itemId: string) {
    return this.svc.queueModuleItemPregen(itemId);
  }
}
