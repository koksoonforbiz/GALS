import { Module } from '@nestjs/common';
import { RagModule } from '../rag';
import { CodePracticeService } from './code-practice.service';

// No controller: generation is only ever triggered in-process from
// LearningInterventionsService.chat() when it detects a coding-practice
// request in the standard-mode chatbot — there is deliberately no public
// HTTP route to "start" a code question.
@Module({
  imports: [RagModule],
  providers: [CodePracticeService],
  exports: [CodePracticeService],
})
export class CodePracticeModule {}
