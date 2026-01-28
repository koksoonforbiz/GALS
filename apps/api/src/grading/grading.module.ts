import { Module } from '@nestjs/common';
import { GradingGateway } from './grading.gateway';
import { GradeCompletedPoller } from './grade-completed.poller';
import { SeedController } from './seed.controller';

@Module({
  controllers: [SeedController],
  providers: [GradingGateway, GradeCompletedPoller],
  exports: [GradingGateway],
})
export class GradingModule {}
