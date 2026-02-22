import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { PrismaModule } from '../prisma';
import { BlobModule } from '../blob';
import { RagService } from './rag.service';
import { LlmService } from './llm.service';
import { AnthropicService } from './anthropic.service';
import { RagController } from './rag.controller';

@Module({
  imports: [
    PrismaModule,
    BlobModule,
    MulterModule.register({
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    }),
  ],
  controllers: [RagController],
  providers: [RagService, LlmService, AnthropicService],
  exports: [RagService, LlmService, AnthropicService],
})
export class RagModule {}
