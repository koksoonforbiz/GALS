import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LearningInterventionsService } from '../learning-interventions/learning-interventions.service';
import { RagService } from '../rag/rag.service';
import { SharedChunkingService } from '../rag/shared/chunking.service';
import { BlobService } from '../blob/blob.service';
import type { PreGenerationConfigDto } from './dto/pre-generation-config.dto';

const STRATEGIES = [
  'practice-testing',
  'distributed-practice',
  'stepwise-learning',
  'interrogative-elaboration',
] as const;

type Strategy = (typeof STRATEGIES)[number];

@Injectable()
export class PreGenerationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PreGenerationService.name);
  private workerRunning = false;
  private workerInterval: ReturnType<typeof setInterval> | null = null;
  private backfillInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly interventions: LearningInterventionsService,
    private readonly ragService: RagService,
    private readonly chunking: SharedChunkingService,
    private readonly blob: BlobService,
  ) {}

  onModuleInit() {
    // Run backfill immediately on startup, then every 60 seconds
    void this.runBackfill();
    this.backfillInterval = setInterval(() => void this.runBackfill(), 60_000);

    // Process one pending exercise every 5 seconds
    this.workerRunning = true;
    this.workerInterval = setInterval(() => void this.processNextPending(), 5_000);
  }

  onModuleDestroy() {
    this.workerRunning = false;
    if (this.workerInterval) clearInterval(this.workerInterval);
    if (this.backfillInterval) clearInterval(this.backfillInterval);
  }

  // ─── Config ────────────────────────────────────────────────────────────────

  async getConfig(courseId: string) {
    let cfg = await this.prisma.preGenerationConfig.findUnique({ where: { courseId } });
    if (!cfg) {
      cfg = await this.prisma.preGenerationConfig.create({
        data: { courseId, mode: 'none', numberOfSets: 1 },
      });
    }
    return cfg;
  }

  async updateConfig(courseId: string, dto: PreGenerationConfigDto) {
    const cfg = await this.prisma.preGenerationConfig.upsert({
      where: { courseId },
      update: { mode: dto.mode, numberOfSets: dto.numberOfSets },
      create: { courseId, mode: dto.mode, numberOfSets: dto.numberOfSets },
    });

    // If mode is now active, schedule backfill for this course's docs
    if (dto.mode !== 'none') {
      void this.queueDocumentsForCourse(courseId, dto.mode, dto.numberOfSets);
    }

    return cfg;
  }

  // ─── Backfill ──────────────────────────────────────────────────────────────

  private async runBackfill() {
    try {
      const configs = await this.prisma.preGenerationConfig.findMany({
        where: { mode: { not: 'none' } },
        select: { courseId: true, mode: true, numberOfSets: true },
      });

      for (const cfg of configs) {
        await this.queueDocumentsForCourse(cfg.courseId, cfg.mode, cfg.numberOfSets);
      }
    } catch (err) {
      this.logger.warn(`Backfill scan failed: ${(err as Error).message}`);
    }
  }

  private async queueDocumentsForCourse(courseId: string, mode: string, numberOfSets: number) {
    const docs = await this.prisma.sourceDocument.findMany({
      where: {
        courseId,
        pageCount: { gt: 0 },
        indexedAt: { not: null },
      },
      select: { id: true, pageCount: true },
    });

    for (const doc of docs) {
      await this.queueDocument(doc.id, mode, numberOfSets, doc.pageCount!);
    }
  }

  private async queueDocument(
    documentId: string,
    mode: string,
    numberOfSets: number,
    pageCount: number,
  ) {
    const maxPage = mode === 'first5' ? Math.min(5, pageCount) : pageCount;

    for (let page = 1; page <= maxPage; page++) {
      for (const strategy of STRATEGIES) {
        for (let setIdx = 0; setIdx < numberOfSets; setIdx++) {
          // createMany with skipDuplicates so re-running is idempotent
          await this.prisma.preGeneratedExercise.upsert({
            where: {
              documentId_pageNumber_strategy_setIndex: {
                documentId,
                pageNumber: page,
                strategy,
                setIndex: setIdx,
              },
            },
            update: {}, // don't overwrite existing done/error records
            create: {
              documentId,
              pageNumber: page,
              strategy,
              setIndex: setIdx,
              content: {},
              status: 'pending',
            },
          });
        }
      }
    }
  }

  // ─── Worker ────────────────────────────────────────────────────────────────

  private async processNextPending() {
    if (!this.workerRunning) return;

    const exercise = await this.prisma.preGeneratedExercise.findFirst({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, documentId: true, pageNumber: true, strategy: true },
    });

    if (!exercise) return;

    // Mark as generating to prevent double-processing
    await this.prisma.preGeneratedExercise.update({
      where: { id: exercise.id },
      data: { status: 'generating' },
    });

    try {
      const pageText = await this.getPageText(exercise.documentId, exercise.pageNumber);

      if (!pageText || pageText.length < 20) {
        await this.prisma.preGeneratedExercise.update({
          where: { id: exercise.id },
          data: { status: 'error', errorMessage: 'Page has insufficient text content' },
        });
        return;
      }

      // Look up the courseId for this document
      const doc = await this.prisma.sourceDocument.findUnique({
        where: { id: exercise.documentId },
        select: { courseId: true },
      });
      if (!doc) {
        await this.prisma.preGeneratedExercise.update({
          where: { id: exercise.id },
          data: { status: 'error', errorMessage: 'Document not found' },
        });
        return;
      }

      const content = await this.interventions.preGeneratePage(
        doc.courseId,
        pageText,
        exercise.strategy as Strategy,
      );

      await this.prisma.preGeneratedExercise.update({
        where: { id: exercise.id },
        data: { status: 'done', content: content as object, generatedAt: new Date() },
      });

      this.logger.log(
        `Pre-generated ${exercise.strategy} p${exercise.pageNumber} for doc ${exercise.documentId}`,
      );
    } catch (err) {
      const msg = (err as Error).message ?? 'Unknown error';
      this.logger.warn(`Pre-generation failed for exercise ${exercise.id}: ${msg}`);
      await this.prisma.preGeneratedExercise.update({
        where: { id: exercise.id },
        data: { status: 'error', errorMessage: msg.slice(0, 500) },
      });
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async getPageText(documentId: string, pageNumber: number): Promise<string> {
    const chunks = await this.prisma.documentChunk.findMany({
      where: { documentId, pageNumber },
      orderBy: { chunkIndex: 'asc' },
      select: { content: true },
    });
    return chunks.map((c) => c.content).join('\n\n');
  }

  /** Returns a done pre-generated exercise for the given key, cycling
   *  through sets by picking the one with the lowest setIndex that is done.
   *  Returns null when nothing is ready (caller falls through to live LLM). */
  async getNextExercise(
    documentId: string,
    pageNumber: number,
    strategy: string,
  ): Promise<{ content: unknown } | null> {
    const exercise = await this.prisma.preGeneratedExercise.findFirst({
      where: { documentId, pageNumber, strategy, status: 'done' },
      orderBy: { setIndex: 'asc' },
      select: { content: true },
    });
    return exercise ?? null;
  }

  /** Find a SourceDocument in the course matching the given filename. Used by the
   *  student view to resolve a ModuleItem PDF to its pre-generation document ID. */
  async matchDocument(courseId: string, filename: string): Promise<{ documentId: string | null }> {
    const doc = await this.prisma.sourceDocument.findFirst({
      where: { courseId, filename },
      select: { id: true },
    });
    return { documentId: doc?.id ?? null };
  }

  /** Per-strategy readiness check for the student chatbot indicator. */
  async getReadiness(documentId: string, pageNumber: number): Promise<Record<Strategy, boolean>> {
    const done = await this.prisma.preGeneratedExercise.findMany({
      where: { documentId, pageNumber, status: 'done' },
      select: { strategy: true },
      distinct: ['strategy'],
    });
    const doneSet = new Set(done.map((d) => d.strategy));
    return Object.fromEntries(STRATEGIES.map((s) => [s, doneSet.has(s)])) as Record<
      Strategy,
      boolean
    >;
  }

  private static readonly PREGEN_FEATURES = [
    'practice_testing_pregen',
    'distributed_practice_pregen',
    'stepwise_learning_pregen',
    'ie_pregen',
  ];

  /** Aggregate LLM cost for all pre-generation calls on a course. */
  async getPregenCost(courseId: string) {
    const result = await this.prisma.llmUsageLog.aggregate({
      where: {
        courseId,
        feature: { in: PreGenerationService.PREGEN_FEATURES },
      },
      _sum: { totalCost: true, inputTokens: true, outputTokens: true },
      _count: { id: true },
    });
    return {
      totalCost: result._sum.totalCost ?? 0,
      inputTokens: result._sum.inputTokens ?? 0,
      outputTokens: result._sum.outputTokens ?? 0,
      callCount: result._count.id,
    };
  }

  /** Reset all done/error exercises for a document back to pending so the
   *  worker re-generates them. */
  async regenerateDocument(documentId: string) {
    const updated = await this.prisma.preGeneratedExercise.updateMany({
      where: { documentId, status: { in: ['done', 'error'] } },
      data: { status: 'pending', content: {}, generatedAt: null, errorMessage: null },
    });
    return { queued: updated.count };
  }

  /** Browse pre-generated exercises for the teacher preview tab.
   *  Returns all done exercises for a document, optionally filtered by
   *  pageNumber and/or strategy. */
  async getExercises(documentId: string, pageNumber?: number, strategy?: string) {
    return this.prisma.preGeneratedExercise.findMany({
      where: {
        documentId,
        status: 'done',
        ...(pageNumber != null ? { pageNumber } : {}),
        ...(strategy ? { strategy } : {}),
      },
      select: {
        id: true,
        pageNumber: true,
        strategy: true,
        setIndex: true,
        content: true,
        generatedAt: true,
      },
      orderBy: [{ pageNumber: 'asc' }, { strategy: 'asc' }, { setIndex: 'asc' }],
    });
  }

  /** Status summary for the teacher UI. */
  async getDocumentStatus(documentId: string) {
    const counts = await this.prisma.preGeneratedExercise.groupBy({
      by: ['status'],
      where: { documentId },
      _count: { id: true },
    });
    const total = counts.reduce((s, r) => s + r._count.id, 0);
    const done = counts.find((r) => r.status === 'done')?._count.id ?? 0;
    const pending = counts.find((r) => r.status === 'pending')?._count.id ?? 0;
    const generating = counts.find((r) => r.status === 'generating')?._count.id ?? 0;
    const error = counts.find((r) => r.status === 'error')?._count.id ?? 0;
    return { total, done, pending, generating, error };
  }

  /** Reset all done/error exercises for every indexed document in a course
   *  and re-queue them. Also indexes any module-item PDFs that haven't been
   *  indexed yet — that part runs fire-and-forget so the response is fast. */
  async regenerateCourse(courseId: string) {
    // ── RAG source documents ──────────────────────────────────────────────────
    const docs = await this.prisma.sourceDocument.findMany({
      where: { courseId, pageCount: { gt: 0 }, indexedAt: { not: null } },
      select: { id: true },
    });

    for (const doc of docs) {
      await this.prisma.preGeneratedExercise.updateMany({
        where: { documentId: doc.id, status: { in: ['done', 'error'] } },
        data: { status: 'pending', content: {}, generatedAt: null, errorMessage: null },
      });
    }

    const cfg = await this.getConfig(courseId);
    if (cfg.mode !== 'none') {
      await this.queueDocumentsForCourse(courseId, cfg.mode, cfg.numberOfSets);
    }

    // ── Module-item PDFs (fire-and-forget so the HTTP response stays fast) ────
    const items = await this.prisma.moduleItem.findMany({
      where: { module: { courseId }, type: 'PDF', pdfBlobKey: { not: null } },
      select: { id: true },
    });

    void (async () => {
      for (const item of items) {
        try {
          await this.queueModuleItemPregen(item.id);
        } catch (err) {
          this.logger.warn(
            `regenerateCourse: module item ${item.id} failed: ${(err as Error).message}`,
          );
        }
      }
    })();

    const queued = await this.prisma.preGeneratedExercise.count({
      where: { documentId: { in: docs.map((d) => d.id) }, status: 'pending' },
    });

    return { queued, documents: docs.length + items.length };
  }

  // ─── Module-item PDF pre-generation ───────────────────────────────────────

  /** List all PDF-type module items in a course, enriched with the
   *  SourceDocument ID if the PDF has already been indexed. */
  async listModuleItemPdfs(courseId: string) {
    const items = await this.prisma.moduleItem.findMany({
      where: { module: { courseId }, type: 'PDF', pdfBlobKey: { not: null } },
      select: {
        id: true,
        title: true,
        pdfFilename: true,
        pdfBlobKey: true,
        module: { select: { title: true } },
      },
      orderBy: [{ orderIndex: 'asc' }],
    });

    return Promise.all(
      items.map(async (item) => {
        const doc = await this.prisma.sourceDocument.findFirst({
          where: { blobKey: item.pdfBlobKey! },
          select: { id: true, pageCount: true },
        });
        return {
          id: item.id,
          title: item.title,
          pdfFilename: item.pdfFilename,
          moduleName: item.module.title,
          documentId: doc?.id ?? null,
          pageCount: doc?.pageCount ?? null,
        };
      }),
    );
  }

  /** Download the module-item PDF, extract text, create/update the shadow
   *  SourceDocument + DocumentChunk records, and return the document. */
  async indexModuleItemPdf(itemId: string) {
    const item = await this.prisma.moduleItem.findUniqueOrThrow({
      where: { id: itemId },
      select: {
        id: true,
        title: true,
        pdfBlobKey: true,
        pdfFilename: true,
        pdfSize: true,
        module: { select: { courseId: true } },
      },
    });

    if (!item.pdfBlobKey) throw new Error(`Module item ${itemId} has no PDF`);

    const courseId = item.module.courseId;
    const blobKey = item.pdfBlobKey;

    const course = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      select: { teacherId: true },
    });

    // Find or create the SourceDocument keyed on blobKey
    let doc = await this.prisma.sourceDocument.findFirst({
      where: { blobKey },
      select: { id: true, courseId: true, pageCount: true },
    });

    if (!doc) {
      doc = await this.prisma.sourceDocument.create({
        data: {
          courseId,
          uploadedById: course.teacherId,
          title: item.title,
          filename: item.pdfFilename ?? 'document.pdf',
          blobKey,
          mimeType: 'application/pdf',
          sizeBytes: item.pdfSize ?? 0,
          chunkCount: 0,
        },
        select: { id: true, courseId: true, pageCount: true },
      });
    }

    // Download and extract text
    const { body } = await this.blob.get(blobKey);
    const { text, pageCount } = await this.ragService.extractText(body, 'application/pdf');

    // Chunk by page
    const rawChunks = this.chunking.chunkDocumentWithPages(text, {
      strategy: 'auto',
      mimeType: 'application/pdf',
      filename: item.pdfFilename ?? 'document.pdf',
    });

    // Replace existing chunks
    await this.prisma.documentChunk.deleteMany({ where: { documentId: doc.id } });
    if (rawChunks.length > 0) {
      await this.prisma.documentChunk.createMany({
        data: rawChunks.map((c, i) => ({
          documentId: doc!.id,
          chunkIndex: i,
          content: c.content,
          pageNumber: c.pageNumber ?? null,
          tokenCount: 0,
        })),
      });
    }

    const updated = await this.prisma.sourceDocument.update({
      where: { id: doc.id },
      data: {
        pageCount: pageCount ?? (rawChunks.length > 0 ? 1 : 0),
        chunkCount: rawChunks.length,
        indexedAt: new Date(),
      },
      select: { id: true, courseId: true, pageCount: true },
    });

    return updated;
  }

  /** Index the PDF if needed, then queue all pre-generation exercises. */
  async queueModuleItemPregen(itemId: string): Promise<{ documentId: string; queued: number }> {
    const doc = await this.indexModuleItemPdf(itemId);

    const cfg = await this.getConfig(doc.courseId);
    const mode = cfg.mode !== 'none' ? cfg.mode : 'all';
    const numberOfSets = cfg.numberOfSets;

    // Reset any exercises that are done/error so they re-run
    await this.prisma.preGeneratedExercise.updateMany({
      where: { documentId: doc.id, status: { in: ['done', 'error'] } },
      data: { status: 'pending', content: {}, generatedAt: null, errorMessage: null },
    });

    await this.queueDocument(doc.id, mode, numberOfSets, doc.pageCount ?? 1);

    const queued = await this.prisma.preGeneratedExercise.count({
      where: { documentId: doc.id, status: 'pending' },
    });

    return { documentId: doc.id, queued };
  }
}
