import { Module } from '@nestjs/common';
import { LearningEventsController } from './learning-events.controller';
import { LearningEventsService } from './learning-events.service';

/** Parser only (no HTTP) — what the backfill script boots. */
@Module({
  providers: [LearningEventsService],
  exports: [LearningEventsService],
})
export class LearningEventsCoreModule {}

@Module({
  imports: [LearningEventsCoreModule],
  controllers: [LearningEventsController],
  exports: [LearningEventsCoreModule],
})
export class LearningEventsModule {}
