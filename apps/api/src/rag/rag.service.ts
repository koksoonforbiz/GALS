import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  OnModuleInit,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BlobService } from '../blob/blob.service';
import { LlmService } from './llm.service';
import { SharedChunkingService } from './shared/chunking.service';
import {
  ContextualizeService,
  contextualRetrievalEnabled,
} from './shared/contextualize.service';
import { EmbeddingService } from '../student-rag/embedding.service';
import { StudentRagRetrievalService } from '../student-rag/student-rag-retrieval.service';
import { PdfRasterizerService } from './shared/pdf-rasterizer.service';
import { PageCaptionService } from './shared/page-caption.service';
import { multimodalPdfEnabled } from './shared/multimodal.flags';
import { Prisma } from '@prisma/client';
import { DialogueCourseSettingsSchema } from '@ats/shared';

// Stage 02 — shared-retriever feature flag (mirrors the one in
// dialogue / interventions). Default ON.
function sharedRetrieverEnabled(): boolean {
  const v = (process.env.RAG_USE_SHARED_RETRIEVER ?? 'true').toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'off';
}

// Stage 02 — feature flag for the teacher-embedding wire-up.
//
// `RAG_TEACHER_EMBEDDINGS=false` skips the embedding step during
// `chunkDocument` so the rollout can be reverted on a single env var
// flip. Default is `true` (both dev and prod) because the audit found
// that teacher chunks were never embedded — i.e. this is a bug fix, not
// a risky behaviour change. Documented in
// `docs/rag/AUDIT.md` Stage 02 section.
function teacherEmbeddingsEnabled(): boolean {
  const v = (process.env.RAG_TEACHER_EMBEDDINGS ?? 'true').toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'off';
}

const EMBEDDING_BATCH_SIZE = 50;

export interface ChunkWithScore {
  id: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  pageNumber: number | null;
  tokenCount: number;
  similarityScore: number;
  rerankerScore: number;
}

export interface RagQueryResult {
  query: string;
  retrievedChunks: ChunkWithScore[];
  finalChunks: ChunkWithScore[];
  answer: string | null;
  citations: Array<{
    chunkId: string;
    documentTitle: string;
    pageNumber: number | null;
    quote: string;
  }>;
  strictSourceValid: boolean;
  notEnoughInfo: boolean;
  debugInfo: {
    totalChunksSearched: number;
    retrievalTimeMs: number;
    rerankTimeMs: number;
    generationTimeMs: number;
  };
}

export interface DocumentProgress {
  status: string;
  pct: number;
  error?: string;
}

