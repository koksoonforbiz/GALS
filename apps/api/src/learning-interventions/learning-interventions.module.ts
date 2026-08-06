import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { RagModule } from '../rag';
import { ActivityLogModule } from '../activity-log';
import { TextMiningModule } from '../text-mining';
import { CodePracticeModule } from '../code-practice/code-practice.module';
import { LearningInterventionsController } from './learning-interventions.controller';
import { LearningInterventionsService } from './learning-interventions.service';

@Module({
  // RagModule is imported because it also provides LlmService (the
  // shared LLM client). The service intentionally does NOT inject
  // `RagService` — see learning-interventions.service.ts. Dialogue-based
  // learning grounds only on each student's own uploaded materials
  // (`student_rag_chunks`), never on the teacher's course-level corpus
  // (`document_chunks`).
  // Stage 02: `StudentRagRetrievalService` + `EmbeddingService` come
  // through RagModule exports — no need to import StudentRagModule
  // here (which would create a circular dep).
  imports: [
    PrismaModule,
    RagModule,
    ActivityLogModule,
    forwardRef(() => TextMiningModule),
    CodePracticeModule,
  ],
  controllers: [LearningInterventionsController],
  providers: [LearningInterventionsService],
  exports: [LearningInterventionsService],
})
export class LearningInterventionsModule {}
