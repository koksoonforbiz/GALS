import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { ReplayAnnotationsController } from './replay-annotations.controller';
import { ReplayAnnotationsService } from './replay-annotations.service';

@Module({
  imports: [PrismaModule],
  controllers: [ReplayAnnotationsController],
  providers: [ReplayAnnotationsService],
  exports: [ReplayAnnotationsService],
})
export class ReplayAnnotationsModule {}
