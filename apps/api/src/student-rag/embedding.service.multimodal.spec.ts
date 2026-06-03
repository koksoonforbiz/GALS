/**
 * Stage 05 — Multimodal embedding funnel unit tests.
 *
 * Verifies that `EmbeddingService.callMultimodalEmbedding`:
 *   1. Posts to `https://api.cohere.com/v2/embed` with the correct
 *      body shape (model=embed-v4.0, output_dimension=1536,
 *      input_type=search_document, image data URLs).
 *   2. Routes text and image inputs to separate batches but returns
 *      a single vector list in input order.
 *   3. Returns `(model: 'embed-v4.0', dimensions: 1536, provider:
 *      'cohere')` so the caller pins the corpus correctly.
 *   4. Falls back to text-only embedding when no Cohere key is
 *      configured AND drops image inputs (null vector at the image
 *      index).
 *   5. A Cohere /embed failure does NOT throw — the failed batch's
 *      vectors come back as null so the ingest helper can skip the
 *      chunk.
 *
 * Mocks `global.fetch` — no real network calls.
 */

import { EmbeddingService } from './embedding.service';
import * as crypto from 'crypto';

function encryptKey(plain: string): string {
  const secret = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const key = crypto.scryptSync(secret, 'llm-key-salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function makeMockPrisma(opts: {
  encryptedApiKey: string | null;
  llmProvider: 'openai' | 'gemini' | null;
  llmEmbeddingModel: string | null;
  cohereApiKey?: string | null;
}) {
  const findUnique = jest.fn(async ({ select }: any) => {
    // The funnel uses two distinct findUnique calls: one resolving
    // the embedding spec (selects llm* fields), another resolving
    // the Cohere key. We branch on the `select` shape so a single
    // mock satisfies both.
    if (select && select.cohereApiKey) {
      return { cohereApiKey: opts.cohereApiKey ?? null };
    }
    return {
      encryptedApiKey: opts.encryptedApiKey,
      llmProvider: opts.llmProvider,
      llmEmbeddingModel: opts.llmEmbeddingModel,
    };
  });
  return { user: { findUnique } } as any;
}

function fakePng(size = 16): Buffer {
  const buf = Buffer.alloc(size);
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  return buf;
}

