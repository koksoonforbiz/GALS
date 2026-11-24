import { CourseGatesModule } from '../course-gates';
import { Module } from '@nestjs/common';
import { GovernanceModule } from '../governance/governance.module';
import { InteractiveLessonController } from './interactive-lesson.controller';
import { InteractiveLessonService } from './interactive-lesson.service';
import { RagModule } from '../rag';

@Module({
  // RagModule: LlmService for checkpoint feedback (same funnel as Prompt Lab).
  imports: [GovernanceModule, CourseGatesModule, RagModule],
  controllers: [InteractiveLessonController],
  providers: [InteractiveLessonService],
  exports: [InteractiveLessonService],
})
export class InteractiveLessonModule {}
