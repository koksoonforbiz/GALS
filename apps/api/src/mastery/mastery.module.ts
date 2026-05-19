import { Module } from '@nestjs/common';
import { MasteryController } from './mastery.controller';
import { MasteryService } from './mastery.service';
import { ActivityLogModule } from '../activity-log';

@Module({
  imports: [ActivityLogModule],
  controllers: [MasteryController],
  providers: [MasteryService],
  exports: [MasteryService],
})
export class MasteryModule {}
