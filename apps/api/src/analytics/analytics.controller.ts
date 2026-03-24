import { Controller, Post, Get, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('compute')
  async compute(@Body() dto: { sessionId: string; jobType: string }) {
    return this.analyticsService.compute(dto.sessionId, dto.jobType);
  }

  @Get(':sessionId/summary')
  async getSummary(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.analyticsService.getSummary(sessionId);
  }
}
