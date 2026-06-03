/**
 * Stage 04 — integration test: shared retriever's rerank stage.
 *
 * Confirms the contract that the retriever's `runRerank` honours:
 *  - Flag off (default) → input order returned, `reranked: false`,
 *    no candidateK widening surfaced (candidateK omitted from meta).
 *  - Flag on, no Cohere key (NoopRerankerService injected manually)
 *    → input order returned, `reranked: false`,
 *    `providerUsed: 'noop'`, fallbackReason populated.
 *
 * We test the retriever via its dependency-injected reranker (the
 * full Nest module wiring is exercised in the existing
 * student-rag-retrieval.service.spec.ts; here we focus on the rerank
 * stage in isolation by hand-rolling the two-arg constructor that
 * leaves both rerankers undefined → `pickReranker()` returns the
 * inline noop branch).
 */

import { StudentRagRetrievalService } from '../../student-rag/student-rag-retrieval.service';

describe('Shared retriever — rerank fallback when no Cohere wired', () => {
  const ORIGINAL_ENV = process.env.RAG_RERANK;
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.RAG_RERANK;
    else process.env.RAG_RERANK = ORIGINAL_ENV;
  });

  it('flag off: empty active sources path returns reranked: false', async () => {
    delete process.env.RAG_RERANK;
    const svc = new StudentRagRetrievalService({} as any, {} as any);
    const result = await svc.retrieveWithMeta(
      'q',
      'student-1',
      'course-1',
      [], // no active sources → early-return path
      8,
      '',
      'openai',
      undefined,
    );
    expect(result.chunks).toEqual([]);
    expect(result.meta.reranked).toBe(false);
  });

  it('flag on, no rerankers injected: runs noop fallback, meta surfaces reranked=false', async () => {
    process.env.RAG_RERANK = 'true';
    // Hand-roll a minimal prisma + embedding mock returning a small
    // pre-embedded corpus so the dense path returns ≥1 chunk.
    const chunks = [
      {
        id: 'c1',
        documentId: 'd1',
        content: 'alpha',
        pageNumber: 1,
        metadata: {},
        embedding: [1, 0, 0],
        embeddingModel: 'text-embedding-3-small',
        embeddingDimensions: 3,
        contextualText: null,
      },
      {
        id: 'c2',
        documentId: 'd1',
        content: 'beta',
        pageNumber: 2,
        metadata: {},
        embedding: [0, 1, 0],
        embeddingModel: 'text-embedding-3-small',
        embeddingDimensions: 3,
        contextualText: null,
      },
    ];

    const prisma = {
      studentRagChunk: {
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          // Sparse path uses `OR` term filter; we don't want it to
          // surface anything (keeps the test focussed on dense only).
          if (where?.OR) return Promise.resolve([]);
          return Promise.resolve(chunks);
        }),
      },
      studentSourceDocument: {
        findMany: jest.fn().mockResolvedValue([{ id: 'd1', originalName: 'Doc 1' }]),
      },
    } as any;

    const embedding = {
      embedWithSpec: jest.fn().mockResolvedValue({
        vectors: [[1, 0, 0]],
        model: 'text-embedding-3-small',
        dimensions: 3,
        provider: 'openai' as const,
      }),
      embedOne: jest.fn().mockResolvedValue([1, 0, 0]),
    } as any;

    // Two-arg ctor: cohereReranker + noopReranker are undefined →
    // `pickReranker()` returns the inline noop branch (no Cohere key
    // resolution at all).
    const svc = new StudentRagRetrievalService(prisma, embedding);
    const result = await svc.retrieveWithMeta(
      'alpha',
      'student-1',
      'course-1',
      ['d1'],
      2,
      'fake-key',
      'openai',
      'teacher-1',
    );

    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    expect(result.meta.reranked).toBe(false);
    expect(result.meta.rerankerProvider).toBe('noop');
    expect(result.meta.rerankerFallbackReason).toMatch(/no Cohere key/i);
    expect(result.meta.candidateK).toBeGreaterThanOrEqual(1);
  });
});
