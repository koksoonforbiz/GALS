import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { LearningInterventionsModule } from '../learning-interventions';
import { RagModule } from '../rag/rag.module';
import { PreGenerationService } from './pre-generation.service';
import { PreGenerationController } from './pre-generation.controller';

@Module({
  imports: [PrismaModule, RagModule, forwardRef(() => LearningInterventionsModule)],
  controllers: [PreGenerationController],
  providers: [PreGenerationService],
  exports: [PreGenerationService],
})
export class PreGenerationModule {}
