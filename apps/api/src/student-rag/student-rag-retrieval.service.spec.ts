/**
 * Stage 4 — retrieval guard unit tests.
 *
 * Verifies the dense-retrieval guard in StudentRagRetrievalService:
 *  - When chunks have heterogeneous pinned (embeddingModel, embeddingDim),
 *    the service groups them and re-embeds the query ONCE per group with
 *    the corpus's pinned spec — never cosines across mismatched dims.
 *  - When the teacher's *current* default embedding model is different
 *    from the corpus's pinned one, retrieval still serves the corpus by
 *    re-embedding the query with the pinned spec (this is what
 *    `needsReembed = true` keeps alive until the background worker
 *    finishes).
 *
 * Mocks Prisma + the embedding service surface.
 */

import { StudentRagRetrievalService } from './student-rag-retrieval.service';

// ─── Helpers ───────────────────────────────────────────────

function makeMockPrisma(chunks: any[]) {
  return {
    studentRagChunk: {
      findMany: jest.fn().mockResolvedValue(chunks),
    },
    studentSourceDocument: {
      findMany: jest.fn().mockResolvedValue(
        Array.from(new Set(chunks.map((c) => c.documentId))).map((id) => ({
          id,
          originalName: `doc-${id}`,
        })),
      ),
    },
  } as any;
}

function makeMockEmbeddingService(opts: {
  /** Map of pinned model id → vector to return for the query. */
  perSpecQueryVectors: Record<string, number[]>;
  /** Default vector for legacy `embedOne(query, key, provider)` path. */
  legacyQueryVector?: number[];
}) {
  const embedWithSpec = jest.fn(async (texts: string[], _apiKey, _provider, spec, dim) => {
    const vec = opts.perSpecQueryVectors[spec.id];
    if (!vec) {
      throw new Error(`No query vector configured for spec ${spec.id}`);
    }
    return {
      vectors: texts.map(() => vec),
      model: spec.id,
      dimensions: dim ?? spec.dimensions,
      provider: 'openai' as const,
    };
  });
  const embedOne = jest.fn(async (_text, _apiKey, _provider) => {
    return opts.legacyQueryVector ?? [];
  });
  return { embedWithSpec, embedOne } as any;
}

function makeChunk(opts: {
  id: string;
  documentId?: string;
  embedding: number[];
  embeddingModel: string;
  embeddingDimensions: number;
  content?: string;
  pageNumber?: number | null;
}) {
  return {
    id: opts.id,
    documentId: opts.documentId ?? 'doc-1',
    content: opts.content ?? `content ${opts.id}`,
    pageNumber: opts.pageNumber ?? null,
    metadata: {},
    embedding: opts.embedding,
    embeddingModel: opts.embeddingModel,
    embeddingDimensions: opts.embeddingDimensions,
  };
}

// ─── Tests ─────────────────────────────────────────────────

