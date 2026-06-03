import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { PrismaModule } from '../prisma';
import { BlobModule } from '../blob';
import { RagService } from './rag.service';
import { LlmService } from './llm.service';
import { RagController } from './rag.controller';
import { SharedChunkingService } from './shared/chunking.service';
import { ContextualizeService } from './shared/contextualize.service';
import { PdfRasterizerService } from './shared/pdf-rasterizer.service';
import { PageCaptionService } from './shared/page-caption.service';
import { GroundedEvidenceService } from './shared/grounded-evidence.service';
import { FaithfulnessCheckService } from './shared/faithfulness-check.service';
import { EmbeddingService } from '../student-rag/embedding.service';
import { StudentRagRetrievalService } from '../student-rag/student-rag-retrieval.service';
import { CohereRerankerService } from './reranker/cohere-reranker.service';
import { NoopRerankerService } from './reranker/noop-reranker.service';
import { RERANKER_SERVICE } from './reranker/reranker.types';
import { rerankEnabled } from './reranker/reranker.flags';

@Module({
  imports: [
    PrismaModule,
    BlobModule,
    MulterModule.register({
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    }),
  ],
  controllers: [RagController],
  // Stage 02: `SharedChunkingService` is exposed from RagModule so both the
  // teacher ingest path (this module) and the student ingest path
  // (`StudentRagModule`) can resolve the same instance via the
  // `RagModule` import. `EmbeddingService` + `StudentRagRetrievalService`
  // are also provided here (the teacher ingest path now calls them
  // — see `RagService.chunkDocument` and `RagService.queryChunks`); we
  // don't import StudentRagModule because that would create a
  // forwardRef cycle (StudentRagModule already imports RagModule for
  // `LlmService`). The services are stateless so having a separate
  // Nest-instance per module is safe.
  //
  // Stage 04: `NoopRerankerService` + `CohereRerankerService` are
  // registered here too. The shared retriever picks the
  // implementation per-call by inspecting `RAG_RERANK` + the
  // teacher's Cohere key — so we expose BOTH concrete services AND
  // the `RERANKER_SERVICE` token (bound to the flag's choice at
  // boot). Stage 03's StudentRagRetrievalService now also depends
  // on these (constructor params), so they need to be in the same
  // module for resolution.
  providers: [
    RagService,
    LlmService,
    SharedChunkingService,
    ContextualizeService,
    EmbeddingService,
    StudentRagRetrievalService,
    NoopRerankerService,
    CohereRerankerService,
    // Stage 05 — multimodal ingest services. Stateless; safe to
    // share. Re-exported so StudentRagModule (which imports
    // RagModule) can pick them up without re-declaring.
    PdfRasterizerService,
    PageCaptionService,
    // Stage 06 — Grounded evidence + faithfulness check. These
    // are stateless services consumed by dialogue / chat /
    // interventions. Exported so the dispatch surfaces (in other
    // modules) can resolve them through the existing RagModule
    // import.
    GroundedEvidenceService,
    FaithfulnessCheckService,
    {
      provide: RERANKER_SERVICE,
      useFactory: (cohere: CohereRerankerService, noop: NoopRerankerService) =>
        rerankEnabled() ? cohere : noop,
      inject: [CohereRerankerService, NoopRerankerService],
    },
  ],
  exports: [
    RagService,
    LlmService,
    SharedChunkingService,
    ContextualizeService,
    EmbeddingService,
    StudentRagRetrievalService,
    NoopRerankerService,
    CohereRerankerService,
    PdfRasterizerService,
    PageCaptionService,
    GroundedEvidenceService,
    FaithfulnessCheckService,
    RERANKER_SERVICE,
  ],
})
export class RagModule {}
