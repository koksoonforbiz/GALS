import { Module } from '@nestjs/common';
import { InteractiveLessonController } from './interactive-lesson.controller';
import { InteractiveLessonService } from './interactive-lesson.service';

@Module({
  controllers: [InteractiveLessonController],
  providers: [InteractiveLessonService],
  exports: [InteractiveLessonService],
})
export class InteractiveLessonModule {}