describe('StudentRagRetrievalService — pinned (model, dim) guard', () => {
  it('mixed-dim chunks: re-embeds query per pinned spec, NEVER cosines cross-dim', async () => {
    // Two pinned groups in the same corpus (which is itself a configuration
    // violation, but the system must NEVER mix dims even if it does happen).
    //  - group A: text-embedding-3-small, dim 1536 → chunk vec [1,0]
    //    BUT we use very small dims for test ease.
    //
    // To test the guard cleanly we drop down to TINY synthetic dims (2 and 3)
    // and lie to the embedding service mock so the service believes that's
    // what it asked for. The dimension count of the chunk array IS authoritative
    // for retrieval — `spec.dimensions` is decorative metadata in this test.
    const chunks = [
      makeChunk({
        id: 'c-a-1',
        embedding: [1, 0],
        embeddingModel: 'text-embedding-3-small',
        embeddingDimensions: 2,
      }),
      makeChunk({
        id: 'c-a-2',
        embedding: [0, 1],
        embeddingModel: 'text-embedding-3-small',
        embeddingDimensions: 2,
      }),
      makeChunk({
        id: 'c-b-1',
        embedding: [1, 0, 0],
        embeddingModel: 'text-embedding-3-large',
        embeddingDimensions: 3,
      }),
    ];
    const prisma = makeMockPrisma(chunks);
    const embeddingService = makeMockEmbeddingService({
      perSpecQueryVectors: {
        'text-embedding-3-small': [1, 0], // matches group A dim
        'text-embedding-3-large': [1, 0, 0], // matches group B dim
      },
    });

    const svc = new StudentRagRetrievalService(prisma, embeddingService);
    const out = await svc.retrieve(
      'meaningful query that has enough words to survive stopword filtering',
      'student-1',
      'course-1',
      ['doc-1'],
      10,
      'sk-test',
      'openai',
      'teacher-1',
    );

    // Expect embedWithSpec to have been invoked TWICE — once per pinned spec.
    expect(embeddingService.embedWithSpec).toHaveBeenCalledTimes(2);
    const invokedSpecIds = embeddingService.embedWithSpec.mock.calls.map(
      (c: any[]) => c[3].id,
    );
    expect(invokedSpecIds).toEqual(
      expect.arrayContaining(['text-embedding-3-small', 'text-embedding-3-large']),
    );

    // Every returned chunk should have a real (>= 0) cosine score from its
    // own group — no junk scores from cross-dim comparisons (which would
    // either error or return 0 silently).
    expect(out.length).toBeGreaterThan(0);
    for (const r of out) {
      expect(typeof r.score).toBe('number');
      expect(Number.isFinite(r.score)).toBe(true);
    }
  });

  it('teacher-flipped-provider corpus: still serves using pinned model (needsReembed=true case)', async () => {
    // Corpus was indexed under text-embedding-3-small. Teacher has since
    // switched to Gemini. Retrieval is invoked with the new provider/key
    // but `embedWithSpec` must be called with the corpus's pinned OpenAI
    // spec. The `needsReembed` flag on the parent doc doesn't change
    // retrieval shape — guard runs on chunk-level pin.
    const chunks = [
      makeChunk({
        id: 'c-1',
        embedding: [1, 0],
        embeddingModel: 'text-embedding-3-small',
        embeddingDimensions: 2,
      }),
      makeChunk({
        id: 'c-2',
        embedding: [0, 1],
        embeddingModel: 'text-embedding-3-small',
        embeddingDimensions: 2,
      }),
    ];
    const prisma = makeMockPrisma(chunks);
    const embeddingService = makeMockEmbeddingService({
      perSpecQueryVectors: {
        'text-embedding-3-small': [1, 0],
      },
      legacyQueryVector: [0.5, 0.5],
    });

    const svc = new StudentRagRetrievalService(prisma, embeddingService);
    const out = await svc.retrieve(
      'long enough query string to clear stopwords',
      'student-1',
      'course-1',
      ['doc-1'],
      10,
      'gm-test',
      'gemini', // teacher is now on Gemini
      'teacher-1',
    );

    // The guard must have re-embedded with the PINNED OpenAI spec, NOT
    // fallen straight to the legacy `embedOne` path. This is what keeps
    // the corpus servable until the background re-embed worker
    // finishes.
    expect(embeddingService.embedWithSpec).toHaveBeenCalledTimes(1);
    expect(embeddingService.embedWithSpec.mock.calls[0][3].id).toBe('text-embedding-3-small');

    // At least one chunk surfaces.
    expect(out.length).toBeGreaterThan(0);
  });

  it('refuses cosine across mismatched dims (guard skips group when re-embed dim disagrees)', async () => {
    // Chunk pinned at dim 4; spec re-embed returns dim 3 (mock lies about
    // the requested dim). The guard must SKIP this group rather than
    // cosine across mismatched vectors.
    const chunks = [
      makeChunk({
        id: 'c-bad',
        embedding: [1, 0, 0, 0],
        embeddingModel: 'text-embedding-3-large',
        embeddingDimensions: 4,
      }),
    ];
    const prisma = makeMockPrisma(chunks);
    const embeddingService = {
      embedWithSpec: jest.fn(async (texts: string[], _k, _p, spec, _dim) => ({
        // Wrong dim: 3 instead of 4
        vectors: texts.map(() => [1, 0, 0]),
        model: spec.id,
        dimensions: 3,
        provider: 'openai' as const,
      })),
      embedOne: jest.fn(async () => [1, 0, 0]), // also wrong dim
    } as any;

    const svc = new StudentRagRetrievalService(prisma, embeddingService);
    const out = await svc.retrieve(
      'a query with enough non-stopword tokens to retrieve',
      'student-1',
      'course-1',
      ['doc-1'],
      10,
      'sk-test',
      'openai',
      'teacher-1',
    );

    // Dense path produced NO results (guard skipped the group). The chunk
    // may still surface via the sparse path because it text-matches the
    // query — what we care about is that no garbage cosine got computed.
    for (const r of out) {
      // Score should be RRF (typically very small fractions like 1/61),
      // not a cosine in [0, 1] range from cross-dim math.
      expect(r.score).toBeLessThan(1);
    }
  });
});
