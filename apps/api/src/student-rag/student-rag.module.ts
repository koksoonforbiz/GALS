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
// Stage 04 — the local StudentRagRetrievalService instance needs the
// reranker services to resolve. RagModule exports them but Nest
// resolves provider deps per-module; we re-declare them here so the
// student-side instance can see its own copy. They're stateless
// (modulo Cohere's per-call context which is reset every invocation),
// so a separate Nest instance is safe — same rationale as
// `StudentRagRetrievalService` itself, per `rag.module.ts` comment.
import { NoopRerankerService } from '../rag/reranker/noop-reranker.service';
import { CohereRerankerService } from '../rag/reranker/cohere-reranker.service';
import { RERANKER_SERVICE } from '../rag/reranker/reranker.types';
import { rerankEnabled } from '../rag/reranker/reranker.flags';

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
    NoopRerankerService,
    CohereRerankerService,
    {
      provide: RERANKER_SERVICE,
      useFactory: (cohere: CohereRerankerService, noop: NoopRerankerService) =>
        rerankEnabled() ? cohere : noop,
      inject: [CohereRerankerService, NoopRerankerService],
    },
  ],
  exports: [StudentRagService, StudentRagRetrievalService],
})
export class StudentRagModule {}
