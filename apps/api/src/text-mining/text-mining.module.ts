import { Module } from '@nestjs/common';
import { TextMiningController } from './text-mining.controller';
import { TextMiningService } from './text-mining.service';
import { TextMiningGateway } from './text-mining.gateway';
import { DetectionService } from './detection/detection.service';
import { PromptsService } from './prompts/prompts.service';
import { DashboardService } from './dashboard/dashboard.service';
import { TeacherSettingsService } from './settings/teacher-settings.service';

@Module({
  controllers: [TextMiningController],
  providers: [
    TextMiningService,
    TextMiningGateway,
    DetectionService,
    PromptsService,
    DashboardService,
    TeacherSettingsService,
  ],
  exports: [TextMiningService],
})
export class TextMiningModule {}
