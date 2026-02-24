import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { RagModule } from '../rag';
import { LearningInterventionsController } from './learning-interventions.controller';
import { LearningInterventionsService } from './learning-interventions.service';

@Module({
  imports: [PrismaModule, RagModule],
  controllers: [LearningInterventionsController],
  providers: [LearningInterventionsService],
  exports: [LearningInterventionsService],
})
export class LearningInterventionsModule {}
