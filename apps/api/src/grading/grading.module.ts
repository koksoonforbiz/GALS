import { Module } from '@nestjs/common';
import { GradingController } from './grading.controller';
import { GradingGateway } from './grading.gateway';
import { GradeCompletedPoller } from './grade-completed.poller';
import { SeedController } from './seed.controller';

@Module({
  controllers: [GradingController, SeedController],
  providers: [GradingGateway, GradeCompletedPoller],
})
export class GradingModule {}
