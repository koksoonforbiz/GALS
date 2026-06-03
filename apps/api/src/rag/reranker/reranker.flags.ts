/**
 * Stage 04 — Reranker feature flags + tunable knobs.
 *
 * Centralised here so the shared retriever, the Cohere service, and
 * any future caller read from one source. Defaults are chosen so that
 * with NO env vars set, behaviour is identical to Stage 03:
 *
 *   - `RAG_RERANK` defaults to `false` → no rerank, no candidateK
 *     widening, no new latency in the hot path.
 *   - `RAG_RERANK_CANDIDATE_K` defaults to 30 (used only when the
 *     flag is on).
 *   - `RAG_RERANK_TIMEOUT_MS` defaults to 2000 ms; the shared
 *     retriever wraps the reranker call in a race against this.
 *   - `RAG_RRF_WEIGHTS_TEXT` / `RAG_RRF_WEIGHTS_IMAGE` default to
 *     1.0 → equal weight, Stage 02/03 RRF behaviour preserved.
 *     These are the Stage-05 hook: when image chunks land, the
 *     operator can rebalance modalities without redeploying.
 */

function readBool(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return def;
  const v = raw.toLowerCase().trim();
  return v === 'true' || v === '1' || v === 'on' || v === 'yes';
}

function readNumber(name: string, def: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** Global on/off switch. When `false`, the shared retriever skips
 *  candidateK widening AND the rerank call, producing Stage-03
 *  byte-identical output. Default: `false` (opt-in until Stage 05/06
 *  validate the latency budget). */
export function rerankEnabled(): boolean {
  return readBool('RAG_RERANK', false);
}

/** Wider candidate set passed into the reranker. Cohere recommends
 *  rerank candidates ≤ 100; we use 30 because retrieval cost grows
 *  linearly in the in-memory cosine scan (each chunk re-embed group
 *  multiplies by candidateK). Range 1–100 to leave headroom; the
 *  default 30 matches the spec. */
export function rerankCandidateK(): number {
  return readNumber('RAG_RERANK_CANDIDATE_K', 30, 1, 100);
}

/** Outer timeout the shared retriever enforces on the rerank call.
 *  When exceeded, the retriever degrades to RRF order and flags
 *  `reranked: false` in meta. Default 2000 ms — generous enough for
 *  hosted Cohere (typically <300 ms p95 on 30 candidates) but tight
 *  enough that a stuck call doesn't tank chat latency. */
export function rerankTimeoutMs(): number {
  return readNumber('RAG_RERANK_TIMEOUT_MS', 2000, 100, 60000);
}

/** Per-modality RRF weights — Stage 05 hook. Today all candidates are
 *  text (only one modality exists in the corpora), so this is inert.
 *  When Stage 05 adds image chunks, the operator can over- or
 *  under-weight a modality without code change. Validation: anything
 *  outside (0, 10] is clamped — we never want a 0 weight (would silently
 *  drop a whole modality) or an absurdly large one. */
export interface RrfModalityWeights {
  text: number;
  image: number;
}
export function rrfModalityWeights(): RrfModalityWeights {
  return {
    text: readNumber('RAG_RRF_WEIGHTS_TEXT', 1.0, 0.01, 10),
    image: readNumber('RAG_RRF_WEIGHTS_IMAGE', 1.0, 0.01, 10),
  };
}
