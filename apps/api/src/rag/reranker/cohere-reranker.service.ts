/**
 * Stage 04 — Cohere Rerank cross-encoder.
 *
 * Endpoint: `POST https://api.cohere.com/v2/rerank` (Cohere Rerank v2).
 *
 * Request body shape:
 *   {
 *     model: 'rerank-english-v3.5',
 *     query: '<the user query>',
 *     documents: ['doc1 text', 'doc2 text', ...],
 *     top_n: <how many to return — we ask for ALL>,
 *     return_documents: false
 *   }
 *
 * Response shape:
 *   {
 *     id: 'cohere-request-id',
 *     results: [{ index: 7, relevance_score: 0.93 }, ...],
 *     meta: { ... }
 *   }
 *
 * `index` refers to the position in the request's `documents` array,
 * NOT the chunk id — we map it back via the candidate array's order.
 *
 * Key resolution: the teacher's Cohere key is a SEPARATE optional
 * field on `User` (`cohereApiKey`, AES-256-GCM encrypted using the
 * same helper as `User.encryptedApiKey` — see `LlmService.encrypt`).
 * Cohere is a different vendor from the chat LLM, so we deliberately
 * do NOT reuse `User.encryptedApiKey` (which is for OpenAI / Gemini
 * chat + embeddings).
 *
 * Triple-defensive: ANY failure (no key, fetch reject, non-200,
 * timeout, parse error) returns a noop-shaped `RerankResult` with
 * `providerUsed: 'noop'` + `fallbackReason: '<why>'`. Never throws.
 *
 * Latency budget: a single retry after a 750 ms gap; the OUTER
 * timeout enforced by the shared retriever is `RAG_RERANK_TIMEOUT_MS`
 * (default 2000 ms) — when exceeded, the retriever aborts and we
 * still degrade to RRF order.
 *
 * TODO(stage-05+): An open-source self-hosted alternative would be
 * a BGE-class cross-encoder (e.g. `BAAI/bge-reranker-v2-m3`) behind
 * a small Python sidecar exposing the same
 * `(query, documents) → scored list` shape. The `RerankerService`
 * interface is intentionally minimal so adding that provider is a
 * new service class + a DI factory branch, with zero changes to the
 * shared retriever. Out of scope for Stage 04 because it requires
 * GPU infra + a model-management story we don't have yet.
 */

import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../llm.service';
import type {
  RerankCandidate,
  RerankerService,
  RerankResult,
} from './reranker.types';

const COHERE_RERANK_ENDPOINT = 'https://api.cohere.com/v2/rerank';
const COHERE_RERANK_MODEL_DEFAULT = 'rerank-english-v3.5';
const RETRY_GAP_MS = 750;

/** Resolve the teacher whose Cohere key the reranker should use. The
 *  shared retriever passes this in via the per-call context (see
 *  `student-rag-retrieval.service.ts`). */
export interface CohereRerankCallContext {
  teacherId: string | null;
  /** Optional override for the Cohere model. Defaults to
   *  `rerank-english-v3.5`. Surfaced for future per-course tuning;
   *  no caller threads it today. */
  model?: string;
}