@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);
  /** In-memory progress tracking for document chunking */
  readonly progress = new Map<string, DocumentProgress>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly blobService: BlobService,
    @Inject(forwardRef(() => LlmService))
    private readonly llmService: LlmService,
    private readonly sharedChunking: SharedChunkingService,
    private readonly contextualizeService: ContextualizeService,
    private readonly embeddingService: EmbeddingService,
    private readonly sharedRetrieval: StudentRagRetrievalService,
    // Stage 05 — multimodal ingest. Both are no-cost to inject when
    // the feature flag is off (rasterizer is a singleton with a
    // lazy-loaded module; caption is a thin wrapper around the
    // funnel). When the flag flips on, `chunkDocument` calls them
    // for PDFs only.
    private readonly pdfRasterizer: PdfRasterizerService,
    private readonly pageCaption: PageCaptionService,
  ) {}

  async onModuleInit() {
    this.logger.log('[RAG v3] RagService initialising...');
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfParseModule = require('pdf-parse');
      const cls = pdfParseModule.PDFParse || pdfParseModule.default?.PDFParse;
      this.logger.log(`[RAG v3] pdf-parse probe: PDFParse=${typeof cls}`);
    } catch (err: any) {
      this.logger.warn(`[RAG v3] pdf-parse not found: ${err.message}`);
    }
  }

  /**
   * Load PDFParse class at call time via require().
   * This avoids any instance-caching issues with NestJS DI.
   */
  private loadPDFParse(): any {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('pdf-parse');
    const cls = mod.PDFParse || mod.default?.PDFParse;
    if (!cls) {
      throw new Error('pdf-parse module loaded but PDFParse class not found');
    }
    return cls;
  }

  // ─── Document Management ────────────────────────────────

  async uploadDocument(
    courseId: string,
    userId: string,
    file: { filename: string; mimeType: string; sizeBytes: number; buffer: Buffer },
  ) {
    // Verify course ownership
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException(`Course ${courseId} not found`);
    if (course.teacherId !== userId) {
      throw new ForbiddenException('Only the course teacher can upload documents');
    }

    const blobKey = `rag/${courseId}/${Date.now()}-${file.filename}`;
    await this.blobService.put({
      key: blobKey,
      body: file.buffer,
      contentType: file.mimeType,
    });

    const doc = await this.prisma.sourceDocument.create({
      data: {
        courseId,
        uploadedById: userId,
        title: file.filename.replace(/\.[^.]+$/, ''),
        filename: file.filename,
        blobKey,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      },
    });

    // Trigger chunking asynchronously (progress tracked in-memory)
    this.chunkDocument(doc.id).catch((err) => {
      this.logger.error(`Failed to chunk document ${doc.id}`, err);
    });

    return doc;
  }

  async listDocuments(courseId: string) {
    return this.prisma.sourceDocument.findMany({
      where: { courseId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        pageCount: true,
        chunkCount: true,
        chunkingStrategy: true,
        indexedAt: true,
        createdAt: true,
        uploadedBy: { select: { id: true, name: true } },
      },
    });
  }

  async deleteDocument(documentId: string, userId: string) {
    const doc = await this.prisma.sourceDocument.findUnique({
      where: { id: documentId },
      include: { course: { select: { teacherId: true } } },
    });
    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);
    if (doc.course.teacherId !== userId) {
      throw new ForbiddenException('Only the course teacher can delete documents');
    }

    // Best-effort: drop the cached file on OpenAI before local delete so
    // failures don't strand the row. Fire-and-forget; the delete helper
    // logs but never throws.
    if (doc.openaiFileId) {
      void this.llmService.deleteFileFromOpenAi(doc.uploadedById, doc.openaiFileId);
    }

    await this.blobService.delete(doc.blobKey);
    await this.prisma.sourceDocument.delete({ where: { id: documentId } });
    return { deleted: true };
  }

  // ─── Chunking ───────────────────────────────────────────

  private setProgress(documentId: string, status: string, pct: number, error?: string) {
    this.progress.set(documentId, { status, pct, error });
  }

  async chunkDocument(documentId: string) {
    const doc = await this.prisma.sourceDocument.findUnique({
      where: { id: documentId },
      include: { course: { select: { teacherId: true, dblSettings: true } } },
    });
    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);

    this.setProgress(documentId, 'Starting', 5);

    // Clear previous state
    await this.prisma.sourceDocument.update({
      where: { id: documentId },
      data: { indexedAt: null },
    });

    try {
      // Step 1: Download (10%)
      this.setProgress(documentId, 'Downloading file', 10);
      this.logger.log(`Downloading blob for document ${documentId}: ${doc.blobKey}`);
      const { body } = await this.blobService.get(doc.blobKey);
      this.logger.log(`Downloaded ${body.length} bytes, mimeType=${doc.mimeType}`);

      // Step 2: Extract text (30-50%)
      this.setProgress(documentId, 'Extracting text', 30);
      const { text, pageCount } = await this.extractText(body, doc.mimeType);
      this.logger.log(`Extracted text: ${text.length} chars, ${pageCount} pages`);
      this.setProgress(documentId, 'Text extracted', 50);

      if (!text || text.trim().length === 0) {
        throw new Error('No text could be extracted from the document');
      }

      // Step 3: Chunk via the SHARED chunker (Stage 02). The old
      // `splitByFixedSize` / `splitByParagraph` paths are deleted; we
      // now use the same recursive paragraph/heading/sentence-aware
      // splitter the student corpus uses.
      this.setProgress(documentId, 'Splitting into chunks', 60);
      const chunks = this.sharedChunking.chunkDocumentWithPages(text, {
        strategy: 'auto',
        mimeType: doc.mimeType,
        filename: doc.filename,
      });
      this.logger.log(`Split into ${chunks.length} chunks (shared chunker)`);

      // Step 4: Save chunks (75%)
      this.setProgress(documentId, `Saving ${chunks.length} chunks`, 75);
      await this.prisma.documentChunk.deleteMany({ where: { documentId } });

      const chunkRecords = chunks.map((chunk, index) => ({
        documentId,
        chunkIndex: index,
        content: chunk.content,
        pageNumber: chunk.pageNumber,
        tokenCount: this.estimateTokenCount(chunk.content),
      }));

      await this.prisma.documentChunk.createMany({ data: chunkRecords });
      this.setProgress(documentId, 'Finalising', 90);

      // Step 4b: Contextualise chunks (Stage 03 — Anthropic Contextual
      // Retrieval). Generates a 50-100 token doc-aware blurb per
      // chunk; persists on `contextual_text`. The blurb is then
      // PREPENDED to the chunk content for the embedding call below,
      // so the vector captures the chunk's place in the doc, not just
      // its raw content. Gated by `RAG_CONTEXTUAL_RETRIEVAL` env
      // flag + `DialogueCourseSettings.contextualRetrieval` per-course
      // override. When disabled OR a chunk's blurb fails (returns
      // empty), ingest is identical to Stage 02 — bare chunk text is
      // embedded.
      let textsForEmbedding: Map<string, string> | null = null;
      const perCourseCtx = this.parseContextualRetrievalOverride(doc.course.dblSettings);
      if (contextualRetrievalEnabled(perCourseCtx) && chunks.length > 0) {
        this.setProgress(documentId, 'Contextualising chunks', 82);
        textsForEmbedding = new Map();
        const teacherId = doc.course.teacherId;
        const created = await this.prisma.documentChunk.findMany({
          where: { documentId },
          orderBy: { chunkIndex: 'asc' },
          select: { id: true, content: true },
        });
        for (const chunk of created) {
          // Triple-defensive at the per-chunk level: the service
          // itself returns '' on failure, but wrap the call so a
          // surprise throw (DI / network blip) does not abort
          // ingest.
          let blurb = '';
          try {
            blurb = await this.contextualizeService.contextualizeChunk(
              text,
              chunk.content,
              {
                teacherId,
                documentTitle: doc.title,
                usageContext: {
                  feature: 'rag.contextualize.teacher',
                  courseId: doc.courseId,
                  triggeredByUserId: doc.uploadedById,
                },
              },
            );
          } catch (err) {
            this.logger.warn(
              `Contextualize threw for chunk ${chunk.id}: ${(err as Error).message}`,
            );
            blurb = '';
          }
          if (blurb) {
            try {
              await this.prisma.documentChunk.update({
                where: { id: chunk.id },
                data: { contextualText: blurb },
              });
              textsForEmbedding.set(chunk.id, `${blurb}\n\n${chunk.content}`);
            } catch (err) {
              this.logger.warn(
                `Persisting contextualText for ${chunk.id} failed: ${(err as Error).message}`,
              );
              // Fall back to bare-text embedding for this chunk.
              textsForEmbedding.set(chunk.id, chunk.content);
            }
          } else {
            // Empty blurb → embed bare text. Identical to Stage 02
            // behaviour for this chunk.
            textsForEmbedding.set(chunk.id, chunk.content);
          }
        }
      }

      // Step 5a: Embed chunks via the registry-driven funnel (Stage 02
      // Task B — closes the audit gap where teacher chunks had no
      // embeddings). Gated by `RAG_TEACHER_EMBEDDINGS` so the rollout
      // can be flipped off without redeploying. Failure of an
      // individual batch does NOT abort ingest — the chunks remain
      // text-only and the retriever's keyword-fallback path serves
      // them.
      //
      // Stage 03 — when `textsForEmbedding` is populated (Contextual
      // Retrieval enabled + contextualised), embed
      // `contextualText\n\ncontent`; otherwise embed bare `content`.
      let pinnedModel: string | null = null;
      let pinnedDim: number | null = null;
      if (teacherEmbeddingsEnabled() && chunks.length > 0) {
        this.setProgress(documentId, 'Embedding chunks', 85);
        const teacherId = doc.course.teacherId;
        const created = await this.prisma.documentChunk.findMany({
          where: { documentId },
          orderBy: { chunkIndex: 'asc' },
          select: { id: true, content: true },
        });
        for (let i = 0; i < created.length; i += EMBEDDING_BATCH_SIZE) {
          const batch = created.slice(i, i + EMBEDDING_BATCH_SIZE);
          try {
            const texts = batch.map(
              (c) => textsForEmbedding?.get(c.id) ?? c.content,
            );
            const result = await this.embeddingService.callEmbeddingForUser(
              teacherId,
              texts,
            );
            pinnedModel = result.model;
            pinnedDim = result.dimensions;
            // Tag pseudo-embedding rows distinctly so the
            // retriever can surface `degradedRetrieval` without
            // re-resolving the funnel state. The funnel returns
            // `provider: 'fallback'` in both the no-key path AND
            // the post-error degradation path.
            const stampedModel =
              result.provider === 'fallback' ? 'sha256-pseudo' : result.model;
            await Promise.all(
              batch.map((chunk, idx) =>
                this.prisma.documentChunk.update({
                  where: { id: chunk.id },
                  data: {
                    embedding: result.vectors[idx] as unknown as Prisma.InputJsonValue,
                    embeddingModel: stampedModel,
                    embeddingDimensions: result.dimensions,
                  },
                }),
              ),
            );
          } catch (err) {
            // Triple-defensive: one failed batch must not abort
            // ingest. The chunks stay without an embedding column;
            // retrieval transparently falls back to keyword search
            // for them via the per-chunk pin check.
            this.logger.warn(
              `Teacher embed batch ${i}-${i + batch.length} failed for doc ${documentId}: ${(err as Error).message}`,
            );
          }
        }
      }

      // Step 5b: Done (100%)
      await this.prisma.sourceDocument.update({
        where: { id: documentId },
        data: {
          chunkCount: chunks.length,
          pageCount: pageCount,
          indexedAt: new Date(),
          embeddingModel: pinnedModel,
          embeddingDimensions: pinnedDim,
          needsReembed: false,
        },
      });

      this.setProgress(documentId, 'Done', 100);
      this.logger.log(
        `Chunked document ${documentId} into ${chunks.length} chunks (model=${pinnedModel ?? 'none'} dim=${pinnedDim ?? 'none'})`,
      );

      // Step 6 (best-effort): cache the original PDF on OpenAI's Files API so
      // page-content generation can reference it by id later instead of
      // re-uploading megabytes of base64 on every call. Skipped silently for
      // non-PDFs, missing API key, non-OpenAI providers, or upload failure —
      // the page-content generator transparently falls back to inline bytes.
      if (doc.mimeType === 'application/pdf') {
        const fileId = await this.llmService.uploadFileToOpenAi(
          doc.uploadedById,
          doc.filename,
          body,
          doc.mimeType,
        );
        if (fileId) {
          await this.prisma.sourceDocument.update({
            where: { id: documentId },
            data: { openaiFileId: fileId, openaiFileUploadedAt: new Date() },
          });
          this.logger.log(`Cached document ${documentId} on OpenAI Files API as ${fileId}`);
        }
      }

      // Step 7 (Stage 05): Multimodal page-image ingest. Runs only when
      // `RAG_MULTIMODAL_PDF` is on (or the per-course override forces
      // it on), and only for PDFs. Triple-defensive — any failure
      // (rasterize, embed, caption, upload) logs + continues; the
      // text chunks above are already persisted, so the doc remains
      // queryable with text-only retrieval.
      const perCourseMm = this.parseMultimodalPdfOverride(doc.course.dblSettings);
      if (multimodalPdfEnabled(perCourseMm) && doc.mimeType === 'application/pdf') {
        try {
          this.setProgress(documentId, 'Rasterizing pages', 92);
          const imageChunks = await this.ingestPdfPageImages({
            buffer: body,
            documentId,
            teacherId: doc.course.teacherId,
            courseId: doc.courseId,
            ownerId: doc.uploadedById,
            existingTextChunkCount: chunks.length,
          });
          this.logger.log(
            `Multimodal ingest: persisted ${imageChunks} page_image chunks for doc ${documentId}`,
          );
        } catch (err) {
          // Top-level guard — the helper itself is already defensive
          // but we wrap once more so a surprise throw never aborts
          // ingest after text chunks have been persisted.
          this.logger.warn(
            `Multimodal ingest failed for ${documentId}: ${(err as Error).message}`,
          );
        }
      }

      return { chunkCount: chunks.length };
    } catch (err: any) {
      const errorMsg = err?.message || 'Unknown error during chunking';
      this.logger.error(`Chunking failed for document ${documentId}: ${errorMsg}`, err?.stack);
      this.setProgress(documentId, 'Failed', 0, errorMsg);
      throw err;
    }
  }

  private async extractText(
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ text: string; pageCount: number | null }> {
    if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
      return { text: buffer.toString('utf-8'), pageCount: null };
    }

    if (mimeType === 'application/pdf') {
      try {
        const PDFParseClass = this.loadPDFParse();
        this.logger.log(`[RAG v3] Parsing PDF buffer (${buffer.length} bytes)...`);
        const pdfData = new Uint8Array(buffer);
        const pdf = new PDFParseClass({ data: pdfData });
        const textResult = await pdf.getText();
        const pageCount = textResult.total || null;
        const text = textResult.text;
        await pdf.destroy();
        this.logger.log(`[RAG v3] Extracted ${text.length} chars from PDF (${pageCount} pages)`);
        return { text, pageCount };
      } catch (err) {
        this.logger.error('[RAG v3] PDF extraction error:', err);
        throw new Error(
          `PDF text extraction failed: ${(err as Error)?.message || 'Unknown error'}`,
        );
      }
    }

    // Fallback for other formats
    return { text: buffer.toString('utf-8'), pageCount: null };
  }

  // Stage 02: removed `splitIntoChunks`, `splitByParagraph`, and
  // `splitByFixedSize`. The teacher ingest path now uses the unified
  // `SharedChunkingService` (see `chunkDocument` above). The Prisma
  // `chunkingStrategy` column is still on `source_documents` for
  // backward-compatibility / future per-course tuning but is no longer
  // consulted by ingest — the shared chunker resolves boundary
  // heuristics from MIME / filename.

  private estimateTokenCount(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  /**
   * Stage 03 — Parse the per-course `contextualRetrieval` override from
   * `Course.dblSettings`. Returns:
   *   - `true`  → force Contextual Retrieval ON for this course
   *   - `false` → force Contextual Retrieval OFF for this course
   *   - `null`  → fall back to the `RAG_CONTEXTUAL_RETRIEVAL` env flag.
   * Defensive: any parse error / missing field → null (defer to env).
   */
  private parseContextualRetrievalOverride(raw: unknown): boolean | null {
    try {
      const parsed = DialogueCourseSettingsSchema.safeParse(raw || {});
      if (!parsed.success) return null;
      const v = parsed.data.contextualRetrieval;
      return v === true || v === false ? v : null;
    } catch {
      return null;
    }
  }

  /**
   * Stage 05 — Per-course `multimodalPdf` override. Same shape as the
   * Stage 03 override above. Defer to `RAG_MULTIMODAL_PDF` env flag
   * when null.
   */
  private parseMultimodalPdfOverride(raw: unknown): boolean | null {
    try {
      const parsed = DialogueCourseSettingsSchema.safeParse(raw || {});
      if (!parsed.success) return null;
      const v = parsed.data.multimodalPdf;
      return v === true || v === false ? v : null;
    } catch {
      return null;
    }
  }

  /**
   * Stage 05 — Multimodal page-image ingest. Rasterizes a PDF buffer,
   * uploads each page PNG to MinIO, embeds via the Cohere multimodal
   * funnel, captions via the chat VLM funnel, and inserts a
   * `chunk_kind = 'page_image'` row per page. Returns the count of
   * persisted chunks.
   *
   * Triple-defensive at every step:
   *   - rasterize failure → empty page list, 0 chunks persisted.
   *   - upload failure for a single page → skip that page, continue.
   *   - embed failure → skip persisting (no embedding means it can't
   *     be retrieved anyway).
   *   - caption failure → empty caption, image chunk still persisted
   *     (still retrievable via dense scan).
   */
  /**
   * Stage 05 — Public entry point for the multimodal backfill script.
   * Re-uses the same ingest helper as live `chunkDocument`. Idempotent
   * (skips docs whose first page_image already exists). Returns the
   * count of newly persisted `page_image` chunks. Never throws.
   */
  async backfillTeacherMultimodal(documentId: string): Promise<number> {
    const doc = await this.prisma.sourceDocument.findUnique({
      where: { id: documentId },
      include: { course: { select: { teacherId: true } } },
    });
    if (!doc || doc.mimeType !== 'application/pdf') return 0;
    try {
      const { body } = await this.blobService.get(doc.blobKey);
      const existingText = await this.prisma.documentChunk.count({
        where: { documentId, OR: [{ chunkKind: null }, { chunkKind: 'text' }] },
      });
      return await this.ingestPdfPageImages({
        buffer: body,
        documentId,
        teacherId: doc.course.teacherId,
        courseId: doc.courseId,
        ownerId: doc.uploadedById,
        existingTextChunkCount: existingText,
      });
    } catch (err) {
      this.logger.warn(
        `backfillTeacherMultimodal(${documentId}) failed: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  private async ingestPdfPageImages(args: {
    buffer: Buffer;
    documentId: string;
    teacherId: string;
    courseId: string;
    ownerId: string;
    existingTextChunkCount: number;
  }): Promise<number> {
    const pages = await this.pdfRasterizer.rasterizePdf(args.buffer);
    if (pages.length === 0) return 0;

    // Idempotency guard — if any page_image chunks already exist for
    // this doc (e.g. backfill ran), skip ingest to avoid duplicates.
    const existingImage = await this.prisma.documentChunk.findFirst({
      where: { documentId: args.documentId, chunkKind: 'page_image' },
      select: { id: true },
    });
    if (existingImage) {
      this.logger.log(
        `Multimodal ingest: doc ${args.documentId} already has page_image chunks; skipping`,
      );
      return 0;
    }

    // 1. Upload PNG blobs in parallel. Failures are per-page; we
    // collect the keys we got and move on.
    const uploads = await Promise.all(
      pages.map(async (page) => {
        const key = `teacher-docs/${args.ownerId}/${args.courseId}/${args.documentId}/pages/${page.pageNumber}.png`;
        try {
          await this.blobService.put({
            key,
            body: page.pngBuffer,
            contentType: 'image/png',
          });
          return { ...page, imageObjectKey: key };
        } catch (err) {
          this.logger.warn(
            `[multimodal] PNG upload failed for page ${page.pageNumber}: ${(err as Error).message}`,
          );
          return null;
        }
      }),
    );
    const uploaded = uploads.filter(
      (u): u is NonNullable<typeof u> => u !== null,
    );
    if (uploaded.length === 0) return 0;

    // 2. Embed images via the multimodal funnel.
    const embedResult = await this.embeddingService.callMultimodalEmbedding(
      args.teacherId,
      uploaded.map((u) => ({
        kind: 'image' as const,
        bytes: u.pngBuffer,
        mimeType: 'image/png' as const,
      })),
    );

    // 3. Caption + persist per page. Caption is best-effort.
    let persisted = 0;
    for (let i = 0; i < uploaded.length; i++) {
      const page = uploaded[i]!;
      const vector = embedResult.vectors[i];
      if (!vector) {
        this.logger.warn(
          `[multimodal] No embedding for page ${page.pageNumber}; skipping chunk persist`,
        );
        continue;
      }

      const caption = await this.pageCaption.captionPageImage(
        page.pngBuffer,
        'image/png',
        {
          teacherId: args.teacherId,
          courseId: args.courseId,
          pageNumber: page.pageNumber,
        },
      );

      try {
        await this.prisma.documentChunk.create({
          data: {
            documentId: args.documentId,
            // Sequential index after the text chunks so the unique
            // (documentId, chunkIndex) constraint holds.
            chunkIndex: args.existingTextChunkCount + i,
            content: caption
              ? `[Page ${page.pageNumber} image] ${caption}`
              : `[Page ${page.pageNumber} image]`,
            pageNumber: page.pageNumber,
            tokenCount: Math.max(1, Math.ceil((caption?.length ?? 0) / 4)),
            embedding: vector as unknown as Prisma.InputJsonValue,
            embeddingModel: embedResult.model,
            embeddingDimensions: embedResult.dimensions,
            chunkKind: 'page_image',
            imageObjectKey: page.imageObjectKey,
            caption: caption || null,
          },
        });
        persisted += 1;
      } catch (err) {
        this.logger.warn(
          `[multimodal] persist failed for page ${page.pageNumber}: ${(err as Error).message}`,
        );
      }
    }
    return persisted;
  }

  // ─── Retrieval ──────────────────────────────────────────

  async queryChunks(courseId: string, query: string, topK: number = 10): Promise<ChunkWithScore[]> {
    return this.queryChunksFiltered(courseId, query, [], topK);
  }

  /**
   * Query chunks, optionally filtered by source document IDs.
   *
   * Stage 02: prefers the shared hybrid retriever
   * (`StudentRagRetrievalService.retrieveTeacher`) for any course with
   * ≥1 embedded chunk. Falls back to the legacy keyword scorer when:
   *   - `RAG_USE_SHARED_RETRIEVER=false`, OR
   *   - the corpus has no embeddings (legacy teacher chunks pre-Task-B,
   *     or prod with the pseudo-fallback gated off and no LLM key).
   */
  async queryChunksFiltered(
    courseId: string,
    query: string,
    sourceIds: string[],
    topK: number = 10,
  ): Promise<ChunkWithScore[]> {
    const startTime = Date.now();

    if (sharedRetrieverEnabled()) {
      try {
        // Quick check: does the corpus have any embeddings?
        const filter: Prisma.DocumentChunkWhereInput = {
          document: { courseId },
          embedding: { not: Prisma.JsonNull },
        };
        if (sourceIds.length > 0) filter.documentId = { in: sourceIds };
        const haveEmbed = await this.prisma.documentChunk.findFirst({
          where: filter,
          select: { id: true },
        });
        if (haveEmbed) {
          const course = await this.prisma.course.findUnique({
            where: { id: courseId },
            select: { teacherId: true },
          });
          if (course) {
            const creds = await this.embeddingService.resolveTeacherEmbeddingSpec(
              course.teacherId,
            );
            const apiKey = creds.apiKey ?? '';
            const provider = creds.provider;
            const out = await this.sharedRetrieval.retrieveTeacher(
              query,
              courseId,
              sourceIds.length > 0 ? sourceIds : null,
              topK,
              course.teacherId,
              apiKey,
              provider,
            );
            if (out.chunks.length > 0) {
              if (out.meta.degradedRetrieval || out.meta.mixedIndexChunkCount > 0) {
                this.logger.warn(
                  `teacher.queryChunks: degraded=${out.meta.degradedRetrieval} mixed=${out.meta.mixedIndexChunkCount}`,
                );
              }
              const elapsed = Date.now() - startTime;
              this.logger.debug(
                `RAG shared query for course ${courseId} took ${elapsed}ms, found ${out.chunks.length} chunks`,
              );
              // Map RetrievedChunk shape → legacy ChunkWithScore shape.
              return out.chunks.map((c) => ({
                id: c.chunkId,
                documentId: c.documentId,
                documentTitle: c.documentName,
                chunkIndex: 0,
                content: c.content,
                pageNumber: c.pageNumber,
                tokenCount: Math.ceil(c.content.length / 4),
                similarityScore: c.score,
                rerankerScore: c.score,
              }));
            }
          }
        }
      } catch (err) {
        this.logger.warn(
          `Shared retriever failed in teacher RAG; falling back to keyword: ${(err as Error).message}`,
        );
      }
    }

    // ── Legacy keyword path (preserved for fallback) ──
    return this.queryChunksKeywordLegacy(courseId, query, sourceIds, topK, startTime);
  }

  private async queryChunksKeywordLegacy(
    courseId: string,
    query: string,
    sourceIds: string[],
    topK: number,
    startTime: number,
  ): Promise<ChunkWithScore[]> {
    const where: any = { document: { courseId } };
    if (sourceIds.length > 0) {
      where.document.id = { in: sourceIds };
    }

    const chunks = await this.prisma.documentChunk.findMany({
      where,
      include: {
        document: { select: { id: true, title: true } },
      },
    });

    if (chunks.length === 0) return [];

    // Stage 03 — keyword scoring runs over `contextualText + content`
    // so context-only hits surface in the legacy fallback too.
    // Generator-facing `content` is unchanged.
    const scored: ChunkWithScore[] = chunks.map((chunk: any) => ({
      id: chunk.id,
      documentId: chunk.document.id,
      documentTitle: chunk.document.title,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      pageNumber: chunk.pageNumber,
      tokenCount: chunk.tokenCount,
      similarityScore: this.computeKeywordScore(
        query,
        `${chunk.contextualText ?? ''} ${chunk.content}`,
      ),
      rerankerScore: 0,
    }));

    scored.sort((a, b) => b.similarityScore - a.similarityScore);
    const topChunks = scored.slice(0, topK);

    for (const chunk of topChunks) {
      chunk.rerankerScore = this.computeRerankerScore(query, chunk.content);
    }

    topChunks.sort((a, b) => b.rerankerScore - a.rerankerScore);

    const elapsed = Date.now() - startTime;
    this.logger.log(
      `Keyword-fallback teacher RAG: ${chunks.length} chunks from ${sourceIds.length} sources, returned ${topChunks.length} (${elapsed}ms)`,
    );

    return topChunks;
  }

  private computeKeywordScore(query: string, content: string): number {
    const queryTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);
    const contentLower = content.toLowerCase();
    if (queryTerms.length === 0) return 0;

    let matchCount = 0;
    for (const term of queryTerms) {
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = contentLower.match(regex);
      if (matches) matchCount += matches.length;
    }

    // Normalize by query terms and content length
    const termCoverage =
      queryTerms.filter((t) => contentLower.includes(t)).length / queryTerms.length;
    const density = matchCount / (content.length / 100);

    return termCoverage * 0.6 + Math.min(density, 1) * 0.4;
  }

  private computeRerankerScore(query: string, content: string): number {
    // Simulated cross-encoder reranker
    // Combines keyword overlap, position bias, and length normalization
    const keywordScore = this.computeKeywordScore(query, content);

    // Bonus for exact phrase matches
    const queryLower = query.toLowerCase();
    const contentLower = content.toLowerCase();
    const phraseBonus = contentLower.includes(queryLower) ? 0.3 : 0;

    // Length penalty for very short or very long chunks
    const idealLength = 500;
    const lengthRatio = Math.min(content.length, idealLength * 2) / idealLength;
    const lengthScore = lengthRatio > 1 ? 1 / lengthRatio : lengthRatio;

    return keywordScore * 0.5 + phraseBonus + lengthScore * 0.2;
  }

  // ─── Citation Validation (Strict-Source Mode) ───────────

  validateCitations(
    contentMdx: string,
    citations: Array<{
      chunkId: string;
      documentTitle: string;
      pageNumber: number | null;
      quote: string;
    }>,
    chunks: ChunkWithScore[],
  ): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Split content into paragraphs
    const paragraphs = contentMdx.split(/\n\s*\n/).filter((p) => p.trim().length > 20);

    // Check each paragraph has at least one citation reference
    const citationPattern = /\[(\d+)\]/g;
    for (let i = 0; i < paragraphs.length; i++) {
      const matches = paragraphs[i]!.match(citationPattern);
      if (!matches) {
        issues.push(`Paragraph ${i + 1} has no citation references`);
      }
    }

    // Verify each citation maps to a real chunk
    for (const citation of citations) {
      const chunk = chunks.find((c) => c.id === citation.chunkId);
      if (!chunk) {
        issues.push(
          `Citation references chunk ${citation.chunkId} which was not in retrieved chunks`,
        );
      } else if (citation.quote) {
        // Verify the quote actually appears in the chunk
        if (!chunk.content.toLowerCase().includes(citation.quote.toLowerCase().slice(0, 50))) {
          issues.push(`Citation quote from "${citation.documentTitle}" not found in source chunk`);
        }
      }
    }

    return { valid: issues.length === 0, issues };
  }
}
