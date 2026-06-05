import { Controller, Get, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
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
}
