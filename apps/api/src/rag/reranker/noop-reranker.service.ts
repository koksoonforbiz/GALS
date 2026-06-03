/**
 * Stage 04 — Identity reranker (no-op fallback).
 *
 * Returns the input docs in their original order, with monotonically
 * decreasing scores so downstream sort-by-score keeps RRF order
 * intact. Used in three cases:
 *
 *  1. No Cohere key configured for the teacher (the most common
 *     case until teachers opt in).
 *  2. Global `RAG_RERANK` flag is off (Stage 04 default).
 *  3. The hosted reranker call failed AFTER one retry. The Cohere
 *     reranker's catch handler delegates here so the chat call
 *     never errors on a reranker failure (triple-defensive
 *     contract).
 *
 * `reranked: false` is signalled by `providerUsed: 'noop'` on the
 * result; the shared retriever forwards that onto
 * `RetrievalMeta.reranked` so the Coverage panel can flag it like
 * `degradedRetrieval`.
 */

import { Injectable } from '@nestjs/common';
import type {
  RerankCandidate,
  RerankerService,
  RerankResult,
} from './reranker.types';

@Injectable()
export class NoopRerankerService implements RerankerService {
  async rerank(_query: string, docs: RerankCandidate[]): Promise<RerankResult> {
    // Score is `1 - rank/N` so any downstream sort-by-score keeps
    // the input order. A constant score would tie-break randomly
    // depending on the sort algorithm (V8's is stable but other
    // toolchains aren't, and tests should not rely on that).
    const n = docs.length || 1;
    return {
      scoredDocs: docs.map((d, i) => ({
        id: d.id,
        score: 1 - i / n,
        rank: i,
      })),
      providerUsed: 'noop',
      latencyMs: 0,
    };
  }
}
