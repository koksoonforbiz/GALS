import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { LearningInterventionsModule } from '../learning-interventions';
import { PreGenerationService } from './pre-generation.service';
import { PreGenerationController } from './pre-generation.controller';

@Module({
  imports: [PrismaModule, forwardRef(() => LearningInterventionsModule)],
  controllers: [PreGenerationController],
  providers: [PreGenerationService],
  exports: [PreGenerationService],
})
export class PreGenerationModule {}
