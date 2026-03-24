import { Module } from '@nestjs/common';
import { WebgazerController } from './webgazer.controller';
import { WebgazerService } from './webgazer.service';
import { ActivityLogModule } from '../activity-log';

@Module({
  imports: [ActivityLogModule],
  controllers: [WebgazerController],
  providers: [WebgazerService],
  exports: [WebgazerService],
})
export class WebgazerModule {}
