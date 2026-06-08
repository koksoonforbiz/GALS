import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { RagModule } from '../rag';
import { VlmService } from './vlm.service';
import { VlmController } from './vlm.controller';

@Module({
  imports: [PrismaModule, RagModule],
  controllers: [VlmController],
  providers: [VlmService],
  exports: [VlmService],
})
export class VlmModule {}
