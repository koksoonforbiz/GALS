import { Module } from '@nestjs/common';
import { AttemptsController } from './attempts.controller';
import { AttemptsService } from './attempts.service';
import { MasteryModule } from '../mastery';
import { ActivityLogModule } from '../activity-log';

@Module({
  imports: [MasteryModule, ActivityLogModule],
  controllers: [AttemptsController],
  providers: [AttemptsService],
  exports: [AttemptsService],
})
export class AttemptsModule {}
