import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService, PSEUDO_EMBEDDING_MODEL } from './embedding.service';
import { Prisma } from '@prisma/client';
import { getEmbeddingModel } from '../llm/model-registry';
import { CohereRerankerService } from '../rag/reranker/cohere-reranker.service';
import { NoopRerankerService } from '../rag/reranker/noop-reranker.service';
import {
  rerankEnabled,
  rerankCandidateK,
  rerankTimeoutMs,
  rrfModalityWeights,
} from '../rag/reranker/reranker.flags';
import type { RerankCandidate, RerankResult } from '../rag/reranker/reranker.types';

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  content: string;
  pageNumber: number | null;
  score: number;
  metadata: Record<string, unknown>;
  /** Stage 03 — context blurb available for the reranker. Not shown
   *  to the generator (still cite `content` only). Falls back to
   *  null when contextual retrieval is off or this chunk pre-dates
   *  Stage 03's backfill. */
  contextualText?: string | null;
  /** Stage 04 forward-looking — modality this chunk represents.
   *  Used by the per-modality RRF weight. Defaults to `'text'`;
   *  Stage 05 will introduce `'image'` chunks. */
  modality?: 'text' | 'image';
}

/**
 * Stage 02 result wrapper. Surfaces retrieval-quality signals alongside
 * the chunks themselves:
 *  - `mixedIndexChunkCount`: how many chunks in the corpus disagree on
 *    `(embeddingModel, embeddingDim)`. > 0 implies a re-index is
 *    recommended (run `prisma/scripts/reindex-embeddings.ts`).
 *  - `degradedRetrieval`: true if ANY chunk was written under the
 *    SHA256 pseudo-vector fallback (`embeddingModel === 'sha256-pseudo'`),
 *    so the consumer can warn the user that retrieval is keyword-noise.
 *  - `usedDenseRetrieval`: false means the corpus has no embeddings at
 *    all and we served keyword-only. Distinct from `degradedRetrieval`
 *    (which is "embeddings exist but are pseudo").
 */
export interface RetrievalMeta {
  mixedIndexChunkCount: number;
  degradedRetrieval: boolean;
  usedDenseRetrieval: boolean;
  /** Distinct `(model, dim)` tuples observed in the corpus. */
  pinnedSpecs: Array<{ model: string; dim: number; chunkCount: number }>;
  /** Stage 04 — true iff the cross-encoder reranker actually ran
   *  AND its output was used. False whenever we returned RRF order
   *  (no Cohere key, flag off, provider failure, timeout). The
   *  Coverage panel should surface this like `degradedRetrieval`. */
  reranked: boolean;
  /** Which reranker ran. `'cohere'` on success, `'noop'` when the
   *  identity fallback was used. Undefined when the rerank stage
   *  was never invoked (flag off → no candidateK widening either). */
  rerankerProvider?: 'cohere' | 'noop' | string;
  /** Wall-clock latency of the rerank call in ms. Undefined when no
   *  rerank happened. Logged at `[rerank] provider=cohere
   *  candidates=N latencyMs=M`. */
  rerankerLatencyMs?: number;
  /** When `reranked === false` but the reranker WAS supposed to run
   *  (flag on, candidate set non-empty), explains why we fell back.
   *  Example: `'no Cohere key configured'`,
   *  `'Cohere rerank failed twice: <error>'`,
   *  `'rerank exceeded timeout 2000ms'`. */
  rerankerFallbackReason?: string;
  /** Stage 04 — candidate count fed into the reranker. Undefined
   *  when no rerank happened. Useful for ops dashboards comparing
   *  candidateK against the final topK. */
  candidateK?: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  meta: RetrievalMeta;
}

// Common English stopwords to filter from sparse search
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'can',
  'shall',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'between',
  'out',
  'off',
  'over',
  'under',
  'again',
  'further',
  'then',
  'once',
  'here',
  'there',
  'when',
  'where',
  'why',
  'how',
  'all',
  'each',
  'every',
  'both',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  'just',
  'because',
  'but',
  'and',
  'or',
  'if',
  'while',
  'about',
  'up',
  'it',
  'its',
  'this',
  'that',
  'what',
  'which',
  'who',
  'whom',
  'these',
  'those',
  'i',
  'me',
  'my',
  'we',
  'our',
  'you',
  'your',
  'he',
  'him',
  'his',
  'she',
  'her',
  'they',
  'them',
  'their',
]);

const RRF_K = 60;

@Injectable()
export class StudentRagRetrievalService {
  private readonly logger = new Logger(StudentRagRetrievalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
    /** Stage 04 — both rerankers are injected so the per-call
     *  selection (cohere when key + flag, noop otherwise) lives in
     *  this service rather than at module-wiring time. Optional
     *  with a `?` so the legacy 2-arg test instantiation
     *  (`new StudentRagRetrievalService(prisma, embedding)`)
     *  continues to work — when undefined, `pickReranker()` falls
     *  through to an inline noop. */
    private readonly cohereReranker?: CohereRerankerService,
    private readonly noopReranker?: NoopRerankerService,
  ) {}

