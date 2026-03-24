import { Module } from '@nestjs/common';
import { WebgazerController } from './webgazer.controller';
import { WebgazerService } from './webgazer.service';

@Module({
  controllers: [WebgazerController],
  providers: [WebgazerService],
  exports: [WebgazerService],
})
export class WebgazerModule {}
