import { Module } from '@nestjs/common';
import { PupilSizeController } from './pupil-size.controller';
import { PupilSizeService } from './pupil-size.service';
import { ActivityLogModule } from '../activity-log';

@Module({
  imports: [ActivityLogModule],
  controllers: [PupilSizeController],
  providers: [PupilSizeService],
  exports: [PupilSizeService],
})
export class PupilSizeModule {}