  /**
   * Back-compat entry point. Returns the chunk list only — the existing
   * `retrieve` signature predates Stage 02's `RetrievalMeta`. New
   * callers should use `retrieveWithMeta`.
   */
  async retrieve(
    query: string,
    studentId: string,
    courseId: string,
    activeSourceIds: string[],
    topK: number,
    apiKey: string,
    provider: string,
    teacherId?: string,
  ): Promise<RetrievedChunk[]> {
    const { chunks } = await this.retrieveWithMeta(
      query,
      studentId,
      courseId,
      activeSourceIds,
      topK,
      apiKey,
      provider,
      teacherId,
    );
    return chunks;
  }

  /**
   * Stage 02 entry point. Returns the chunk list plus retrieval-quality
   * metadata: mixed-index count (re-index warning), degraded-retrieval
   * flag (SHA256 pseudo-embeddings in use), and the per-pin spec
   * breakdown of the corpus.
   */
  async retrieveWithMeta(
    query: string,
    studentId: string,
    courseId: string,
    activeSourceIds: string[],
    topK: number,
    apiKey: string,
    provider: string,
    teacherId?: string,
  ): Promise<RetrievalResult> {
    if (activeSourceIds.length === 0) {
      return {
        chunks: [],
        meta: {
          mixedIndexChunkCount: 0,
          degradedRetrieval: false,
          usedDenseRetrieval: false,
          pinnedSpecs: [],
          reranked: false,
        },
      };
    }

    // Stage 04: retrieve-wide → rerank → top-k. When `RAG_RERANK` is
    // off, `candidateK` collapses to `topK` and the rerank stage is
    // skipped — output is byte-identical to Stage 03.
    const candidateK = rerankEnabled() ? Math.max(rerankCandidateK(), topK) : topK;

    // Run dense and sparse retrieval in parallel. The wider candidate
    // window flows through both fans so the reranker sees the full
    // RRF-merged set, not just the dense top.
    const [denseOut, sparseResults] = await Promise.all([
      this.denseRetrievalWithMeta(
        query,
        studentId,
        courseId,
        activeSourceIds,
        candidateK * 2,
        apiKey,
        provider,
        teacherId,
      ),
      this.sparseRetrieval(query, studentId, courseId, activeSourceIds, candidateK),
    ]);

    // Merge with Reciprocal Rank Fusion. Stage 04 — per-modality
    // weights threaded through (inert today, all chunks are text).
    const merged = this.reciprocalRankFusion(denseOut.chunks, sparseResults, candidateK);

    // Fetch document names for the results
    const docIds = [...new Set(merged.map((r) => r.documentId))];
    const docs = await this.prisma.studentSourceDocument.findMany({
      where: { id: { in: docIds } },
      select: { id: true, originalName: true },
    });
    const docNameMap = new Map(docs.map((d) => [d.id, d.originalName]));

    // Deduplicate by content similarity BEFORE the reranker so the
    // model isn't burning its candidate budget on near-duplicates.
    const deduped = this.deduplicateChunks(merged).slice(0, candidateK);

    // Stage 04: rerank stage. When the flag is off OR no candidates
    // were retrieved, this returns the input order unchanged with
    // `reranked: false`.
    const rerankOut = await this.runRerank(query, deduped, teacherId ?? null);

    // The reranker returned chunks already sliced to `topK`. Attach
    // document names + the combined retrieval meta.
    return {
      chunks: rerankOut.chunks.slice(0, topK).map((r) => ({
        ...r,
        documentName: docNameMap.get(r.documentId) || 'Unknown',
      })),
      meta: {
        ...denseOut.meta,
        reranked: rerankOut.reranked,
        rerankerProvider: rerankOut.providerUsed,
        rerankerLatencyMs: rerankOut.latencyMs,
        rerankerFallbackReason: rerankOut.fallbackReason,
        candidateK: rerankOut.candidateK,
      },
    };
  }

  // ─── Dense Retrieval (Embedding Similarity) ─────────────
  //
  // Stage 3 retrieval guard: chunk embeddings are pinned per-corpus to a
  // (model, dimensions) tuple at index time. Mixing dim/model across a
  // cosine corpus silently corrupts results. We therefore:
  //  1. Read the pinned (embeddingModel, embeddingDimensions) from each
  //     chunk row.
  //  2. Group chunks by that pinned tuple.
  //  3. Embed the query ONCE per distinct tuple, using that tuple's spec
  //     (re-resolving the teacher key + provider). When the teacher has
  //     since changed providers, the corpus continues to be served with
  //     its old pinned model until the background re-embed worker
  //     finishes (option (b) from the Stage 3 spec).
  //  4. Cosine on each group separately, then merge by raw score.

