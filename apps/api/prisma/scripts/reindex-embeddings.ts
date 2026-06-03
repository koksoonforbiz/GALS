/**
 * Stage 02 — RAG re-index script.
 *
 * Re-embeds chunks whose `embedding_model` differs from the teacher's
 * current active default for either corpus:
 *   - `document_chunks` (teacher) — keyed by `source_documents.course.teacherId`.
 *   - `student_rag_chunks` (student) — keyed by `student_source_documents.course.teacherId`.
 *
 * Why this is a script, not a Prisma migration:
 *   - Pure data movement; no schema change.
 *   - Depends on the live LLM funnel (`EmbeddingService.callEmbeddingForUser`),
 *     which needs Nest DI bootstrap.
 *   - Idempotent: re-running after a partial failure picks up the
 *     remaining stale rows. After everything is on-target, a second
 *     run is a no-op.
 *
 * How to run:
 *   pnpm --filter @ats/api exec tsx prisma/scripts/reindex-embeddings.ts
 *   # or with a courseId filter:
 *   pnpm --filter @ats/api exec tsx prisma/scripts/reindex-embeddings.ts -- --course=<uuid>
 *   # or dry-run:
 *   pnpm --filter @ats/api exec tsx prisma/scripts/reindex-embeddings.ts -- --dry-run
 *
 * Safety:
 *   - Skips chunks whose model already matches the teacher's current
 *     default (cheap WHERE clause, no embedding call).
 *   - Batches of EMBEDDING_BATCH_SIZE so a 100k-chunk corpus won't
 *     blow the OpenAI rate limit in a single second.
 *   - On per-batch failure, logs and continues — does not throw out
 *     of the loop. The remaining chunks still get a chance.
 *   - Stamps `embedding_model` + `embedding_dimensions` + `embedding`
 *     atomically per chunk so a CTRL-C mid-run leaves the corpus in
 *     a consistent intermediate state (some on new model, some on old)
 *     — the next run picks up where this one stopped.
 *
 * Documented in `docs/rag/AUDIT.md` Stage 02 section.
 */

import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';

// Lazy-load the AppModule because it pulls in env validation (Redis,
// blob creds) — see `prisma/scripts/migrate_retired_llm_models.ts` for
// the same pattern.

interface ParsedArgs {
  courseId: string | null;
  dryRun: boolean;
  help: boolean;
  /** Stage 03 — when true, also backfill `contextual_text` on chunks
   *  that lack it AND re-embed those chunks under
   *  `contextualText + content` (Anthropic Contextual Retrieval). */
  contextualize: boolean;
  /** Stage 05 — when true, for each PDF source/student doc that
   *  doesn't yet have any `page_image` chunks, rasterize the PDF,
   *  upload page PNGs to MinIO, embed via Cohere multimodal funnel,
   *  caption via VLM funnel, and insert `chunk_kind = 'page_image'`
   *  rows. Idempotent — skips docs whose first page_image chunk
   *  already exists. Independent of the embed/contextualize passes
   *  above; combine flags to do everything in one run. */
  multimodal: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    courseId: null,
    dryRun: false,
    help: false,
    contextualize: false,
    multimodal: false,
  };
  for (const a of argv) {
    if (a === '-h' || a === '--help') args.help = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--contextualize') args.contextualize = true;
    else if (a === '--multimodal') args.multimodal = true;
    else if (a.startsWith('--course=')) args.courseId = a.split('=')[1] ?? null;
  }
  return args;
}

