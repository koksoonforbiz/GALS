import { Module } from '@nestjs/common';
import { CourseFlagsController } from './course-flags.controller';
import { CourseFlagsService } from './course-flags.service';

@Module({
  controllers: [CourseFlagsController],
  providers: [CourseFlagsService],
  exports: [CourseFlagsService],
})
export class CourseFlagsModule {}