describe('EmbeddingService — multimodal funnel (Cohere Embed 4)', () => {
  const TEACHER_ID = 'teacher-mm';

  beforeEach(() => {
    // Force the pseudo-fallback gate ON so the no-Cohere-key path
    // can produce text vectors via the existing OpenAI/Gemini fallback.
    process.env.RAG_ALLOW_PSEUDO_EMBEDDINGS = 'true';
  });

  afterEach(() => {
    delete process.env.RAG_ALLOW_PSEUDO_EMBEDDINGS;
  });

  it('posts to Cohere v2 /embed with the documented request shape (images)', async () => {
    const prisma = makeMockPrisma({
      encryptedApiKey: encryptKey('sk-openai'),
      llmProvider: 'openai',
      llmEmbeddingModel: 'text-embedding-3-small',
      cohereApiKey: encryptKey('cohere-test-key'),
    });
    const svc = new EmbeddingService(prisma);

    const captured: Array<{ url: string; body: any; headers: any }> = [];
    const fetchMock = jest.fn(async (url: any, init: any) => {
      const body = JSON.parse(init.body);
      captured.push({ url: String(url), body, headers: init.headers });
      // Cohere v2 multimodal response shape — one float vector per
      // input. We return 1536-dim vectors to match the spec.
      const n = (body.inputs ?? body.texts ?? []).length;
      const embeddings = {
        float: Array.from({ length: n }, (_, i) =>
          Array.from({ length: 1536 }, (_v, j) => (i * 1536 + j) * 0.0001),
        ),
      };
      return {
        ok: true,
        status: 200,
        json: async () => ({ embeddings }),
        text: async () => '',
      } as any;
    });
    const previous = global.fetch;
    (global as any).fetch = fetchMock;
    try {
      const result = await svc.callMultimodalEmbedding(TEACHER_ID, [
        { kind: 'image', bytes: fakePng(), mimeType: 'image/png' },
        { kind: 'image', bytes: fakePng(), mimeType: 'image/png' },
      ]);

      expect(result.provider).toBe('cohere');
      expect(result.model).toBe('embed-v4.0');
      expect(result.dimensions).toBe(1536);
      expect(result.vectors).toHaveLength(2);
      expect(result.vectors[0]).not.toBeNull();
      expect(result.vectors[0]!.length).toBe(1536);

      // Exactly one Cohere /embed call (image batch).
      expect(captured).toHaveLength(1);
      const req = captured[0]!;
      expect(req.url).toContain('api.cohere.com/v2/embed');
      expect(req.headers.Authorization).toBe('Bearer cohere-test-key');
      expect(req.body.model).toBe('embed-v4.0');
      expect(req.body.input_type).toBe('search_document');
      expect(req.body.output_dimension).toBe(1536);
      expect(Array.isArray(req.body.embedding_types)).toBe(true);
      expect(req.body.embedding_types).toContain('float');
      // Multimodal payload — inputs array with image content parts.
      expect(Array.isArray(req.body.inputs)).toBe(true);
      expect(req.body.inputs).toHaveLength(2);
      expect(req.body.inputs[0].content[0].type).toBe('image');
      expect(req.body.inputs[0].content[0].image.url).toMatch(
        /^data:image\/png;base64,/,
      );
    } finally {
      (global as any).fetch = previous;
    }
  });

  it('routes text+image mixed inputs through TWO Cohere calls but preserves input order', async () => {
    const prisma = makeMockPrisma({
      encryptedApiKey: encryptKey('sk-openai'),
      llmProvider: 'openai',
      llmEmbeddingModel: 'text-embedding-3-small',
      cohereApiKey: encryptKey('cohere-test-key'),
    });
    const svc = new EmbeddingService(prisma);

    const captured: Array<{ body: any }> = [];
    const fetchMock = jest.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      captured.push({ body });
      const n = (body.inputs ?? body.texts ?? []).length;
      const embeddings = {
        float: Array.from({ length: n }, (_, i) =>
          // Distinct fingerprint per text vs image call so we can
          // assert ordering at the end.
          Array.from({ length: 1536 }, () =>
            body.texts ? 1 + i : 100 + i,
          ),
        ),
      };
      return {
        ok: true,
        status: 200,
        json: async () => ({ embeddings }),
        text: async () => '',
      } as any;
    });
    const previous = global.fetch;
    (global as any).fetch = fetchMock;
    try {
      const result = await svc.callMultimodalEmbedding(TEACHER_ID, [
        { kind: 'text', text: 'alpha' },
        { kind: 'image', bytes: fakePng(), mimeType: 'image/png' },
        { kind: 'text', text: 'beta' },
      ]);

      expect(result.vectors).toHaveLength(3);
      // Input 0 (text) → text-call fingerprint
      expect(result.vectors[0]![0]).toBe(1);
      // Input 1 (image) → image-call fingerprint
      expect(result.vectors[1]![0]).toBe(100);
      // Input 2 (text, second in text batch) → text-call index 1
      expect(result.vectors[2]![0]).toBe(2);
      // Two calls: one text-only, one image-only.
      expect(captured).toHaveLength(2);
    } finally {
      (global as any).fetch = previous;
    }
  });

  it('falls back to text embedder when no Cohere key is configured; drops image inputs', async () => {
    const prisma = makeMockPrisma({
      encryptedApiKey: null, // no openai key either → text via fallback
      llmProvider: 'openai',
      llmEmbeddingModel: 'text-embedding-3-small',
      cohereApiKey: null,
    });
    const svc = new EmbeddingService(prisma);

    const result = await svc.callMultimodalEmbedding(TEACHER_ID, [
      { kind: 'text', text: 'hello' },
      { kind: 'image', bytes: fakePng(), mimeType: 'image/png' },
    ]);

    // Image input drops to null.
    expect(result.vectors).toHaveLength(2);
    expect(result.vectors[0]).not.toBeNull();
    expect(result.vectors[1]).toBeNull();
    // Provider is the text fallback, not 'cohere'.
    expect(result.provider).toBe('fallback');
  });

  it('returns null vectors when Cohere /embed returns non-200 (no throw)', async () => {
    const prisma = makeMockPrisma({
      encryptedApiKey: encryptKey('sk-openai'),
      llmProvider: 'openai',
      llmEmbeddingModel: 'text-embedding-3-small',
      cohereApiKey: encryptKey('cohere-test-key'),
    });
    const svc = new EmbeddingService(prisma);

    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'server error',
      json: async () => ({}),
    }));
    const previous = global.fetch;
    (global as any).fetch = fetchMock;
    try {
      const result = await svc.callMultimodalEmbedding(TEACHER_ID, [
        { kind: 'image', bytes: fakePng(), mimeType: 'image/png' },
      ]);
      // No throw — null vector at the failed index.
      expect(result.vectors).toEqual([null]);
      expect(result.provider).toBe('cohere');
    } finally {
      (global as any).fetch = previous;
    }
  });
});