function helpText(): string {
  return [
    'reindex-embeddings — Stage 02/03/05 maintenance script',
    '',
    'Flags:',
    '  --course=<uuid>    Limit to a single course (otherwise: every course on the platform)',
    '  --dry-run          Report what WOULD re-embed; do not call the LLM or write back',
    '  --contextualize    Stage 03 backfill: for chunks lacking',
    '                      `contextual_text`, generate the 50-100 token',
    '                      doc-aware blurb via the contextualizer service,',
    '                      persist it, and re-embed under',
    '                      `contextualText + content`. Idempotent: only',
    '                      acts on rows where `contextual_text IS NULL`.',
    '                      Independent of the model-drift backfill above —',
    '                      run with both to do both passes in one go.',
    '  --multimodal       Stage 05 backfill: for each PDF source/student',
    '                      doc with NO `page_image` chunks yet, rasterize',
    '                      the PDF, upload page PNGs to MinIO, embed via',
    '                      Cohere Embed 4, caption via VLM funnel, and',
    '                      insert page_image chunks. Idempotent. Respects',
    '                      per-teacher rate limit (sequential per-doc).',
    '                      Requires `RAG_MULTIMODAL_PDF=true` OR the',
    '                      per-course override to be on, AND a Cohere key',
    '                      configured for each teacher whose corpus is',
    '                      backfilled.',
    '  -h, --help         This help',
    '',
    'Behavior (default — model-drift pass):',
    '  Per-teacher resolution of the active embedding model id (from the',
    '  registry default or User.llmEmbeddingModel). For each corpus the',
    '  teacher owns, finds chunks whose embedding_model differs from',
    '  the active target, re-embeds them in batches via the funnel,',
    '  and stamps the new (model, dim). Idempotent.',
    '',
    'Behavior (--contextualize pass):',
    '  Walks every chunk on every doc (filtered by --course if given)',
    '  whose `contextual_text` IS NULL. For each, fetches the parent',
    '  doc text (PDF / DOCX / etc) once, then iterates the doc\'s',
    '  chunks calling ContextualizeService.contextualizeChunk per chunk.',
    '  Persists the blurb, then re-embeds the chunk under',
    '  `contextualText + content` via the funnel. Respects the teacher\'s',
    '  per-course API key and the EMBEDDING_BATCH_SIZE rate. Per-doc',
    '  progress logged. Idempotent — a second run is a no-op once all',
    '  chunks have `contextual_text`.',
  ].join('\n');
}

const EMBEDDING_BATCH_SIZE = 50;

interface CorpusStats {
  teacherId: string;
  courseId: string | null;
  examinedChunks: number;
  reembeddedChunks: number;
  skippedFailureBatches: number;
}

/** Stage 03 — counts for the `--contextualize` pass. Separate from
 *  `CorpusStats` so a combined run reports both passes distinctly. */
interface ContextualizeStats {
  teacherId: string;
  courseId: string | null;
  examinedDocs: number;
  contextualisedChunks: number;
  skippedChunks: number;
  reembeddedChunks: number;
}

/** Stage 05 — counts for the `--multimodal` pass. */
interface MultimodalStats {
  teacherId: string;
  courseId: string | null;
  examinedDocs: number;
  pageImageChunksCreated: number;
  skippedDocs: number;
}

