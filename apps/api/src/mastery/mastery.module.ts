import { Module } from '@nestjs/common';
import { MasteryController } from './mastery.controller';
import { MasteryService } from './mastery.service';

@Module({
  controllers: [MasteryController],
  providers: [MasteryService],
  exports: [MasteryService],
})
export class MasteryModule {}