  /** Stage 02 dense retrieval, returns retrieval-quality meta alongside
   *  the scored chunks. The pre-existing `denseRetrieval` is preserved
   *  below as a back-compat helper for any external caller that still
   *  imports it by name (none in tree today; defensive). */
  private async denseRetrievalWithMeta(
    query: string,
    studentId: string,
    courseId: string,
    activeSourceIds: string[],
    limit: number,
    apiKey: string,
    provider: string,
    teacherId?: string,
  ): Promise<{ chunks: RetrievedChunk[]; meta: RetrievalMeta }> {
    const emptyMeta: RetrievalMeta = {
      mixedIndexChunkCount: 0,
      degradedRetrieval: false,
      usedDenseRetrieval: false,
      pinnedSpecs: [],
      reranked: false,
    };
    try {
      const chunks = await this.prisma.studentRagChunk.findMany({
        where: {
          studentId,
          courseId,
          documentId: { in: activeSourceIds },
          embedding: { not: Prisma.JsonNull },
        },
        select: {
          id: true,
          documentId: true,
          content: true,
          pageNumber: true,
          metadata: true,
          embedding: true,
          embeddingModel: true,
          embeddingDimensions: true,
          // Stage 04 — pass through the contextualisation blurb so the
          // reranker can score `contextualText + content` (same signal
          // the embedder saw). Bare content is still served to the
          // generator; this is a retrieval-only aid.
          contextualText: true,
          // Stage 05 — surface chunk_kind so the per-modality RRF
          // weight kicks in (text/image bucketing in
          // `reciprocalRankFusion`). NULL ⇒ implicit 'text'.
          chunkKind: true,
          caption: true,
        },
      });

      if (chunks.length === 0) return { chunks: [], meta: emptyMeta };

      // Group by pinned (model, dim). Chunks without a pin (legacy rows
      // before the Stage 2 migration backfill ran) get bucketed under
      // the legacy default so retrieval still works for them.
      const groups = new Map<string, typeof chunks>();
      for (const c of chunks) {
        const key = `${c.embeddingModel ?? 'text-embedding-ada-002'}|${
          c.embeddingDimensions ?? 1536
        }`;
        const arr = groups.get(key) ?? [];
        arr.push(c);
        groups.set(key, arr);
      }

      // ── Stage 02: mixed-index detection ──
      // The "expected" pin is the largest group. Everything else counts
      // as mixed. If only one pin exists, mixedIndexChunkCount === 0.
      const pinnedSpecs: Array<{ model: string; dim: number; chunkCount: number }> = [];
      for (const [key, groupChunks] of groups) {
        const [m, d] = key.split('|');
        pinnedSpecs.push({ model: m!, dim: Number(d), chunkCount: groupChunks.length });
      }
      pinnedSpecs.sort((a, b) => b.chunkCount - a.chunkCount);
      const majorityCount = pinnedSpecs[0]?.chunkCount ?? 0;
      const mixedIndexChunkCount = chunks.length - majorityCount;
      const degradedRetrieval = pinnedSpecs.some((s) => s.model === PSEUDO_EMBEDDING_MODEL);

      if (mixedIndexChunkCount > 0) {
        // Loud warning so operators see this in logs and run the
        // re-index script (`prisma/scripts/reindex-embeddings.ts`).
        // eslint-disable-next-line no-console
        console.warn(
          `[RAG] mixed embedding index — re-index recommended (corpus has ${pinnedSpecs.length} distinct pins, ${mixedIndexChunkCount} minority chunks). Run prisma/scripts/reindex-embeddings.ts to consolidate.`,
        );
      }
      if (degradedRetrieval) {
        // eslint-disable-next-line no-console
        console.warn(
          `[RAG] degraded retrieval — corpus contains SHA256 pseudo-embedding chunks. Configure a teacher LLM key and re-index.`,
        );
      }

      const allScored: RetrievedChunk[] = [];

      for (const [key, groupChunks] of groups) {
        const [pinnedModelId, pinnedDimStr] = key.split('|');
        const pinnedDim = Number(pinnedDimStr);
        const pinnedSpec = getEmbeddingModel(pinnedModelId!);

        let queryEmbedding: number[] | null = null;

        if (pinnedSpec && teacherId) {
          // Preferred path: re-embed the query with the corpus's pinned
          // model via the registry funnel, so dims match.
          try {
            const result = await this.embeddingService.embedWithSpec(
              [query],
              apiKey,
              provider === 'openai' || provider === 'gemini'
                ? (provider as 'openai' | 'gemini')
                : 'fallback',
              pinnedSpec,
              pinnedDim,
            );
            queryEmbedding = result.vectors[0]!;
            // Guard: if the resolved dim still doesn't match (e.g. the
            // provider rejected the requested dim), skip this group
            // rather than silently scoring mixed-dim vectors.
            if (result.dimensions !== pinnedDim) {
              this.logger.warn(
                `Pinned dim ${pinnedDim} for ${pinnedModelId} not honored (got ${result.dimensions}); skipping group`,
              );
              queryEmbedding = null;
            }
          } catch (err) {
            this.logger.warn(
              `Query re-embed for pinned ${pinnedModelId} failed: ${(err as Error).message}`,
            );
          }
        }

        if (!queryEmbedding) {
          // Legacy path: use the caller-passed provider/key directly.
          // Defensive: if `embedOne` itself fails (e.g. no key in prod
          // with pseudo-fallback blocked) we skip this group rather
          // than aborting all of dense retrieval.
          try {
            queryEmbedding = await this.embeddingService.embedOne(query, apiKey, provider);
          } catch (err) {
            this.logger.warn(
              `Legacy query embed failed for group ${pinnedModelId}: ${(err as Error).message}`,
            );
            continue;
          }
        }

        // Cosine within the group.
        for (const chunk of groupChunks) {
          const chunkEmbedding = chunk.embedding as number[];
          if (!Array.isArray(chunkEmbedding) || chunkEmbedding.length === 0) continue;
          if (chunkEmbedding.length !== queryEmbedding.length) {
            // Hard refuse: NEVER cosine across mismatched dims.
            continue;
          }
          const similarity = this.cosineSimilarity(queryEmbedding, chunkEmbedding);
          allScored.push({
            chunkId: chunk.id,
            documentId: chunk.documentId,
            documentName: '',
            content: chunk.content,
            pageNumber: chunk.pageNumber,
            score: similarity,
            metadata: (chunk.metadata as Record<string, unknown>) || {},
            contextualText: chunk.contextualText,
            // Stage 05 — flag modality for the per-modality RRF
            // weight. NULL or 'text' ⇒ text; anything else ⇒ image.
            modality: (chunk.chunkKind && chunk.chunkKind !== 'text'
              ? 'image'
              : 'text') as 'text' | 'image',
          });
        }
      }

      const sorted = allScored.sort((a, b) => b.score - a.score).slice(0, limit);
      return {
        chunks: sorted,
        meta: {
          mixedIndexChunkCount,
          degradedRetrieval,
          usedDenseRetrieval: true,
          pinnedSpecs,
          reranked: false,
        },
      };
    } catch (error) {
      this.logger.error('Dense retrieval failed', error);
      return { chunks: [], meta: emptyMeta };
    }
  }

