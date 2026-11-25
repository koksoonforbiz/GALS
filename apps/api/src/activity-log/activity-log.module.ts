import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ActivityLogService } from './activity-log.service';
import { SessionService } from './session.service';
import { SessionTimeoutSweeper } from './session-timeout.sweeper';
import { LogExportService } from './log-export.service';
import { CaptureQualityService } from './capture-quality.service';
import { ActivityLogController } from './activity-log.controller';
import { LogsModule } from '../logs/logs.module';
import { GovernanceModule } from '../governance/governance.module';

@Module({
  imports: [ConfigModule, LogsModule, GovernanceModule],
  controllers: [ActivityLogController],
  providers: [
    ActivityLogService,
    SessionService,
    LogExportService,
    SessionTimeoutSweeper,
    CaptureQualityService,
  ],
  exports: [ActivityLogService, SessionService, CaptureQualityService],
})
export class ActivityLogModule {}
