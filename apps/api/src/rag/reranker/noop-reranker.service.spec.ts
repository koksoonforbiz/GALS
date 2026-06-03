/**
 * Stage 04 — NoopRerankerService unit tests.
 *
 * The noop reranker is the identity fallback. Contract:
 *  - Preserves input order (no shuffle, no drop).
 *  - Returns `providerUsed: 'noop'` so the shared retriever can stamp
 *    `reranked: false` on its meta.
 *  - Scores are monotonically decreasing so any downstream sort-by-score
 *    keeps the input order intact (deterministic across V8 sort
 *    implementations and any future sort change).
 *  - Never throws; even an empty input returns a well-formed result.
 */

import { NoopRerankerService } from './noop-reranker.service';
import type { RerankCandidate } from './reranker.types';

describe('NoopRerankerService', () => {
  const svc = new NoopRerankerService();

  it('returns input order unchanged with providerUsed: noop', async () => {
    const docs: RerankCandidate[] = [
      { id: 'c1', text: 'first' },
      { id: 'c2', text: 'second' },
      { id: 'c3', text: 'third' },
    ];
    const result = await svc.rerank('any query', docs);

    expect(result.providerUsed).toBe('noop');
    expect(result.scoredDocs.map((d) => d.id)).toEqual(['c1', 'c2', 'c3']);
    // Scores monotonically decreasing.
    for (let i = 1; i < result.scoredDocs.length; i++) {
      expect(result.scoredDocs[i]!.score).toBeLessThan(result.scoredDocs[i - 1]!.score);
    }
  });

  it('preserves order even when caller passes a reverse-sorted set', async () => {
    const docs: RerankCandidate[] = [
      { id: 'last', text: 'z' },
      { id: 'middle', text: 'm' },
      { id: 'first', text: 'a' },
    ];
    const result = await svc.rerank('q', docs);
    expect(result.scoredDocs.map((d) => d.id)).toEqual(['last', 'middle', 'first']);
  });

  it('handles empty input without throwing', async () => {
    const result = await svc.rerank('q', []);
    expect(result.providerUsed).toBe('noop');
    expect(result.scoredDocs).toEqual([]);
    expect(result.latencyMs).toBe(0);
  });

  it('rank index reflects position in input array', async () => {
    const docs: RerankCandidate[] = [
      { id: 'a', text: 'x' },
      { id: 'b', text: 'y' },
    ];
    const { scoredDocs } = await svc.rerank('q', docs);
    expect(scoredDocs[0]!.rank).toBe(0);
    expect(scoredDocs[1]!.rank).toBe(1);
  });
});
