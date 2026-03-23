import { Module } from '@nestjs/common';
import { PupilSizeController } from './pupil-size.controller';
import { PupilSizeService } from './pupil-size.service';

@Module({
  controllers: [PupilSizeController],
  providers: [PupilSizeService],
  exports: [PupilSizeService],
})
export class PupilSizeModule {}
