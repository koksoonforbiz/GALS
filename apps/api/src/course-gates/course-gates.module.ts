import { Module } from '@nestjs/common';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { CourseGateController } from './course-gate.controller';
import { CourseGateService } from './course-gate.service';

@Module({
  imports: [ActivityLogModule],
  controllers: [CourseGateController],
  providers: [CourseGateService],
  exports: [CourseGateService],
})
export class CourseGatesModule {}
