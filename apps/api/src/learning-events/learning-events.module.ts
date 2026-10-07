import { Module } from '@nestjs/common';
import { RagModule } from '../rag';
import { LearningEventsController } from './learning-events.controller';
import { LearningEventsService } from './learning-events.service';
import { ValidationService } from './validation/validation.service';
import { ResearchExportsService } from './exports/exports.service';
import { PromptClassifierService } from './classifier/classifier.service';
import { TransferTaskService } from './transfer/transfer.service';

/** Parser only (no HTTP) — what the backfill script boots. */
@Module({
  providers: [LearningEventsService],
  exports: [LearningEventsService],
})
export class LearningEventsCoreModule {}

@Module({
  // RagModule provides LlmService for the prompt classifier (no new provider).
  imports: [LearningEventsCoreModule, RagModule],
  controllers: [LearningEventsController],
  providers: [
    ValidationService,
    ResearchExportsService,
    PromptClassifierService,
    TransferTaskService,
  ],
  exports: [LearningEventsCoreModule],
})
export class LearningEventsModule {}
