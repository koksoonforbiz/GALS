import { Module } from '@nestjs/common';
import { RagModule } from '../rag';
import { GovernanceModule } from '../governance/governance.module';
import { LearningEventsController } from './learning-events.controller';
import { LearningEventsService } from './learning-events.service';
import { ValidationService } from './validation/validation.service';
import { ResearchExportsService } from './exports/exports.service';
import { PromptClassifierService } from './classifier/classifier.service';
import { TransferTaskService } from './transfer/transfer.service';
import { NudgeController } from './nudges/nudge.controller';
import { NudgeService } from './nudges/nudge.service';

/** Parser only (no HTTP) — what the backfill script boots. */
@Module({
  providers: [LearningEventsService],
  exports: [LearningEventsService],
})
export class LearningEventsCoreModule {}

@Module({
  // RagModule provides LlmService for the prompt classifier (no new provider).
  imports: [LearningEventsCoreModule, RagModule, GovernanceModule],
  controllers: [LearningEventsController, NudgeController],
  providers: [
    ValidationService,
    ResearchExportsService,
    PromptClassifierService,
    TransferTaskService,
    NudgeService,
  ],
  exports: [LearningEventsCoreModule],
})
export class LearningEventsModule {}
