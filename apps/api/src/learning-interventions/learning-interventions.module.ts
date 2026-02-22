import { Module } from '@nestjs/common';
import { RagModule } from '../rag';
import { LearningInterventionsController } from './learning-interventions.controller';
import { LearningInterventionsService } from './learning-interventions.service';

@Module({
  imports: [RagModule],
  controllers: [LearningInterventionsController],
  providers: [LearningInterventionsService],
  exports: [LearningInterventionsService],
})
export class LearningInterventionsModule {}
