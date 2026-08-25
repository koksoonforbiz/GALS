import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  forwardRef,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { BlobService } from '../blob/blob.service';
import { LlmService } from '../rag/llm.service';
import { DialogueGateway } from '../dialogue/dialogue.gateway';
import { FileParserService } from './file-parser.service';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import {
  ContextualizeService,
  contextualRetrievalEnabled,
} from '../rag/shared/contextualize.service';
import { PdfRasterizerService } from '../rag/shared/pdf-rasterizer.service';
import { PageCaptionService } from '../rag/shared/page-caption.service';
import { multimodalPdfEnabled } from '../rag/shared/multimodal.flags';
import { StudentFileType, Prisma } from '@prisma/client';
import { DialogueCourseSettingsSchema } from '@ats/shared';

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const MIME_TO_FILE_TYPE: Record<string, StudentFileType> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'text/plain': 'TXT',
  'text/markdown': 'MD',
  'image/png': 'IMAGE_PNG',
  'image/jpeg': 'IMAGE_JPG',
  'image/webp': 'IMAGE_WEBP',
};

const EMBEDDING_BATCH_SIZE = 50;

@Injectable()
export class StudentRagService {
  private readonly logger = new Logger(StudentRagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blobService: BlobService,
    private readonly llmService: LlmService,
    private readonly fileParser: FileParserService,
    private readonly chunkingService: ChunkingService,
    private readonly embeddingService: EmbeddingService,
    private readonly contextualizeService: ContextualizeService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => DialogueGateway))
    private readonly dialogueGateway: DialogueGateway,
    // Stage 05 — multimodal ingest (gated by `RAG_MULTIMODAL_PDF`).
    private readonly pdfRasterizer: PdfRasterizerService,
    private readonly pageCaption: PageCaptionService,
  ) {}

  // ─── Upload & create document record ────────────────────

  async uploadDocument(
    enrollmentId: string,
    studentId: string,
    courseId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    sessionId?: string,
  ) {
    // Determine file type
    const fileType = this.resolveFileType(file.mimetype, file.originalname);

    // Store file to MinIO
    const blobKey = `student-docs/${studentId}/${courseId}/${Date.now()}-${file.originalname}`;
    await this.blobService.put({
      key: blobKey,
      body: file.buffer,
      contentType: file.mimetype,
    });

    // Create DB record. If this fails, the MinIO object would otherwise be
    // orphaned (uploaded but never referenced by any row) — roll it back.
    let document;
    try {
      document = await this.prisma.studentSourceDocument.create({
        data: {
          enrollmentId,
          studentId,
          courseId,
          sessionId: sessionId || null,
          fileName: file.originalname,
          originalName: file.originalname,
          mimeType: file.mimetype,
          fileSize: file.size,
          blobKey,
          fileType,
          processingStatus: 'PENDING',
        },
      });
    } catch (err) {
      await this.blobService.delete(blobKey).catch((cleanupErr: unknown) => {
        this.logger.error(
          `Failed to roll back orphaned blob ${blobKey} after DB write failure: ${(cleanupErr as Error).message}`,
        );
      });
      throw err;
    }

    // Trigger async processing via NestJS EventEmitter
    this.eventEmitter.emit('student-document.uploaded', { documentId: document.id });

    return document;
  }

  // ─── Async document processing ──────────────────────────

  @OnEvent('student-document.uploaded')
  async handleDocumentUploaded(payload: { documentId: string }) {
    await this.processDocument(payload.documentId);
  }

  /**
   * Stage 3 re-embed worker.
   *
   * Listens for `student-document.needs-reembed` (emitted by the teacher
   * Settings save flow when the embedding-model preference changes via
   * `LlmService.markCorporaForReembedIfChanged`, or by a manual admin
   * trigger). Walks every chunk on the doc, re-embeds with the current
   * funnel-resolved model, updates the chunks' pinned (model, dim), and
   * clears the parent doc's `needsReembed` flag.
   *
   * Until this finishes, retrieval continues to serve the OLD pinned
   * model (option (b) from the Stage 3 spec) — there's no read-side
   * stall.
   *
   * This is a Promise-based inline worker; the repo has no BullMQ
   * wiring today. If/when BullMQ lands, swap the EventEmitter trigger
   * for a queued job; the body below stays identical.
   */
  @OnEvent('student-document.needs-reembed')
  async reembedDocument(payload: { documentId: string }): Promise<void> {
    const documentId = payload.documentId;
    const doc = await this.prisma.studentSourceDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        studentId: true,
        courseId: true,
        course: { select: { teacherId: true } },
      },
    });
    if (!doc) {
      this.logger.warn(`Re-embed: document ${documentId} not found`);
      return;
    }

    try {
      const chunks = await this.prisma.studentRagChunk.findMany({
        where: { documentId },
        orderBy: { chunkIndex: 'asc' },
        select: { id: true, content: true },
      });
      if (chunks.length === 0) {
        await this.prisma.studentSourceDocument.update({
          where: { id: documentId },
          data: { needsReembed: false },
        });
        return;
      }

      let pinnedModel: string | null = null;
      let pinnedDim: number | null = null;
      for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
        const texts = batch.map((c) => c.content);
        const result = await this.embeddingService.callEmbeddingForUser(
          doc.course.teacherId,
          texts,
        );
        pinnedModel = result.model;
        pinnedDim = result.dimensions;

        await Promise.all(
          batch.map((chunk, idx) =>
            this.prisma.studentRagChunk.update({
              where: { id: chunk.id },
              data: {
                embedding: result.vectors[idx] as unknown as Prisma.InputJsonValue,
                embeddingModel: result.model,
                embeddingDimensions: result.dimensions,
              },
            }),
          ),
        );
      }

      await this.prisma.studentSourceDocument.update({
        where: { id: documentId },
        data: {
          embeddingModel: pinnedModel,
          embeddingDimensions: pinnedDim,
          needsReembed: false,
        },
      });

      this.logger.log(
        `Re-embedded ${chunks.length} chunks for student doc ${documentId} → ${pinnedModel}/${pinnedDim}`,
      );
    } catch (err) {
      // Leave needsReembed=true so the next trigger can retry; never
      // throw because we're invoked from an event listener.
      this.logger.error(`Re-embed failed for ${documentId}: ${(err as Error).message}`);
    }
  }

  @OnEvent('student-document.reembed-teacher')
  async handleReembedTeacher(payload: { teacherId: string }) {
    // Fire-and-forget background worker. Errors are logged per-doc.
    void this.reembedAllPendingForTeacher(payload.teacherId).catch((err) =>
      this.logger.error(
        `reembedAllPendingForTeacher(${payload.teacherId}) threw: ${(err as Error).message}`,
      ),
    );
  }

  /**
   * Public batch entry point: re-embed every student document whose
   * `needsReembed` is true. Convenience wrapper around the per-doc
   * worker. Called by the teacher save flow as a one-shot, and safe to
   * call repeatedly (it's a no-op once flags are cleared).
   */
  async reembedAllPendingForTeacher(teacherId: string): Promise<{ processed: number }> {
    const docs = await this.prisma.studentSourceDocument.findMany({
      where: { course: { teacherId }, needsReembed: true },
      select: { id: true },
    });
    for (const d of docs) {
      // Sequential to avoid blowing through API rate limits.
      await this.reembedDocument({ documentId: d.id });
    }
    return { processed: docs.length };
  }

  async processDocument(documentId: string): Promise<void> {
    const document = await this.prisma.studentSourceDocument.findUnique({
      where: { id: documentId },
      include: {
        course: {
          select: {
            id: true,
            teacherId: true,
            dblSettings: true,
          },
        },
      },
    });

    if (!document) {
      this.logger.error(`Document ${documentId} not found for processing`);
      return;
    }

    try {
      // 1. Set processingStatus = PROCESSING
      await this.prisma.studentSourceDocument.update({
        where: { id: documentId },
        data: { processingStatus: 'PROCESSING' },
      });
      this.dialogueGateway.emitProcessingUpdate(document.studentId, {
        documentId,
        status: 'PROCESSING',
      });

      // 2. Fetch blob from MinIO
      const blob = await this.blobService.get(document.blobKey);

      // 3. Parse file
      let parsed;
      if (IMAGE_MIME_TYPES.has(document.mimeType)) {
        // Use LLM vision for images
        parsed = await this.fileParser.parseImageWithVision(
          blob.body,
          document.mimeType,
          document.fileName,
          document.course.teacherId,
          document.courseId,
        );
      } else {
        parsed = await this.fileParser.parse(blob.body, document.mimeType, document.fileName);
      }

      if (!parsed.text || parsed.text.trim().length < 10) {
        throw new Error('Parsed document text is empty or too short');
      }

      // 4. Parse course settings for chunk options
      const dblSettings = this.parseDblSettings(document.course.dblSettings);
      const chunkOptions = {
        chunkSize: dblSettings.chunkSize,
        chunkOverlap: dblSettings.chunkOverlap,
      };

      // 5. Chunk the text
      const textChunks = this.chunkingService.chunk(parsed.text, chunkOptions, document.fileType);

      if (textChunks.length === 0) {
        throw new Error('No chunks generated from document');
      }

      // 6. Delete existing chunks for this document (for re-processing)
      await this.prisma.studentRagChunk.deleteMany({
        where: { documentId },
      });

      // 7. Batch-create StudentRagChunk records (without embeddings first)
      // Strip lone surrogates that can appear in extracted PDF text and break JSON serialization
      const stripSurrogates = (s: string) => s.replace(/[\uD800-\uDFFF]/g, '\uFFFD');

      await this.prisma.studentRagChunk.createMany({
        data: textChunks.map((chunk) => ({
          documentId,
          studentId: document.studentId,
          courseId: document.courseId,
          content: stripSurrogates(chunk.content),
          chunkIndex: chunk.chunkIndex,
          pageNumber: chunk.pageNumber ?? null,
          metadata: chunk.metadata as Prisma.InputJsonValue,
        })),
      });

      // 8. Fetch created chunks to get their IDs
      const createdChunks = await this.prisma.studentRagChunk.findMany({
        where: { documentId },
        orderBy: { chunkIndex: 'asc' },
        select: { id: true, content: true },
      });

      // 8b. Contextualise chunks (Stage 03 — Anthropic Contextual
      // Retrieval). Same shape as the teacher ingest path
      // (`RagService.chunkDocument`): for each chunk, generate a
      // 50-100 token blurb that situates it inside the parent doc,
      // persist it to `contextual_text`, and remember the
      // `contextualText + content` string to embed in step 9. Gated
      // by `RAG_CONTEXTUAL_RETRIEVAL` env flag +
      // `DialogueCourseSettings.contextualRetrieval` per-course
      // override. When disabled OR per-chunk blurb fails, ingest is
      // identical to Stage 02 — bare text is embedded.
      const perCourseCtx = this.parseContextualRetrievalOverride(document.course.dblSettings);
      let textsForEmbedding: Map<string, string> | null = null;
      if (contextualRetrievalEnabled(perCourseCtx) && createdChunks.length > 0) {
        textsForEmbedding = new Map();
        for (const chunk of createdChunks) {
          let blurb = '';
          try {
            blurb = await this.contextualizeService.contextualizeChunk(parsed.text, chunk.content, {
              teacherId: document.course.teacherId,
              documentTitle: document.originalName,
              usageContext: {
                feature: 'rag.contextualize.student',
                courseId: document.courseId,
                triggeredByUserId: document.studentId,
              },
            });
          } catch (err) {
            this.logger.warn(
              `Contextualize threw for student chunk ${chunk.id}: ${(err as Error).message}`,
            );
            blurb = '';
          }
          if (blurb) {
            try {
              await this.prisma.studentRagChunk.update({
                where: { id: chunk.id },
                data: { contextualText: blurb },
              });
              textsForEmbedding.set(chunk.id, `${blurb}\n\n${chunk.content}`);
            } catch (err) {
              this.logger.warn(
                `Persisting contextualText for student chunk ${chunk.id} failed: ${(err as Error).message}`,
              );
              textsForEmbedding.set(chunk.id, chunk.content);
            }
          } else {
            textsForEmbedding.set(chunk.id, chunk.content);
          }
        }
      }

      // 9. Generate embeddings in batches via the registry-driven
      // funnel. The funnel resolves the teacher's provider/model/key
      // internally and returns the (model, dimensions) actually used so
      // we can pin them on the corpus rows (Stage 3 contract).
      //
      // Stage 03 — when `textsForEmbedding` is populated, embed
      // `contextualText\n\ncontent`; otherwise embed bare `content`.
      let pinnedModel: string | null = null;
      let pinnedDim: number | null = null;
      for (let i = 0; i < createdChunks.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = createdChunks.slice(i, i + EMBEDDING_BATCH_SIZE);
        const texts = batch.map((c) => textsForEmbedding?.get(c.id) ?? c.content);
        const result = await this.embeddingService.callEmbeddingForUser(
          document.course.teacherId,
          texts,
        );
        pinnedModel = result.model;
        pinnedDim = result.dimensions;

        // Update each chunk's embedding + pinned (model, dim) so a
        // mid-flight re-embed can be incremental.
        await Promise.all(
          batch.map((chunk, idx) =>
            this.prisma.studentRagChunk.update({
              where: { id: chunk.id },
              data: {
                embedding: result.vectors[idx] as unknown as Prisma.InputJsonValue,
                embeddingModel: result.model,
                embeddingDimensions: result.dimensions,
              },
            }),
          ),
        );
      }

      // 10b. (Stage 05) Multimodal page-image ingest for PDFs. Runs
      // only when `RAG_MULTIMODAL_PDF` is on (or per-course override
      // forces it on) AND the file is a PDF. Triple-defensive — any
      // failure logs + continues; text chunks above are already
      // persisted.
      const perCourseMm = this.parseMultimodalPdfOverride(document.course.dblSettings);
      if (multimodalPdfEnabled(perCourseMm) && document.mimeType === 'application/pdf') {
        try {
          const imageChunks = await this.ingestPdfPageImages({
            buffer: blob.body,
            documentId,
            teacherId: document.course.teacherId,
            studentId: document.studentId,
            courseId: document.courseId,
            existingTextChunkCount: createdChunks.length,
          });
          if (imageChunks > 0) {
            this.logger.log(
              `Multimodal ingest (student): +${imageChunks} page_image chunks for doc ${documentId}`,
            );
          }
        } catch (err) {
          this.logger.warn(
            `Multimodal ingest (student) failed for ${documentId}: ${(err as Error).message}`,
          );
        }
      }

      // 11. Set processingStatus = COMPLETED + pin embedding model on
      // the parent doc so retrieval can assert compatibility.
      await this.prisma.studentSourceDocument.update({
        where: { id: documentId },
        data: {
          processingStatus: 'COMPLETED',
          processingError: null,
          embeddingModel: pinnedModel,
          embeddingDimensions: pinnedDim,
          needsReembed: false,
        },
      });
      this.dialogueGateway.emitProcessingUpdate(document.studentId, {
        documentId,
        status: 'COMPLETED',
      });

      // 12. Publish generate_source_guide event
      this.eventEmitter.emit('student-document.processed', { documentId });

      this.logger.log(`Document ${documentId} processed: ${createdChunks.length} chunks created`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown processing error';
      this.logger.error(`Document processing failed for ${documentId}: ${errorMessage}`, error);

      await this.prisma.studentSourceDocument.update({
        where: { id: documentId },
        data: {
          processingStatus: 'FAILED',
          processingError: errorMessage,
        },
      });
      this.dialogueGateway.emitProcessingUpdate(document.studentId, {
        documentId,
        status: 'FAILED',
      });
    }
  }

  // ─── Toggle source active/inactive ─────────────────────

  async toggleSource(documentId: string, studentId: string, isActive: boolean) {
    const doc = await this.verifyOwnership(documentId, studentId);
    return this.prisma.studentSourceDocument.update({
      where: { id: doc.id },
      data: { isActive },
    });
  }

  // ─── Delete a source and all its chunks ─────────────────

  async deleteDocument(documentId: string, studentId: string) {
    const doc = await this.verifyOwnership(documentId, studentId);

    // Delete per-page image blobs from MinIO before Cascade removes the chunk rows
    const imageChunks = await this.prisma.studentRagChunk.findMany({
      where: { documentId, imageObjectKey: { not: null } },
      select: { imageObjectKey: true },
    });
    await Promise.all(
      imageChunks.map((chunk) =>
        this.blobService
          .delete(chunk.imageObjectKey!)
          .catch((err: unknown) =>
            this.logger.warn(
              `Failed to delete image chunk blob ${chunk.imageObjectKey}: ${(err as Error).message}`,
            ),
          ),
      ),
    );

    // Delete main document blob from storage
    try {
      await this.blobService.delete(doc.blobKey);
    } catch (error) {
      this.logger.warn(`Failed to delete blob for document ${documentId}`, error);
    }

    // Cascade deletes chunks and guide via Prisma relations
    await this.prisma.studentSourceDocument.delete({
      where: { id: documentId },
    });

    return { deleted: true };
  }

  // ─── List sources for a student in a course ──────────────

  async listSources(enrollmentId: string, sessionId?: string) {
    const where: { enrollmentId: string; sessionId?: string | null } = { enrollmentId };
    if (sessionId) {
      where.sessionId = sessionId;
    }
    return this.prisma.studentSourceDocument.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        autoGuide: true,
        _count: { select: { chunks: true } },
      },
    });
  }

  // ─── List sources from other sessions (for import) ──────

  async listOtherSessionSources(enrollmentId: string, currentSessionId: string) {
    return this.prisma.studentSourceDocument.findMany({
      where: {
        enrollmentId,
        sessionId: { not: currentSessionId },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        originalName: true,
        fileType: true,
        fileSize: true,
        processingStatus: true,
        sessionId: true,
        session: { select: { id: true, title: true } },
      },
    });
  }

  // ─── Import documents into a session ────────────────────

  async importDocumentsToSession(
    documentIds: string[],
    targetSessionId: string,
    studentId: string,
  ) {
    // Verify ownership of all documents
    const docs = await this.prisma.studentSourceDocument.findMany({
      where: { id: { in: documentIds }, studentId },
    });
    if (docs.length !== documentIds.length) {
      throw new ForbiddenException('Some documents do not belong to you');
    }

    // Update documents to point to the target session
    await this.prisma.studentSourceDocument.updateMany({
      where: { id: { in: documentIds } },
      data: { sessionId: targetSessionId },
    });

    return { imported: documentIds.length };
  }

  // ─── Get a single source with its guide ─────────────────

  async getSource(documentId: string, studentId: string) {
    const doc = await this.prisma.studentSourceDocument.findUnique({
      where: { id: documentId },
      include: {
        autoGuide: true,
        _count: { select: { chunks: true } },
      },
    });

    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);
    if (doc.studentId !== studentId) {
      throw new ForbiddenException('You can only view your own documents');
    }

    return doc;
  }

  // ─── Helpers ────────────────────────────────────────────

  private resolveFileType(mimeType: string, fileName: string): StudentFileType {
    const fromMime = MIME_TO_FILE_TYPE[mimeType];
    if (fromMime) return fromMime;

    // Check file extension for code files
    const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    const codeExtensions = new Set([
      '.js',
      '.jsx',
      '.ts',
      '.tsx',
      '.py',
      '.java',
      '.cpp',
      '.c',
      '.cs',
      '.go',
      '.rb',
      '.php',
      '.rs',
      '.swift',
      '.kt',
      '.scala',
      '.r',
      '.sql',
      '.sh',
      '.bash',
      '.html',
      '.css',
      '.scss',
      '.yaml',
      '.yml',
      '.json',
      '.xml',
    ]);

    if (codeExtensions.has(ext)) return 'CODE';

    // Default to TXT
    return 'TXT';
  }

  private parseDblSettings(raw: unknown) {
    try {
      const parsed = DialogueCourseSettingsSchema.parse(raw || {});
      return parsed;
    } catch {
      // Return defaults
      return DialogueCourseSettingsSchema.parse({});
    }
  }

  /**
   * Stage 03 — see RagService.parseContextualRetrievalOverride. Returns
   * the per-course Contextual Retrieval flag override or null to defer
   * to the env var.
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
   * Stage 05 — Public entry point for the multimodal backfill script.
   * Mirror of RagService.backfillTeacherMultimodal. Idempotent.
   * Never throws.
   */
  async backfillStudentMultimodal(documentId: string): Promise<number> {
    const doc = await this.prisma.studentSourceDocument.findUnique({
      where: { id: documentId },
      include: { course: { select: { teacherId: true } } },
    });
    if (!doc || doc.mimeType !== 'application/pdf') return 0;
    try {
      const { body } = await this.blobService.get(doc.blobKey);
      const existingText = await this.prisma.studentRagChunk.count({
        where: { documentId, OR: [{ chunkKind: null }, { chunkKind: 'text' }] },
      });
      return await this.ingestPdfPageImages({
        buffer: body,
        documentId,
        teacherId: doc.course.teacherId,
        studentId: doc.studentId,
        courseId: doc.courseId,
        existingTextChunkCount: existingText,
      });
    } catch (err) {
      this.logger.warn(
        `backfillStudentMultimodal(${documentId}) failed: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  /** Stage 05 — see RagService.parseMultimodalPdfOverride. */
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
   * Stage 05 — Multimodal page-image ingest for the STUDENT corpus.
   * Mirror of `RagService.ingestPdfPageImages` but writes to
   * `studentRagChunk` instead of `documentChunk` and uses the
   * `student-docs/...` MinIO key convention.
   */
  private async ingestPdfPageImages(args: {
    buffer: Buffer;
    documentId: string;
    teacherId: string;
    studentId: string;
    courseId: string;
    existingTextChunkCount: number;
  }): Promise<number> {
    const pages = await this.pdfRasterizer.rasterizePdf(args.buffer);
    if (pages.length === 0) return 0;

    // Idempotency guard.
    const existingImage = await this.prisma.studentRagChunk.findFirst({
      where: { documentId: args.documentId, chunkKind: 'page_image' },
      select: { id: true },
    });
    if (existingImage) {
      this.logger.log(
        `Multimodal ingest (student): doc ${args.documentId} already has page_image chunks; skipping`,
      );
      return 0;
    }

    const uploads = await Promise.all(
      pages.map(async (page) => {
        const key = `student-docs/${args.studentId}/${args.courseId}/${args.documentId}/pages/${page.pageNumber}.png`;
        try {
          await this.blobService.put({
            key,
            body: page.pngBuffer,
            contentType: 'image/png',
          });
          return { ...page, imageObjectKey: key };
        } catch (err) {
          this.logger.warn(
            `[multimodal][student] PNG upload failed for page ${page.pageNumber}: ${(err as Error).message}`,
          );
          return null;
        }
      }),
    );
    const uploaded = uploads.filter((u): u is NonNullable<typeof u> => u !== null);
    if (uploaded.length === 0) return 0;

    const embedResult = await this.embeddingService.callMultimodalEmbedding(
      args.teacherId,
      uploaded.map((u) => ({
        kind: 'image' as const,
        bytes: u.pngBuffer,
        mimeType: 'image/png' as const,
      })),
    );

    let persisted = 0;
    for (let i = 0; i < uploaded.length; i++) {
      const page = uploaded[i]!;
      const vector = embedResult.vectors[i];
      if (!vector) {
        this.logger.warn(
          `[multimodal][student] No embedding for page ${page.pageNumber}; skipping chunk persist`,
        );
        continue;
      }

      const caption = await this.pageCaption.captionPageImage(page.pngBuffer, 'image/png', {
        teacherId: args.teacherId,
        courseId: args.courseId,
        pageNumber: page.pageNumber,
      });

      try {
        await this.prisma.studentRagChunk.create({
          data: {
            documentId: args.documentId,
            studentId: args.studentId,
            courseId: args.courseId,
            chunkIndex: args.existingTextChunkCount + i,
            content: caption
              ? `[Page ${page.pageNumber} image] ${caption}`
              : `[Page ${page.pageNumber} image]`,
            pageNumber: page.pageNumber,
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
          `[multimodal][student] persist failed for page ${page.pageNumber}: ${(err as Error).message}`,
        );
      }
    }
    return persisted;
  }

  private async verifyOwnership(documentId: string, studentId: string) {
    const doc = await this.prisma.studentSourceDocument.findUnique({
      where: { id: documentId },
    });

    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);
    if (doc.studentId !== studentId) {
      throw new ForbiddenException('You can only modify your own documents');
    }

    return doc;
  }
}
