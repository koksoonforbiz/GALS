import { Module } from '@nestjs/common';
import { PyfeatController } from './pyfeat.controller';
import { PyfeatService } from './pyfeat.service';
import { ActivityLogModule } from '../activity-log';

@Module({
  imports: [ActivityLogModule],
  controllers: [PyfeatController],
  providers: [PyfeatService],
  exports: [PyfeatService],
})
export class PyfeatModule {}
