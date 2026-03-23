import { Module } from '@nestjs/common';
import { PyfeatController } from './pyfeat.controller';
import { PyfeatService } from './pyfeat.service';

@Module({
  controllers: [PyfeatController],
  providers: [PyfeatService],
  exports: [PyfeatService],
})
export class PyfeatModule {}
