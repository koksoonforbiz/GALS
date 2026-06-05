import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LearningInterventionsService } from '../learning-interventions/learning-interventions.service';
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
}
