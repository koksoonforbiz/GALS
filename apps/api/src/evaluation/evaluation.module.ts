import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { RagModule } from '../rag';
import { EvaluationController } from './evaluation.controller';
import { EvaluationService } from './evaluation.service';
import { MathNormalizerService } from './math-normalizer.service';

@Module({
  imports: [PrismaModule, RagModule],
  controllers: [EvaluationController],
  providers: [EvaluationService, MathNormalizerService],
  exports: [EvaluationService, MathNormalizerService],
})
export class EvaluationModule {}
