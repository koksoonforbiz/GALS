import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { RagModule } from '../rag';
import { ActivityLogModule } from '../activity-log';
import { CodePracticeModule } from '../code-practice/code-practice.module';
import { CodeDecompositionController } from './code-decomposition.controller';
import { CodeDecompositionService } from './code-decomposition.service';

// Sibling to learning-interventions/code-practice, not nested under
// either — DBox needs its own controller (a multi-turn interactive
// session, unlike code-practice's in-process-only generator) but its
// problem generation still delegates to CodePracticeService so there's
// only one place that knows how to mint an ungraded coding exercise.
@Module({
  imports: [PrismaModule, RagModule, ActivityLogModule, CodePracticeModule],
  controllers: [CodeDecompositionController],
  providers: [CodeDecompositionService],
  exports: [CodeDecompositionService],
})
export class CodeDecompositionModule {}
