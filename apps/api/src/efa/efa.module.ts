import { Module } from '@nestjs/common';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { CourseGatesModule } from '../course-gates';
import { EfaAllocationService } from './allocation.service';
import { EfaOccasionService } from './occasion.service';
import { PuzzlesController } from './puzzles.controller';

/** EF assessment (docs/EF_battery_v2). Student routes are the neutral /api/puzzles. */
@Module({
  imports: [ActivityLogModule, CourseGatesModule],
  controllers: [PuzzlesController],
  providers: [EfaAllocationService, EfaOccasionService],
  exports: [EfaAllocationService, EfaOccasionService],
})
export class EfaModule {}
