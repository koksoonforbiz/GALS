import { Module } from '@nestjs/common';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { QuestionGenerationController } from './question-generation.controller';
import { QuestionGenerationService } from './question-generation.service';
import { RagModule } from '../rag/rag.module';

@Module({
  imports: [RagModule],
  controllers: [QuestionsController, QuestionGenerationController],
  providers: [QuestionsService, QuestionGenerationService],
  exports: [QuestionsService, QuestionGenerationService],
})
export class QuestionsModule {}
