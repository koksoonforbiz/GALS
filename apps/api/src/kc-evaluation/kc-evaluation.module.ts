import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { KcEvaluationService } from './kc-evaluation.service';
import { KcEvaluationController } from './kc-evaluation.controller';

@Module({
  imports: [PrismaModule],
  controllers: [KcEvaluationController],
  providers: [KcEvaluationService],
  exports: [KcEvaluationService],
})
export class KcEvaluationModule {}
