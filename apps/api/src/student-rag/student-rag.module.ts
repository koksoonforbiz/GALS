import { Module, forwardRef } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from '../prisma';
import { BlobModule } from '../blob';
import { RagModule } from '../rag';
import { DialogueModule } from '../dialogue/dialogue.module';
import { StudentRagController } from './student-rag.controller';
import { StudentRagService } from './student-rag.service';
import { StudentRagRetrievalService } from './student-rag-retrieval.service';
import { StudentSourceGuideService } from './student-source-guide.service';
import { FileParserService } from './file-parser.service';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';

@Module({
  imports: [
    PrismaModule,
    BlobModule,
    RagModule, // provides LlmService
    forwardRef(() => DialogueModule), // provides DialogueGateway for processing_update emits
    EventEmitterModule.forRoot(),
    MulterModule.register({
      limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max (enforced per-course in controller)
    }),
  ],
  controllers: [StudentRagController],
  providers: [
    StudentRagService,
    StudentRagRetrievalService,
    StudentSourceGuideService,
    FileParserService,
    ChunkingService,
    EmbeddingService,
  ],
  exports: [StudentRagService, StudentRagRetrievalService],
})
export class StudentRagModule {}
