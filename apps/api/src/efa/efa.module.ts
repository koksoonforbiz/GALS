import { Module } from '@nestjs/common';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { CourseGatesModule } from '../course-gates';
import { EfaAllocationService } from './allocation.service';
import { EfaCodingService } from './coding/coding.service';
import { EfaAdminController } from './efa-admin.controller';
import { EfaExportsService } from './exports/efa-exports.service';
import { EfaOccasionService } from './occasion.service';
import { PuzzlesController } from './puzzles.controller';
import { EfaScoringService } from './scoring/scoring.service';
import { EfaTaskRunService } from './task-run.service';

/**
 * EF assessment (docs/EF_battery_v2). Student routes are the neutral
 * /api/puzzles; staff routes (scoring, coding, exports) are /api/efa-admin.
 */
@Module({
  imports: [ActivityLogModule, CourseGatesModule],
  controllers: [PuzzlesController, EfaAdminController],
  providers: [
    EfaAllocationService,
    EfaOccasionService,
    EfaTaskRunService,
    EfaScoringService,
    EfaCodingService,
    EfaExportsService,
  ],
  exports: [EfaAllocationService, EfaOccasionService, EfaTaskRunService, EfaScoringService],
})
export class EfaModule {}
