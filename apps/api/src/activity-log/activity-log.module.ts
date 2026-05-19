import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ActivityLogService } from './activity-log.service';
import { SessionService } from './session.service';
import { LogExportService } from './log-export.service';
import { ActivityLogController } from './activity-log.controller';
import { LogsModule } from '../logs/logs.module';

@Module({
  imports: [ConfigModule, LogsModule],
  controllers: [ActivityLogController],
  providers: [ActivityLogService, SessionService, LogExportService],
  exports: [ActivityLogService, SessionService],
})
export class ActivityLogModule {}