async function run(args: ParsedArgs): Promise<{
  embedStats: CorpusStats[];
  ctxStats: ContextualizeStats[];
  mmStats: MultimodalStats[];
}> {
  const { AppModule } = await import('../../src/app.module');
  const { PrismaService } = await import('../../src/prisma/prisma.service');
  const { EmbeddingService } = await import('../../src/student-rag/embedding.service');
  const { ContextualizeService } = await import(
    '../../src/rag/shared/contextualize.service'
  );
  const { RagService } = await import('../../src/rag/rag.service');
  const { StudentRagService } = await import('../../src/student-rag/student-rag.service');
  const { defaultEmbeddingModel } = await import('../../src/llm/model-registry');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const prisma = app.get(PrismaService);
    const embeddingService = app.get(EmbeddingService);
    const contextualizeService = app.get(ContextualizeService);
    const ragService = app.get(RagService);
    const studentRagService = app.get(StudentRagService);

    // Resolve the universe of teachers we should consider.
    const courses = await prisma.course.findMany({
      where: args.courseId ? { id: args.courseId } : undefined,
      select: { id: true, teacherId: true },
    });

    const stats: CorpusStats[] = [];
    const ctxStats: ContextualizeStats[] = [];
    const mmStats: MultimodalStats[] = [];

    for (const course of courses) {
      const teacher = await prisma.user.findUnique({
        where: { id: course.teacherId },
        select: { llmProvider: true, llmEmbeddingModel: true },
      });
      const provider = (teacher?.llmProvider === 'gemini' ? 'gemini' : 'openai') as
        | 'openai'
        | 'gemini';
      const activeModelId =
        teacher?.llmEmbeddingModel ?? defaultEmbeddingModel(provider).id;

      // ── Teacher corpus (document_chunks) ──
      const teacherChunks = await prisma.documentChunk.findMany({
        where: {
          document: { courseId: course.id },
          OR: [
            { embeddingModel: null },
            { embeddingModel: { not: activeModelId } },
            // SHA256 pseudo-fallback chunks ALSO get re-embedded (the
            // active model id is now a real one; pseudo is stale).
          ],
        },
        select: { id: true, content: true, embeddingModel: true },
      });

      const teacherStats: CorpusStats = {
        teacherId: course.teacherId,
        courseId: course.id,
        examinedChunks: teacherChunks.length,
        reembeddedChunks: 0,
        skippedFailureBatches: 0,
      };

      if (teacherChunks.length > 0 && !args.dryRun) {
        for (let i = 0; i < teacherChunks.length; i += EMBEDDING_BATCH_SIZE) {
          const batch = teacherChunks.slice(i, i + EMBEDDING_BATCH_SIZE);
          try {
            const result = await embeddingService.callEmbeddingForUser(
              course.teacherId,
              batch.map((c) => c.content),
            );
            await Promise.all(
              batch.map((chunk, idx) =>
                prisma.documentChunk.update({
                  where: { id: chunk.id },
                  data: {
                    embedding: result.vectors[idx] as unknown as Prisma.InputJsonValue,
                    embeddingModel: result.model,
                    embeddingDimensions: result.dimensions,
                  },
                }),
              ),
            );
            teacherStats.reembeddedChunks += batch.length;
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(
              `[reindex][teacher] batch ${i}-${i + batch.length} (course=${course.id}) failed: ${(err as Error).message}`,
            );
            teacherStats.skippedFailureBatches += 1;
          }
        }
      }

      if (teacherStats.examinedChunks > 0) {
        stats.push(teacherStats);
      }

      // ── Student corpus (student_rag_chunks) ──
      const studentChunks = await prisma.studentRagChunk.findMany({
        where: {
          courseId: course.id,
          OR: [
            { embeddingModel: null },
            { embeddingModel: { not: activeModelId } },
          ],
        },
        select: { id: true, content: true, embeddingModel: true },
      });

      const studentStats: CorpusStats = {
        teacherId: course.teacherId,
        courseId: course.id,
        examinedChunks: studentChunks.length,
        reembeddedChunks: 0,
        skippedFailureBatches: 0,
      };

      if (studentChunks.length > 0 && !args.dryRun) {
        for (let i = 0; i < studentChunks.length; i += EMBEDDING_BATCH_SIZE) {
          const batch = studentChunks.slice(i, i + EMBEDDING_BATCH_SIZE);
          try {
            const result = await embeddingService.callEmbeddingForUser(
              course.teacherId,
              batch.map((c) => c.content),
            );
            await Promise.all(
              batch.map((chunk, idx) =>
                prisma.studentRagChunk.update({
                  where: { id: chunk.id },
                  data: {
                    embedding: result.vectors[idx] as unknown as Prisma.InputJsonValue,
                    embeddingModel: result.model,
                    embeddingDimensions: result.dimensions,
                  },
                }),
              ),
            );
            studentStats.reembeddedChunks += batch.length;
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(
              `[reindex][student] batch ${i}-${i + batch.length} (course=${course.id}) failed: ${(err as Error).message}`,
            );
            studentStats.skippedFailureBatches += 1;
          }
        }
      }

      if (studentStats.examinedChunks > 0) {
        stats.push(studentStats);
      }

      // eslint-disable-next-line no-console
      console.log(
        `[reindex] course=${course.id} teacher=${course.teacherId} target=${activeModelId} ` +
          `teacher_stale=${teacherStats.examinedChunks} student_stale=${studentChunks.length}`,
      );

      // ── Stage 03 — Contextualize backfill pass ──
      if (args.contextualize) {
        // Teacher corpus: walk every doc with at least one chunk
        // missing `contextual_text`, reconstruct full-doc text from
        // the chunks, generate per-chunk blurbs, persist, re-embed.
        const teacherDocs = await prisma.sourceDocument.findMany({
          where: {
            courseId: course.id,
            chunks: { some: { contextualText: null } },
          },
          select: { id: true, title: true },
        });

        const teacherCtx: ContextualizeStats = {
          teacherId: course.teacherId,
          courseId: course.id,
          examinedDocs: teacherDocs.length,
          contextualisedChunks: 0,
          skippedChunks: 0,
          reembeddedChunks: 0,
        };

        for (const doc of teacherDocs) {
          // Fetch all chunks ordered to reconstruct the doc text.
          // Reconstruction by joining chunks is approximate (overlap
          // is duplicated) but good enough to disambiguate "whose
          // revenue / which quarter" — the contextualiser only needs
          // doc-level anchors (title, sections, entities), not byte-
          // perfect text.
          const allChunks = await prisma.documentChunk.findMany({
            where: { documentId: doc.id },
            orderBy: { chunkIndex: 'asc' },
            select: { id: true, content: true, contextualText: true },
          });
          if (allChunks.length === 0) continue;
          const fullDocText = allChunks.map((c) => c.content).join('\n\n');

          // eslint-disable-next-line no-console
          console.log(
            `[contextualize][teacher] course=${course.id} doc=${doc.id} title=${doc.title} chunks=${allChunks.length}`,
          );

          for (const chunk of allChunks) {
            if (chunk.contextualText) continue; // idempotent
            if (args.dryRun) {
              teacherCtx.skippedChunks += 1;
              continue;
            }
            let blurb = '';
            try {
              blurb = await contextualizeService.contextualizeChunk(
                fullDocText,
                chunk.content,
                {
                  teacherId: course.teacherId,
                  documentTitle: doc.title,
                  usageContext: {
                    feature: 'rag.contextualize.teacher.backfill',
                    courseId: course.id,
                  },
                },
              );
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn(
                `[contextualize][teacher] chunk ${chunk.id} threw: ${(err as Error).message}`,
              );
              teacherCtx.skippedChunks += 1;
              continue;
            }
            if (!blurb) {
              teacherCtx.skippedChunks += 1;
              continue;
            }
            try {
              await prisma.documentChunk.update({
                where: { id: chunk.id },
                data: { contextualText: blurb },
              });
              teacherCtx.contextualisedChunks += 1;
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn(
                `[contextualize][teacher] persist failed for ${chunk.id}: ${(err as Error).message}`,
              );
              teacherCtx.skippedChunks += 1;
              continue;
            }
            // Re-embed under `contextualText + content`.
            try {
              const embedResult = await embeddingService.callEmbeddingForUser(
                course.teacherId,
                [`${blurb}\n\n${chunk.content}`],
              );
              await prisma.documentChunk.update({
                where: { id: chunk.id },
                data: {
                  embedding: embedResult.vectors[0] as unknown as Prisma.InputJsonValue,
                  embeddingModel: embedResult.model,
                  embeddingDimensions: embedResult.dimensions,
                },
              });
              teacherCtx.reembeddedChunks += 1;
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn(
                `[contextualize][teacher] re-embed failed for ${chunk.id}: ${(err as Error).message}`,
              );
            }
          }
        }
        if (teacherCtx.examinedDocs > 0) ctxStats.push(teacherCtx);

        // Student corpus: same shape over `studentSourceDocument` /
        // `studentRagChunk`.
        const studentDocs = await prisma.studentSourceDocument.findMany({
          where: {
            courseId: course.id,
            chunks: { some: { contextualText: null } },
          },
          select: { id: true, originalName: true },
        });

        const studentCtx: ContextualizeStats = {
          teacherId: course.teacherId,
          courseId: course.id,
          examinedDocs: studentDocs.length,
          contextualisedChunks: 0,
          skippedChunks: 0,
          reembeddedChunks: 0,
        };

        for (const doc of studentDocs) {
          const allChunks = await prisma.studentRagChunk.findMany({
            where: { documentId: doc.id },
            orderBy: { chunkIndex: 'asc' },
            select: { id: true, content: true, contextualText: true },
          });
          if (allChunks.length === 0) continue;
          const fullDocText = allChunks.map((c) => c.content).join('\n\n');

          // eslint-disable-next-line no-console
          console.log(
            `[contextualize][student] course=${course.id} doc=${doc.id} name=${doc.originalName} chunks=${allChunks.length}`,
          );

          for (const chunk of allChunks) {
            if (chunk.contextualText) continue; // idempotent
            if (args.dryRun) {
              studentCtx.skippedChunks += 1;
              continue;
            }
            let blurb = '';
            try {
              blurb = await contextualizeService.contextualizeChunk(
                fullDocText,
                chunk.content,
                {
                  teacherId: course.teacherId,
                  documentTitle: doc.originalName,
                  usageContext: {
                    feature: 'rag.contextualize.student.backfill',
                    courseId: course.id,
                  },
                },
              );
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn(
                `[contextualize][student] chunk ${chunk.id} threw: ${(err as Error).message}`,
              );
              studentCtx.skippedChunks += 1;
              continue;
            }
            if (!blurb) {
              studentCtx.skippedChunks += 1;
              continue;
            }
            try {
              await prisma.studentRagChunk.update({
                where: { id: chunk.id },
                data: { contextualText: blurb },
              });
              studentCtx.contextualisedChunks += 1;
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn(
                `[contextualize][student] persist failed for ${chunk.id}: ${(err as Error).message}`,
              );
              studentCtx.skippedChunks += 1;
              continue;
            }
            try {
              const embedResult = await embeddingService.callEmbeddingForUser(
                course.teacherId,
                [`${blurb}\n\n${chunk.content}`],
              );
              await prisma.studentRagChunk.update({
                where: { id: chunk.id },
                data: {
                  embedding: embedResult.vectors[0] as unknown as Prisma.InputJsonValue,
                  embeddingModel: embedResult.model,
                  embeddingDimensions: embedResult.dimensions,
                },
              });
              studentCtx.reembeddedChunks += 1;
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn(
                `[contextualize][student] re-embed failed for ${chunk.id}: ${(err as Error).message}`,
              );
            }
          }
        }
        if (studentCtx.examinedDocs > 0) ctxStats.push(studentCtx);
      }

      // ── Stage 05 — Multimodal backfill pass ──
      // For each PDF source/student doc with NO existing page_image
      // chunks, call the public backfill helper on the relevant
      // service. Idempotent + triple-defensive: each backfill helper
      // catches its own errors and returns 0 on failure.
      if (args.multimodal) {
        // Teacher corpus.
        const teacherPdfDocs = await prisma.sourceDocument.findMany({
          where: {
            courseId: course.id,
            mimeType: 'application/pdf',
            // SKIP docs that already have at least one page_image chunk.
            NOT: { chunks: { some: { chunkKind: 'page_image' } } },
          },
          select: { id: true, title: true },
        });

        const teacherMm: MultimodalStats = {
          teacherId: course.teacherId,
          courseId: course.id,
          examinedDocs: teacherPdfDocs.length,
          pageImageChunksCreated: 0,
          skippedDocs: 0,
        };

        for (const doc of teacherPdfDocs) {
          if (args.dryRun) {
            teacherMm.skippedDocs += 1;
            // eslint-disable-next-line no-console
            console.log(
              `[multimodal][teacher][dry] course=${course.id} doc=${doc.id} title=${doc.title}`,
            );
            continue;
          }
          // eslint-disable-next-line no-console
          console.log(
            `[multimodal][teacher] course=${course.id} doc=${doc.id} title=${doc.title} — rasterizing`,
          );
          const created = await ragService.backfillTeacherMultimodal(doc.id);
          teacherMm.pageImageChunksCreated += created;
          if (created === 0) teacherMm.skippedDocs += 1;
        }
        if (teacherMm.examinedDocs > 0) mmStats.push(teacherMm);

        // Student corpus — same shape, separate helper.
        const studentPdfDocs = await prisma.studentSourceDocument.findMany({
          where: {
            courseId: course.id,
            mimeType: 'application/pdf',
            NOT: { chunks: { some: { chunkKind: 'page_image' } } },
          },
          select: { id: true, originalName: true },
        });

        const studentMm: MultimodalStats = {
          teacherId: course.teacherId,
          courseId: course.id,
          examinedDocs: studentPdfDocs.length,
          pageImageChunksCreated: 0,
          skippedDocs: 0,
        };

        for (const doc of studentPdfDocs) {
          if (args.dryRun) {
            studentMm.skippedDocs += 1;
            // eslint-disable-next-line no-console
            console.log(
              `[multimodal][student][dry] course=${course.id} doc=${doc.id} name=${doc.originalName}`,
            );
            continue;
          }
          // eslint-disable-next-line no-console
          console.log(
            `[multimodal][student] course=${course.id} doc=${doc.id} name=${doc.originalName} — rasterizing`,
          );
          const created = await studentRagService.backfillStudentMultimodal(doc.id);
          studentMm.pageImageChunksCreated += created;
          if (created === 0) studentMm.skippedDocs += 1;
        }
        if (studentMm.examinedDocs > 0) mmStats.push(studentMm);
      }
    }

    return { embedStats: stats, ctxStats, mmStats };
  } finally {
    await app.close();
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    // eslint-disable-next-line no-console
    console.log(helpText());
    return 0;
  }

  const { embedStats, ctxStats, mmStats } = await run(args);

  let totalExamined = 0;
  let totalReembedded = 0;
  let totalFailures = 0;
  for (const s of embedStats) {
    totalExamined += s.examinedChunks;
    totalReembedded += s.reembeddedChunks;
    totalFailures += s.skippedFailureBatches;
  }

  let ctxExaminedDocs = 0;
  let ctxContextualised = 0;
  let ctxSkipped = 0;
  let ctxReembedded = 0;
  for (const s of ctxStats) {
    ctxExaminedDocs += s.examinedDocs;
    ctxContextualised += s.contextualisedChunks;
    ctxSkipped += s.skippedChunks;
    ctxReembedded += s.reembeddedChunks;
  }

  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('─── reindex-embeddings — summary ───');
  // eslint-disable-next-line no-console
  console.log(`  [embed pass] rows examined         : ${totalExamined}`);
  // eslint-disable-next-line no-console
  console.log(`  [embed pass] rows re-embedded      : ${totalReembedded}`);
  // eslint-disable-next-line no-console
  console.log(`  [embed pass] failed batches        : ${totalFailures}`);
  if (args.contextualize) {
    // eslint-disable-next-line no-console
    console.log(`  [ctx pass]   docs examined         : ${ctxExaminedDocs}`);
    // eslint-disable-next-line no-console
    console.log(`  [ctx pass]   chunks contextualised : ${ctxContextualised}`);
    // eslint-disable-next-line no-console
    console.log(`  [ctx pass]   chunks re-embedded    : ${ctxReembedded}`);
    // eslint-disable-next-line no-console
    console.log(`  [ctx pass]   chunks skipped/failed : ${ctxSkipped}`);
  }
  let mmExaminedDocs = 0;
  let mmCreated = 0;
  let mmSkipped = 0;
  for (const s of mmStats) {
    mmExaminedDocs += s.examinedDocs;
    mmCreated += s.pageImageChunksCreated;
    mmSkipped += s.skippedDocs;
  }
  if (args.multimodal) {
    // eslint-disable-next-line no-console
    console.log(`  [mm pass]    docs examined         : ${mmExaminedDocs}`);
    // eslint-disable-next-line no-console
    console.log(`  [mm pass]    page_image chunks new : ${mmCreated}`);
    // eslint-disable-next-line no-console
    console.log(`  [mm pass]    docs skipped/empty    : ${mmSkipped}`);
  }
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(
    args.dryRun
      ? 'DRY-RUN: no rows mutated. Re-run without --dry-run to apply.'
      : totalReembedded === 0 && ctxContextualised === 0 && mmCreated === 0
        ? 'No rows changed — re-running this script is a no-op.'
        : 'Done. Re-running is safe (idempotent).',
  );

  return totalFailures > 0 ? 2 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('reindex-embeddings FAILED:', err);
    process.exitCode = 1;
  });
