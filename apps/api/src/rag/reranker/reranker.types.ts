/**
 * Stage 04 — Cross-encoder reranker interface.
 *
 * The shared retriever (`StudentRagRetrievalService`) now does
 * `retrieve-wide (candidateK) → rerank → topK`. The reranker is
 * **injectable + swappable** so we can plug in:
 *
 *   - `CohereRerankerService` — hosted (Cohere Rerank 3.5), the
 *     default when the teacher has configured a Cohere key.
 *   - `NoopRerankerService` — identity fallback used when no key is
 *     configured, the global feature flag is off, the per-course
 *     `rerankTopK` is unset, or the hosted call fails (after one
 *     retry). Preserves RRF order, marks `reranked: false` so the
 *     Coverage panel can flag it like `degradedRetrieval`.
 *
 *   - (Future) A self-hosted open cross-encoder (BGE-class) behind
 *     a small Python sidecar — interface-level support is here, but
 *     building the sidecar is intentionally out of scope for Stage
 *     04 (see TODO in `cohere-reranker.service.ts`).
 *
 * Triple-defensive contract: implementations MUST NOT throw on
 * provider failures. They must return a `RerankResult` whose
 * `scoredDocs` preserves the input order (i.e. fall back to RRF) and
 * set `providerUsed: 'noop'` + `fallbackReason: '<why>'`. A throw
 * here would surface in the chat call as a hard error, which Stage
 * 04 explicitly forbids.
 */

// (Intentional: no module-level imports required here. The interfaces
//  below stand alone; concrete reranker implementations import this
//  module for the types.)

/** Input document to the reranker. `id` is the chunkId from the
 *  upstream RRF list (so the caller can re-attach it to the
 *  `RetrievedChunk` after scoring). `text` is what the reranker
 *  actually scores against the query — when Stage 03's contextual
 *  retrieval blurb is available, callers concatenate
 *  `contextualText + '\n\n' + content` and pass that here, so the
 *  cross-encoder sees the same context the embeddings did. */
export interface RerankCandidate {
  id: string;
  text: string;
  /** Forward-looking (Stage 05) — the modality the candidate
   *  represents. Used by the per-modality RRF weight knob in the
   *  shared retriever; rerankers themselves don't branch on this
   *  today (a cross-encoder just scores `(query, text)` pairs and
   *  arbitrates the merged list). Default `'text'`. */
  modality?: 'text' | 'image';
}

/** One scored doc from the reranker. `score` is provider-specific
 *  (Cohere returns `relevance_score` in [0, 1]); `rank` is 0-based
 *  position in the scored output (so callers can sort or slice
 *  without needing to re-sort). */
export interface RerankedDoc {
  id: string;
  score: number;
  rank: number;
}

export interface RerankResult {
  scoredDocs: RerankedDoc[];
  /** Which reranker actually ran. `'cohere'` when the hosted call
   *  succeeded; `'noop'` when we fell through to identity (no key,
   *  feature off, provider error). Future providers add their own
   *  string here (`'bge-sidecar'`, etc). */
  providerUsed: 'cohere' | 'noop' | string;
  /** Set when `providerUsed === 'noop'` AND we degraded from a
   *  hosted provider (vs the user-configured noop default). Lets
   *  the Coverage panel show a precise reason ("Cohere timed out",
   *  "no Cohere key configured", etc) instead of a generic
   *  "reranked: false" badge. */
  fallbackReason?: string;
  /** Wall-clock latency of the rerank call in milliseconds. Always
   *  set, even on the noop path (where it'll be ~0). The shared
   *  retriever surfaces this on `RetrievalMeta.rerankerLatencyMs`
   *  for the latency budget enforcement. */
  latencyMs: number;
}

/** Injectable interface. Every reranker implementation provides
 *  this method. The caller is responsible for batching / chunking;
 *  this contract is "one query, N candidates, scored list back".
 *
 *  Implementations MUST be triple-defensive — see the file header. */
export interface RerankerService {
  rerank(query: string, docs: RerankCandidate[]): Promise<RerankResult>;
}

/** DI token. Nest doesn't reify interfaces at runtime, so we inject
 *  by symbol. Both `CohereRerankerService` and `NoopRerankerService`
 *  are registered against this token via a factory provider in
 *  `RerankerModule`; consumers `@Inject(RERANKER_SERVICE)`. */
export const RERANKER_SERVICE = Symbol('RerankerService');
