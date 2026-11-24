import { Module } from '@nestjs/common';
import { CourseGatesModule } from '../course-gates';
import { CourseProgressController } from './course-progress.controller';
import { CourseProgressService } from './course-progress.service';

@Module({
  imports: [CourseGatesModule],
  controllers: [CourseProgressController],
  providers: [CourseProgressService],
})
export class CourseProgressModule {}