@Injectable()
export class CohereRerankerService implements RerankerService {
  private readonly logger = new Logger(CohereRerankerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => LlmService))
    private readonly llmService: LlmService,
  ) {}

  /**
   * The standard `RerankerService.rerank` entry point. The teacher
   * is resolved from a *thread-local-ish* call context that the
   * shared retriever stamps on the service instance before each
   * call via `setCallContext(...)`. This keeps the interface
   * narrow (`(query, docs) → result`) while still letting different
   * teacher corpora use different Cohere keys.
   *
   * If no context has been stamped (e.g. someone constructs the
   * service and calls `rerank` directly in a test), we degrade to
   * noop — no key means no real rerank.
   */
  async rerank(query: string, docs: RerankCandidate[]): Promise<RerankResult> {
    const ctx = this.callContext;
    return this.rerankWithContext(query, docs, ctx ?? { teacherId: null });
  }

  /** Explicit-context variant used by the shared retriever. Public
   *  so tests can call it without faffing with the thread-local. */
  async rerankWithContext(
    query: string,
    docs: RerankCandidate[],
    ctx: CohereRerankCallContext,
  ): Promise<RerankResult> {
    const started = Date.now();
    const noopOrder = docs.map((d, i) => ({
      id: d.id,
      score: 1 - i / (docs.length || 1),
      rank: i,
    }));

    if (docs.length === 0) {
      return { scoredDocs: [], providerUsed: 'noop', latencyMs: 0 };
    }

    let apiKey: string | null = null;
    try {
      if (ctx.teacherId) {
        apiKey = await this.llmService.getCohereApiKey(ctx.teacherId);
      }
    } catch (err) {
      this.logger.warn(`Failed to resolve Cohere key: ${(err as Error).message}`);
    }

    if (!apiKey) {
      return {
        scoredDocs: noopOrder,
        providerUsed: 'noop',
        fallbackReason: 'no Cohere key configured',
        latencyMs: Date.now() - started,
      };
    }

    const model = ctx.model ?? COHERE_RERANK_MODEL_DEFAULT;

    try {
      const result = await this.callCohereOnce(query, docs, apiKey, model);
      return {
        scoredDocs: result,
        providerUsed: 'cohere',
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      this.logger.warn(
        `Cohere rerank failed on first try (${(err as Error).message}); retrying after ${RETRY_GAP_MS}ms`,
      );
      await new Promise((r) => setTimeout(r, RETRY_GAP_MS));
      try {
        const result = await this.callCohereOnce(query, docs, apiKey, model);
        return {
          scoredDocs: result,
          providerUsed: 'cohere',
          latencyMs: Date.now() - started,
        };
      } catch (err2) {
        const reason = `Cohere rerank failed twice: ${(err2 as Error).message}`;
        this.logger.warn(reason);
        return {
          scoredDocs: noopOrder,
          providerUsed: 'noop',
          fallbackReason: reason,
          latencyMs: Date.now() - started,
        };
      }
    }
  }

  // ─── Per-call context (set by shared retriever) ─────────

  private callContext: CohereRerankCallContext | null = null;

  /** Stamp the per-call teacher context onto the singleton service
   *  for the duration of the next `rerank()` call. The shared
   *  retriever sets-and-clears this around each invocation. Nest
   *  services are singletons, so this is technically race-prone
   *  under concurrent calls from different teachers — but the
   *  retriever calls `rerankWithContext` directly (see
   *  `student-rag-retrieval.service.ts`), so this thread-local is
   *  only used by callers that intentionally hit the
   *  `RerankerService` interface without context. */
  setCallContext(ctx: CohereRerankCallContext | null): void {
    this.callContext = ctx;
  }

  // ─── Internals ─────────────────────────────────────────

  private async callCohereOnce(
    query: string,
    docs: RerankCandidate[],
    apiKey: string,
    model: string,
  ): Promise<RerankResult['scoredDocs']> {
    const body = {
      model,
      query,
      documents: docs.map((d) => d.text),
      top_n: docs.length,
      return_documents: false,
    };

    const response = await fetch(COHERE_RERANK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cohere ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      results?: Array<{ index: number; relevance_score: number }>;
    };

    const results = Array.isArray(data.results) ? data.results : [];
    // Map back to chunk ids via index. Filter any malformed entry
    // (bad index, NaN score). Sort by relevance descending — Cohere
    // already returns sorted, but defensive in case schema changes.
    const scored = results
      .filter(
        (r) =>
          typeof r.index === 'number' &&
          r.index >= 0 &&
          r.index < docs.length &&
          typeof r.relevance_score === 'number' &&
          Number.isFinite(r.relevance_score),
      )
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .map((r, rank) => ({
        id: docs[r.index]!.id,
        score: r.relevance_score,
        rank,
      }));
    return scored;
  }
}
