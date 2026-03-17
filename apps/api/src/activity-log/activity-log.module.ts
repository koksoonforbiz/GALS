import { Module } from '@nestjs/common';
import { ActivityLogService } from './activity-log.service';
import { SessionService } from './session.service';
import { ActivityLogController } from './activity-log.controller';

@Module({
  controllers: [ActivityLogController],
  providers: [ActivityLogService, SessionService],
  exports: [ActivityLogService, SessionService],
})
export class ActivityLogModule {}
