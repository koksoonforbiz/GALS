import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { EngagementService } from './computations/engagement.service';
import { CognitiveLoadService } from './computations/cognitive-load.service';
import { EmotionService } from './computations/emotion.service';
import { LearningVelocityService } from './computations/learning-velocity.service';
import { AtRiskService } from './computations/at-risk.service';

@Module({
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    EngagementService,
    CognitiveLoadService,
    EmotionService,
    LearningVelocityService,
    AtRiskService,
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