  // ─── Teacher corpus retrieval (Stage 02) ──────────────
  //
  // Same hybrid (dense + sparse + RRF + dedupe) shape as the student
  // path, but reads from `document_chunks` keyed on courseId. Lets the
  // teacher RAG surface (`RagService.queryChunks`) consume the shared
  // retriever instead of its own keyword scorer.

  async retrieveTeacher(
    query: string,
    courseId: string,
    sourceIds: string[] | null,
    topK: number,
    teacherId: string,
    apiKey: string,
    provider: string,
  ): Promise<RetrievalResult> {
    const emptyMeta: RetrievalMeta = {
      mixedIndexChunkCount: 0,
      degradedRetrieval: false,
      usedDenseRetrieval: false,
      pinnedSpecs: [],
      reranked: false,
    };

    // Stage 04 — retrieve-wide → rerank → top-k on the teacher path
    // too. When `RAG_RERANK` is off, candidateK collapses to topK and
    // behaviour is byte-identical to Stage 03.
    const candidateK = rerankEnabled() ? Math.max(rerankCandidateK(), topK) : topK;

    // Run dense + sparse in parallel.
    const [denseOut, sparseResults] = await Promise.all([
      this.teacherDenseRetrievalWithMeta(
        query,
        courseId,
        sourceIds,
        candidateK * 2,
        apiKey,
        provider,
        teacherId,
      ),
      this.teacherSparseRetrieval(query, courseId, sourceIds, candidateK),
    ]);

    const merged = this.reciprocalRankFusion(denseOut.chunks, sparseResults, candidateK);

    const docIds = [...new Set(merged.map((r) => r.documentId))];
    const docs = await this.prisma.sourceDocument.findMany({
      where: { id: { in: docIds } },
      select: { id: true, title: true },
    });
    const docNameMap = new Map(docs.map((d) => [d.id, d.title]));

    const deduped = this.deduplicateChunks(merged).slice(0, candidateK);

    // Stage 04 — rerank stage. Same triple-defensive contract as the
    // student path: any failure degrades to RRF order with
    // `reranked: false` + a fallback reason in meta.
    const rerankOut = await this.runRerank(query, deduped, teacherId);

    const baseMeta = denseOut.meta.usedDenseRetrieval ? denseOut.meta : emptyMeta;
    return {
      chunks: rerankOut.chunks.slice(0, topK).map((r) => ({
        ...r,
        documentName: docNameMap.get(r.documentId) || 'Unknown',
      })),
      meta: {
        ...baseMeta,
        reranked: rerankOut.reranked,
        rerankerProvider: rerankOut.providerUsed,
        rerankerLatencyMs: rerankOut.latencyMs,
        rerankerFallbackReason: rerankOut.fallbackReason,
        candidateK: rerankOut.candidateK,
      },
    };
  }

