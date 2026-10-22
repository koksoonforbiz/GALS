import { CourseGatesModule } from '../course-gates';
import { Module } from '@nestjs/common';
import { GovernanceModule } from '../governance/governance.module';
import { InteractiveLessonController } from './interactive-lesson.controller';
import { InteractiveLessonService } from './interactive-lesson.service';

@Module({
  imports: [GovernanceModule, CourseGatesModule],
  controllers: [InteractiveLessonController],
  providers: [InteractiveLessonService],
  exports: [InteractiveLessonService],
})
export class InteractiveLessonModule {}
