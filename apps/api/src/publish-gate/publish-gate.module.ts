import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { PublishGateService } from './publish-gate.service';
import { PublishGateController } from './publish-gate.controller';

@Module({
  imports: [PrismaModule],
  controllers: [PublishGateController],
  providers: [PublishGateService],
  exports: [PublishGateService],
})
export class PublishGateModule {}
