import { Controller, Get, Patch, Body, Param, UseGuards } from '@nestjs/common';
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

  @Get('status/:documentId')
  @Roles('teacher', 'admin')
  getDocumentStatus(@Param('documentId') documentId: string) {
    return this.svc.getDocumentStatus(documentId);
  }
}