  private async teacherDenseRetrievalWithMeta(
    query: string,
    courseId: string,
    sourceIds: string[] | null,
    limit: number,
    apiKey: string,
    provider: string,
    teacherId: string,
  ): Promise<{ chunks: RetrievedChunk[]; meta: RetrievalMeta }> {
    const emptyMeta: RetrievalMeta = {
      mixedIndexChunkCount: 0,
      degradedRetrieval: false,
      usedDenseRetrieval: false,
      pinnedSpecs: [],
      reranked: false,
    };
    try {
      const where: Prisma.DocumentChunkWhereInput = {
        document: { courseId },
        embedding: { not: Prisma.JsonNull },
      };
      if (sourceIds && sourceIds.length > 0) {
        where.documentId = { in: sourceIds };
      }

      const chunks = await this.prisma.documentChunk.findMany({
        where,
        select: {
          id: true,
          documentId: true,
          content: true,
          pageNumber: true,
          embedding: true,
          embeddingModel: true,
          embeddingDimensions: true,
          // Stage 04 — surface the contextualisation blurb to the
          // reranker. Generator-facing payload is `content` only.
          contextualText: true,
          // Stage 05 — surface chunk_kind + caption for the
          // per-modality RRF weight and the sparse haystack.
          chunkKind: true,
          caption: true,
        },
      });

      if (chunks.length === 0) return { chunks: [], meta: emptyMeta };

      const groups = new Map<string, typeof chunks>();
      for (const c of chunks) {
        const key = `${c.embeddingModel ?? 'text-embedding-ada-002'}|${
          c.embeddingDimensions ?? 1536
        }`;
        const arr = groups.get(key) ?? [];
        arr.push(c);
        groups.set(key, arr);
      }

      const pinnedSpecs: Array<{ model: string; dim: number; chunkCount: number }> = [];
      for (const [key, groupChunks] of groups) {
        const [m, d] = key.split('|');
        pinnedSpecs.push({ model: m!, dim: Number(d), chunkCount: groupChunks.length });
      }
      pinnedSpecs.sort((a, b) => b.chunkCount - a.chunkCount);
      const majorityCount = pinnedSpecs[0]?.chunkCount ?? 0;
      const mixedIndexChunkCount = chunks.length - majorityCount;
      const degradedRetrieval = pinnedSpecs.some((s) => s.model === PSEUDO_EMBEDDING_MODEL);

      if (mixedIndexChunkCount > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[RAG] teacher corpus has mixed embedding index — re-index recommended (course=${courseId}, ${pinnedSpecs.length} distinct pins, ${mixedIndexChunkCount} minority chunks)`,
        );
      }
      if (degradedRetrieval) {
        // eslint-disable-next-line no-console
        console.warn(
          `[RAG] teacher corpus has SHA256 pseudo-embedding chunks — retrieval is DEGRADED (course=${courseId})`,
        );
      }

      const allScored: RetrievedChunk[] = [];
      for (const [key, groupChunks] of groups) {
        const [pinnedModelId, pinnedDimStr] = key.split('|');
        const pinnedDim = Number(pinnedDimStr);
        const pinnedSpec = getEmbeddingModel(pinnedModelId!);

        let queryEmbedding: number[] | null = null;
        if (pinnedSpec) {
          try {
            const result = await this.embeddingService.embedWithSpec(
              [query],
              apiKey,
              provider === 'openai' || provider === 'gemini'
                ? (provider as 'openai' | 'gemini')
                : 'fallback',
              pinnedSpec,
              pinnedDim,
            );
            queryEmbedding = result.vectors[0]!;
            if (result.dimensions !== pinnedDim) {
              this.logger.warn(
                `Teacher pinned dim ${pinnedDim} for ${pinnedModelId} not honored; skipping group`,
              );
              queryEmbedding = null;
            }
          } catch (err) {
            this.logger.warn(
              `Teacher re-embed for pinned ${pinnedModelId} failed: ${(err as Error).message}`,
            );
          }
        }

        if (!queryEmbedding) {
          try {
            queryEmbedding = await this.embeddingService.embedOne(query, apiKey, provider);
          } catch (err) {
            this.logger.warn(
              `Teacher legacy query embed failed for group ${pinnedModelId}: ${(err as Error).message}`,
            );
            continue;
          }
        }
        // Use the (small) extra hint: prefer reading the teacherId
        // through to satisfy lint (the funnel surface already knows
        // about it via apiKey+provider but we keep the field on the
        // signature for parity with the student retriever).
        void teacherId;

        for (const chunk of groupChunks) {
          const chunkEmbedding = chunk.embedding as number[];
          if (!Array.isArray(chunkEmbedding) || chunkEmbedding.length === 0) continue;
          if (chunkEmbedding.length !== queryEmbedding.length) continue;
          const similarity = this.cosineSimilarity(queryEmbedding, chunkEmbedding);
          allScored.push({
            chunkId: chunk.id,
            documentId: chunk.documentId,
            documentName: '',
            content: chunk.content,
            pageNumber: chunk.pageNumber,
            score: similarity,
            metadata: {},
            contextualText: chunk.contextualText,
            // Stage 05 — modality stamp for the per-modality RRF
            // weight.
            modality: (chunk.chunkKind && chunk.chunkKind !== 'text'
              ? 'image'
              : 'text') as 'text' | 'image',
          });
        }
      }

      return {
        chunks: allScored.sort((a, b) => b.score - a.score).slice(0, limit),
        meta: {
          mixedIndexChunkCount,
          degradedRetrieval,
          usedDenseRetrieval: true,
          pinnedSpecs,
          reranked: false,
        },
      };
    } catch (err) {
      this.logger.error('Teacher dense retrieval failed', err);
      return { chunks: [], meta: emptyMeta };
    }
  }

  private async teacherSparseRetrieval(
    query: string,
    courseId: string,
    sourceIds: string[] | null,
    limit: number,
  ): Promise<RetrievedChunk[]> {
    try {
      const terms = query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((t) => t.length > 2 && !STOPWORDS.has(t));
      if (terms.length === 0) return [];

      // Stage 03 — Contextual Retrieval: a term that hits EITHER the
      // raw chunk content OR the contextualisation blurb counts as a
      // match. We OR over both columns at the DB filter level so the
      // lexical index actually surfaces context-only matches (the
      // original method's ~35% → ~49% failure-reduction lift).
      // Stage 05 — the VLM caption on `page_image` / `figure` chunks
      // joins the OR-haystack too (secondary signal per spec).
      const where: Prisma.DocumentChunkWhereInput = {
        document: { courseId },
        OR: terms.flatMap((term) => [
          { content: { contains: term, mode: 'insensitive' as const } },
          { contextualText: { contains: term, mode: 'insensitive' as const } },
          { caption: { contains: term, mode: 'insensitive' as const } },
        ]),
      };
      if (sourceIds && sourceIds.length > 0) {
        where.documentId = { in: sourceIds };
      }

      const chunks = await this.prisma.documentChunk.findMany({
        where,
        select: {
          id: true,
          documentId: true,
          content: true,
          pageNumber: true,
          contextualText: true,
          caption: true,
          chunkKind: true,
        },
        take: limit * 3,
      });

      const scored: RetrievedChunk[] = chunks.map((chunk) => {
        // Stage 03 — score the concatenated string so context-only
        // hits get the BM25-ish length-normalised treatment too.
        // Stage 05 — caption joins the haystack.
        const haystack = `${chunk.contextualText ?? ''} ${chunk.caption ?? ''} ${chunk.content}`;
        const haystackLower = haystack.toLowerCase();
        let matchCount = 0;
        for (const term of terms) {
          const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
          const matches = haystackLower.match(regex);
          matchCount += matches ? matches.length : 0;
        }
        const score =
          matchCount / (matchCount + 1.5 * (1 - 0.75 + (0.75 * haystack.length) / 2000));
        return {
          chunkId: chunk.id,
          documentId: chunk.documentId,
          documentName: '',
          // Return the original `content` only — generator must never
          // see the contextualisation blurb (it's a retrieval aid).
          content: chunk.content,
          pageNumber: chunk.pageNumber,
          score,
          metadata: {},
          contextualText: chunk.contextualText,
          // Stage 05 — modality stamp.
          modality: (chunk.chunkKind && chunk.chunkKind !== 'text'
            ? 'image'
            : 'text') as 'text' | 'image',
        };
      });

      return scored.sort((a, b) => b.score - a.score).slice(0, limit);
    } catch (err) {
      this.logger.error('Teacher sparse retrieval failed', err);
      return [];
    }
  }

  /** Legacy back-compat helper. Returns the chunk list only. */
  private async denseRetrieval(
    query: string,
    studentId: string,
    courseId: string,
    activeSourceIds: string[],
    limit: number,
    apiKey: string,
    provider: string,
    teacherId?: string,
  ): Promise<RetrievedChunk[]> {
    const out = await this.denseRetrievalWithMeta(
      query,
      studentId,
      courseId,
      activeSourceIds,
      limit,
      apiKey,
      provider,
      teacherId,
    );
    return out.chunks;
  }

  // ─── Sparse Retrieval (BM25-like keyword search) ────────

  private async sparseRetrieval(
    query: string,
    studentId: string,
    courseId: string,
    activeSourceIds: string[],
    limit: number,
  ): Promise<RetrievedChunk[]> {
    try {
      // Extract key terms from query
      const terms = query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((t) => t.length > 2 && !STOPWORDS.has(t));

      if (terms.length === 0) return [];

      // Build ILIKE conditions for each term — Stage 03 also matches
      // against `contextual_text` so context-only hits surface in the
      // lexical scan, not just the dense scan. Stage 05 also matches
      // against `caption` so the VLM-generated description of a
      // `page_image` / `figure` chunk surfaces for figure-targeted
      // queries (the SECONDARY-signal role per Stage 05 spec — the
      // caption never goes to the generator, just feeds retrieval).
      const chunks = await this.prisma.studentRagChunk.findMany({
        where: {
          studentId,
          courseId,
          documentId: { in: activeSourceIds },
          OR: terms.flatMap((term) => [
            { content: { contains: term, mode: 'insensitive' as const } },
            { contextualText: { contains: term, mode: 'insensitive' as const } },
            { caption: { contains: term, mode: 'insensitive' as const } },
          ]),
        },
        select: {
          id: true,
          documentId: true,
          content: true,
          pageNumber: true,
          metadata: true,
          contextualText: true,
          // Stage 05 — surface caption and chunk_kind so the retriever
          // can stamp modality on the result (RRF per-modality weight)
          // and the BM25-ish scorer can score the caption haystack.
          caption: true,
          chunkKind: true,
        },
        take: limit * 3, // Fetch more for ranking
      });

      // Score by term frequency (simple BM25-like scoring) over the
      // contextualText + caption + content haystack.
      const scored = chunks.map((chunk) => {
        const haystack = `${chunk.contextualText ?? ''} ${chunk.caption ?? ''} ${chunk.content}`;
        const haystackLower = haystack.toLowerCase();
        let matchCount = 0;
        for (const term of terms) {
          const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
          const matches = haystackLower.match(regex);
          matchCount += matches ? matches.length : 0;
        }
        // Normalize by combined-text length (BM25-like)
        const score =
          matchCount / (matchCount + 1.5 * (1 - 0.75 + (0.75 * haystack.length) / 2000));

        return {
          chunkId: chunk.id,
          documentId: chunk.documentId,
          documentName: '',
          // Generator-facing payload is the original `content` only;
          // the contextualisation blurb is a retrieval aid.
          content: chunk.content,
          pageNumber: chunk.pageNumber,
          score,
          metadata: (chunk.metadata as Record<string, unknown>) || {},
          // Stage 04 — carry the blurb forward so the reranker can
          // score `contextualText + content` (same signal embeddings
          // saw). The generator never sees this field.
          contextualText: chunk.contextualText,
          // Stage 05 — modality stamp for the per-modality RRF
          // weight. NULL or 'text' ⇒ text; anything else ⇒ image.
          modality: (chunk.chunkKind && chunk.chunkKind !== 'text'
            ? 'image'
            : 'text') as 'text' | 'image',
        };
      });

      return scored.sort((a, b) => b.score - a.score).slice(0, limit);
    } catch (error) {
      this.logger.error('Sparse retrieval failed', error);
      return [];
    }
  }

  // ─── Reciprocal Rank Fusion ─────────────────────────────

  private reciprocalRankFusion(
    denseResults: RetrievedChunk[],
    sparseResults: RetrievedChunk[],
    topK: number,
  ): RetrievedChunk[] {
    // Stage 04 — per-modality weights. Today every candidate is text,
    // so this is a 1.0 multiplier across the board and behaviour is
    // identical to Stage 03. Stage 05 hook: when image chunks land
    // (`chunkKind = 'page_image' | 'figure'`), each candidate's
    // reciprocal-rank contribution is scaled by its modality weight
    // (`RAG_RRF_WEIGHTS_IMAGE` for image, `RAG_RRF_WEIGHTS_TEXT` for
    // text) so the operator can rebalance modalities without code
    // change. The reranker (when on) then arbitrates the merged list.
    const weights = rrfModalityWeights();
    const weightOf = (c: RetrievedChunk): number =>
      c.modality === 'image' ? weights.image : weights.text;

    const scoreMap = new Map<string, { chunk: RetrievedChunk; rrfScore: number }>();

    // Score dense results
    denseResults.forEach((chunk, rank) => {
      const rrfScore = weightOf(chunk) * (1 / (RRF_K + rank + 1));
      const existing = scoreMap.get(chunk.chunkId);
      if (existing) {
        existing.rrfScore += rrfScore;
      } else {
        scoreMap.set(chunk.chunkId, { chunk, rrfScore });
      }
    });

    // Score sparse results
    sparseResults.forEach((chunk, rank) => {
      const rrfScore = weightOf(chunk) * (1 / (RRF_K + rank + 1));
      const existing = scoreMap.get(chunk.chunkId);
      if (existing) {
        existing.rrfScore += rrfScore;
      } else {
        scoreMap.set(chunk.chunkId, { chunk, rrfScore });
      }
    });

    // Sort by RRF score and return
    return Array.from(scoreMap.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, topK * 2)
      .map(({ chunk, rrfScore }) => ({ ...chunk, score: rrfScore }));
  }

  // ─── Stage 04: Rerank stage ─────────────────────────────
  //
  // `runRerank` is the single entry point both `retrieveWithMeta`
  // (student) and `retrieveTeacher` (teacher) call. It encapsulates:
  //   - the flag check (`RAG_RERANK`),
  //   - reranker selection (cohere when teacher has a key, noop
  //     otherwise),
  //   - the outer timeout via `AbortController` (default 2000 ms),
  //   - triple-defensive try/catch — any error degrades to RRF order
  //     with `reranked: false` + `fallbackReason` in the result.
  //
  // The candidate input is the dedup'd RRF output; the candidate text
  // is `contextualText + '\n\n' + content` when the Stage-03 blurb is
  // present, falling back to bare content otherwise. The reranker
  // returns scoredDocs sliced/sorted by relevance; we re-map ids to
  // the original `RetrievedChunk` objects so the generator-facing
  // payload (content, page, citation metadata) is unchanged.

  private async runRerank(
    query: string,
    candidates: RetrievedChunk[],
    teacherId: string | null,
  ): Promise<{
    chunks: RetrievedChunk[];
    reranked: boolean;
    providerUsed?: string;
    latencyMs?: number;
    fallbackReason?: string;
    candidateK?: number;
  }> {
    // Flag off OR empty candidate set → no rerank, no widening. The
    // candidates array IS the final order; caller will slice to topK.
    if (!rerankEnabled() || candidates.length === 0) {
      return { chunks: candidates, reranked: false };
    }

    const candidateK = candidates.length;
    const reranker = this.pickReranker();
    // Inline noop branch: nothing to call, nothing to time out.
    if (reranker.kind === 'noop') {
      return {
        chunks: candidates,
        reranked: false,
        providerUsed: 'noop',
        latencyMs: 0,
        fallbackReason: 'no Cohere key configured',
        candidateK,
      };
    }

    // Build the (id, text) pairs the reranker sees. `contextualText`
    // is prepended when available so the cross-encoder scores the
    // same string the embedder did. Generator-facing payload is
    // unchanged (we re-attach the original chunk by id after
    // ranking).
    const docs: RerankCandidate[] = candidates.map((c) => ({
      id: c.chunkId,
      text: c.contextualText ? `${c.contextualText}\n\n${c.content}` : c.content,
      modality: c.modality ?? 'text',
    }));

    const timeoutMs = rerankTimeoutMs();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const result: RerankResult = await Promise.race([
        reranker.service.rerankWithContext(query, docs, { teacherId }),
        new Promise<never>((_, reject) => {
          ac.signal.addEventListener('abort', () =>
            reject(new Error(`rerank exceeded timeout ${timeoutMs}ms`)),
          );
        }),
      ]);
      clearTimeout(timer);

      if (result.providerUsed !== 'cohere') {
        // Cohere service degraded internally (e.g. no key after all);
        // surface its reason and return the RRF order.
        return {
          chunks: candidates,
          reranked: false,
          providerUsed: result.providerUsed,
          latencyMs: result.latencyMs ?? Date.now() - startedAt,
          fallbackReason: result.fallbackReason ?? 'reranker degraded to noop',
          candidateK,
        };
      }

      // Re-attach the original `RetrievedChunk` objects by id, in the
      // reranker's order. Defensive: any unknown id is dropped; any
      // missing id from the original candidate set is appended at
      // the tail so we never drop chunks the rest of the pipeline
      // expects.
      const byId = new Map(candidates.map((c) => [c.chunkId, c]));
      const seen = new Set<string>();
      const reorderedTop: RetrievedChunk[] = [];
      for (const scored of result.scoredDocs) {
        const orig = byId.get(scored.id);
        if (!orig || seen.has(scored.id)) continue;
        seen.add(scored.id);
        reorderedTop.push({ ...orig, score: scored.score });
      }
      // Append any candidates the reranker dropped, in their original
      // order, so the caller's slice(0, topK) still has enough to
      // serve when the provider returns < N results.
      for (const orig of candidates) {
        if (!seen.has(orig.chunkId)) reorderedTop.push(orig);
      }

      this.logger.log(
        `[rerank] provider=${result.providerUsed} candidates=${candidateK} latencyMs=${result.latencyMs}`,
      );

      return {
        chunks: reorderedTop,
        reranked: true,
        providerUsed: result.providerUsed,
        latencyMs: result.latencyMs ?? Date.now() - startedAt,
        candidateK,
      };
    } catch (err) {
      // Triple-defensive: any throw (timeout, network, parse, DI
      // glitch) degrades to RRF order. NEVER lets the chat call see
      // the error.
      clearTimeout(timer);
      const reason = (err as Error)?.message || 'rerank failed';
      this.logger.warn(`[rerank] degraded to RRF order: ${reason}`);
      return {
        chunks: candidates,
        reranked: false,
        providerUsed: 'noop',
        latencyMs: Date.now() - startedAt,
        fallbackReason: reason,
        candidateK,
      };
    }
  }

  /** Resolve which reranker to invoke for this call.
   *
   *  - `cohere` when both rerankers were injected (i.e. running inside
   *    a real Nest module). Whether Cohere actually scores or noops
   *    internally depends on the teacher's key, which the service
   *    resolves per-call.
   *  - `noop` otherwise — covers the legacy 2-arg test
   *    instantiation, and a future provider could be added here. */
  private pickReranker():
    | { kind: 'cohere'; service: CohereRerankerService }
    | { kind: 'noop' } {
    if (this.cohereReranker) return { kind: 'cohere', service: this.cohereReranker };
    return { kind: 'noop' };
  }

  // ─── Deduplication ──────────────────────────────────────

  private deduplicateChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
    const result: RetrievedChunk[] = [];

    for (const chunk of chunks) {
      const isDuplicate = result.some(
        (existing) => this.contentOverlap(existing.content, chunk.content) > 0.9,
      );
      if (!isDuplicate) {
        result.push(chunk);
      }
    }

    return result;
  }

  private contentOverlap(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    // Use character-level Jaccard similarity for efficiency
    const setA = new Set(a.toLowerCase().split(/\s+/));
    const setB = new Set(b.toLowerCase().split(/\s+/));

    let intersection = 0;
    for (const word of setA) {
      if (setB.has(word)) intersection++;
    }

    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  // ─── Cosine Similarity ──────────────────────────────────

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}
