/**
 * Stage 04 — CohereRerankerService unit tests.
 *
 * Mocks the teacher LLM service (to return a fake Cohere key) and
 * `global.fetch` (to return a canned Cohere v2/rerank response).
 * Verifies:
 *   - Request body shape (model, query, documents, top_n,
 *     return_documents=false).
 *   - Authorization header is set to `Bearer <key>`.
 *   - Response normalisation: result is sorted by `relevance_score`
 *     desc, indices map back to candidate ids correctly.
 *   - No Cohere key configured → returns noop result with
 *     fallbackReason, no fetch call.
 *   - Non-200 response → retries once, then degrades to noop with the
 *     error in fallbackReason.
 *   - Throws are NEVER propagated to the caller (triple-defensive
 *     contract).
 */

import { CohereRerankerService } from './cohere-reranker.service';
import type { RerankCandidate } from './reranker.types';

const fakePrisma = {} as any;

function makeLlmServiceWithKey(key: string | null) {
  return {
    getCohereApiKey: jest.fn().mockResolvedValue(key),
  } as any;
}

function setFetchMock(handler: jest.Mock) {
  (global as any).fetch = handler;
}

function clearFetchMock() {
  delete (global as any).fetch;
}

describe('CohereRerankerService', () => {
  afterEach(() => {
    jest.clearAllMocks();
    clearFetchMock();
  });

  it('happy path: request body shape + result mapping', async () => {
    const llm = makeLlmServiceWithKey('co-test-key');
    const svc = new CohereRerankerService(fakePrisma, llm);

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      // Out-of-order on purpose to verify our descending re-sort.
      json: async () => ({
        id: 'cohere-req-1',
        results: [
          { index: 2, relevance_score: 0.1 },
          { index: 0, relevance_score: 0.9 },
          { index: 1, relevance_score: 0.55 },
        ],
      }),
    });
    setFetchMock(fetchMock);

    const docs: RerankCandidate[] = [
      { id: 'c1', text: 'alpha doc' },
      { id: 'c2', text: 'beta doc' },
      { id: 'c3', text: 'gamma doc' },
    ];

    const result = await svc.rerankWithContext('the query', docs, {
      teacherId: 'teacher-1',
    });

    // Verify fetch call shape.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.cohere.com/v2/rerank');
    expect(init.method).toBe('POST');
    expect((init.headers as any).Authorization).toBe('Bearer co-test-key');
    expect((init.headers as any)['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('rerank-english-v3.5');
    expect(body.query).toBe('the query');
    expect(body.documents).toEqual(['alpha doc', 'beta doc', 'gamma doc']);
    expect(body.top_n).toBe(3);
    expect(body.return_documents).toBe(false);

    // Verify response normalisation.
    expect(result.providerUsed).toBe('cohere');
    expect(result.scoredDocs).toEqual([
      { id: 'c1', score: 0.9, rank: 0 },
      { id: 'c2', score: 0.55, rank: 1 },
      { id: 'c3', score: 0.1, rank: 2 },
    ]);
    expect(typeof result.latencyMs).toBe('number');
  });

  it('no Cohere key configured → noop result, no fetch call', async () => {
    const llm = makeLlmServiceWithKey(null);
    const svc = new CohereRerankerService(fakePrisma, llm);
    const fetchMock = jest.fn();
    setFetchMock(fetchMock);

    const docs: RerankCandidate[] = [{ id: 'a', text: 'x' }];
    const result = await svc.rerankWithContext('q', docs, { teacherId: 'teacher-1' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.providerUsed).toBe('noop');
    expect(result.fallbackReason).toMatch(/no Cohere key/i);
    // Input order preserved.
    expect(result.scoredDocs[0]!.id).toBe('a');
  });

  it('empty input → empty result, no fetch', async () => {
    const llm = makeLlmServiceWithKey('co-key');
    const svc = new CohereRerankerService(fakePrisma, llm);
    const fetchMock = jest.fn();
    setFetchMock(fetchMock);

    const result = await svc.rerankWithContext('q', [], { teacherId: 't' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.providerUsed).toBe('noop');
    expect(result.scoredDocs).toEqual([]);
  });

  it('non-200 on first call → retries once, on second failure returns noop', async () => {
    const llm = makeLlmServiceWithKey('co-key');
    const svc = new CohereRerankerService(fakePrisma, llm);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'server boom',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: async () => 'gateway boom',
      });
    setFetchMock(fetchMock);

    const docs: RerankCandidate[] = [
      { id: 'a', text: 'x' },
      { id: 'b', text: 'y' },
    ];
    const result = await svc.rerankWithContext('q', docs, { teacherId: 't' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.providerUsed).toBe('noop');
    expect(result.fallbackReason).toMatch(/twice|502|500/i);
    // Falls back to RRF (input) order.
    expect(result.scoredDocs.map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('drops malformed results (bad index, NaN score)', async () => {
    const llm = makeLlmServiceWithKey('co-key');
    const svc = new CohereRerankerService(fakePrisma, llm);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { index: 0, relevance_score: 0.7 },
          { index: 99, relevance_score: 0.9 }, // out-of-range
          { index: 1, relevance_score: Number.NaN }, // NaN
          { index: 2, relevance_score: 0.3 },
        ],
      }),
    });
    setFetchMock(fetchMock);

    const docs: RerankCandidate[] = [
      { id: 'a', text: 'x' },
      { id: 'b', text: 'y' },
      { id: 'c', text: 'z' },
    ];

    const result = await svc.rerankWithContext('q', docs, { teacherId: 't' });
    expect(result.providerUsed).toBe('cohere');
    // Only the two valid entries should survive, sorted desc.
    expect(result.scoredDocs).toEqual([
      { id: 'a', score: 0.7, rank: 0 },
      { id: 'c', score: 0.3, rank: 1 },
    ]);
  });

  it('fetch throws → retried, second throw → noop result (never propagates)', async () => {
    const llm = makeLlmServiceWithKey('co-key');
    const svc = new CohereRerankerService(fakePrisma, llm);
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('econn-1'))
      .mockRejectedValueOnce(new Error('econn-2'));
    setFetchMock(fetchMock);

    const docs: RerankCandidate[] = [{ id: 'a', text: 'x' }];
    const result = await svc.rerankWithContext('q', docs, { teacherId: 't' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.providerUsed).toBe('noop');
    expect(result.fallbackReason).toContain('econn-2');
    expect(result.scoredDocs[0]!.id).toBe('a');
  });
});
