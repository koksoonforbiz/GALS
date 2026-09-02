/**
 * Stage 4 — embedding funnel unit tests.
 *
 * Verifies that `EmbeddingService.callEmbeddingForUser` / `embedWithSpec`:
 *   1. Returns the registry-pinned `{ model, dimensions }` so callers can
 *      pin the corpus rows correctly.
 *   2. The SHA256 pseudo-vector fallback emits a vector whose length is
 *      exactly `spec.dimensions` (NOT a hard-coded 1536) for every spec.
 *   3. OpenAI: when the corpus pins a smaller dim from `truncatableTo`,
 *      the outgoing request body has a `dimensions` field.
 *   4. Gemini: `outputDimensionality` is set in each per-request entry of
 *      the batchEmbedContents body.
 *
 * Mocks `global.fetch` — no real network calls.
 */

import { EmbeddingService } from './embedding.service';
import {
  defaultEmbeddingModel,
  getEmbeddingModel,
  listEmbeddingModels,
} from '../llm/model-registry';
import * as crypto from 'crypto';

// ─── Helpers ───────────────────────────────────────────────

function makeMockPrisma(opts: {
  encryptedApiKey: string | null;
  llmProvider: 'openai' | 'gemini' | 'bedrock' | null;
  llmEmbeddingModel: string | null;
}) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        encryptedApiKey: opts.encryptedApiKey,
        llmProvider: opts.llmProvider,
        llmEmbeddingModel: opts.llmEmbeddingModel,
      }),
    },
  } as any;
}

/** None of these tests exercise the Bedrock provider (see the Bedrock
 *  spec for that), so `.get()` never needs a real return value. */
const mockConfig = { get: jest.fn() } as any;

/** Encrypt a key the same way `EmbeddingService.decryptApiKey` decrypts.
 *  Uses JWT_SECRET from process.env (the spec runs with .env.test loaded
 *  by the parent `pnpm test` cmd; for direct jest invocation we fall back
 *  to the same dev secret). */
function encryptKey(plain: string): string {
  const secret = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const key = crypto.scryptSync(secret, 'llm-key-salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function installFetchMock(opts: {
  kind: 'openai' | 'gemini';
  dimensions: number;
  batchSize?: number; // how many embeddings to return
}) {
  const captured: Array<{ url: string; body: any }> = [];
  const fetchMock = jest.fn(async (url: any, init: any) => {
    const body = init && init.body ? JSON.parse(init.body as string) : null;
    captured.push({ url: String(url), body });

    if (opts.kind === 'openai') {
      // OpenAI shape: { data: [{ embedding, index }] }
      const inputs: string[] = body.input || [];
      const data = inputs.map((_, i) => ({
        index: i,
        embedding: new Array(opts.dimensions).fill(0).map((_v, j) => (i + j) * 0.001),
      }));
      return {
        ok: true,
        status: 200,
        json: async () => ({ data }),
        text: async () => '',
      } as any;
    }
    // Gemini
    const requests = body.requests || [];
    const embeddings = requests.map((r: any, i: number) => ({
      values: new Array(opts.dimensions).fill(0).map((_v, j) => (i + j) * 0.001),
    }));
    return {
      ok: true,
      status: 200,
      json: async () => ({ embeddings }),
      text: async () => '',
    } as any;
  });
  const previous = global.fetch;
  (global as any).fetch = fetchMock;
  return {
    captured,
    restore: () => {
      (global as any).fetch = previous;
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────

describe('EmbeddingService — registry-driven funnel', () => {
  const TEACHER_ID = 'teacher-1';

  describe('returned { model, dimensions } matches registry', () => {
    it('text-embedding-3-small → 1536 dims', async () => {
      const apiKey = 'sk-test';
      const prisma = makeMockPrisma({
        encryptedApiKey: encryptKey(apiKey),
        llmProvider: 'openai',
        llmEmbeddingModel: 'text-embedding-3-small',
      });
      const service = new EmbeddingService(prisma, mockConfig);
      const fakeFetch = installFetchMock({ kind: 'openai', dimensions: 1536 });
      try {
        const result = await service.callEmbeddingForUser(TEACHER_ID, ['hi']);
        expect(result.model).toBe('text-embedding-3-small');
        expect(result.dimensions).toBe(1536);
        expect(result.vectors[0]!.length).toBe(1536);
        expect(result.provider).toBe('openai');
      } finally {
        fakeFetch.restore();
      }
    });

    it('text-embedding-3-large → 3072 dims', async () => {
      const apiKey = 'sk-test';
      const prisma = makeMockPrisma({
        encryptedApiKey: encryptKey(apiKey),
        llmProvider: 'openai',
        llmEmbeddingModel: 'text-embedding-3-large',
      });
      const service = new EmbeddingService(prisma, mockConfig);
      const fakeFetch = installFetchMock({ kind: 'openai', dimensions: 3072 });
      try {
        const result = await service.callEmbeddingForUser(TEACHER_ID, ['hi']);
        expect(result.model).toBe('text-embedding-3-large');
        expect(result.dimensions).toBe(3072);
        expect(result.vectors[0]!.length).toBe(3072);
      } finally {
        fakeFetch.restore();
      }
    });

    it('gemini-embedding-001 → 768 native dims', async () => {
      const apiKey = 'gm-test';
      const prisma = makeMockPrisma({
        encryptedApiKey: encryptKey(apiKey),
        llmProvider: 'gemini',
        llmEmbeddingModel: 'gemini-embedding-001',
      });
      const service = new EmbeddingService(prisma, mockConfig);
      const fakeFetch = installFetchMock({ kind: 'gemini', dimensions: 768 });
      try {
        const result = await service.callEmbeddingForUser(TEACHER_ID, ['hi']);
        expect(result.model).toBe('gemini-embedding-001');
        expect(result.dimensions).toBe(768);
        expect(result.vectors[0]!.length).toBe(768);
        expect(result.provider).toBe('gemini');
      } finally {
        fakeFetch.restore();
      }
    });
  });

  describe('Bedrock (Cohere Embed 4, one shared server credential)', () => {
    it('cohere.embed-v4:0 → 1536 dims, hits the Bedrock invoke endpoint with the bearer token', async () => {
      const prisma = makeMockPrisma({
        encryptedApiKey: null, // bedrock has no per-teacher key — see resolveTeacherEmbeddingSpec
        llmProvider: 'bedrock',
        llmEmbeddingModel: 'cohere.embed-v4:0',
      });
      const config = { get: jest.fn().mockReturnValue('bedrock-bearer-test-token') } as any;
      const service = new EmbeddingService(prisma, config);

      const captured: Array<{ url: string; body: any; headers: any }> = [];
      const fetchMock = jest.fn(async (url: any, init: any) => {
        captured.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            embeddings: { float: [Array.from({ length: 1536 }, (_v, j) => j * 0.0001)] },
          }),
          text: async () => '',
        } as any;
      });
      const previous = global.fetch;
      (global as any).fetch = fetchMock;
      try {
        const result = await service.callEmbeddingForUser(TEACHER_ID, ['hi']);
        expect(result.model).toBe('cohere.embed-v4:0');
        expect(result.dimensions).toBe(1536);
        expect(result.vectors[0]!.length).toBe(1536);
        expect(result.provider).toBe('bedrock');

        expect(captured).toHaveLength(1);
        const req = captured[0]!;
        expect(req.url).toBe(
          'https://bedrock-runtime.ap-southeast-1.amazonaws.com/model/cohere.embed-v4%3A0/invoke',
        );
        expect(req.headers.Authorization).toBe('Bearer bedrock-bearer-test-token');
        expect(req.body.texts).toEqual(['hi']);
        expect(req.body.input_type).toBe('search_document');
      } finally {
        (global as any).fetch = previous;
      }
    });

    it('falls back to the SHA256 pseudo-embedding when AWS_BEARER_TOKEN is unconfigured', async () => {
      const prisma = makeMockPrisma({
        encryptedApiKey: null,
        llmProvider: 'bedrock',
        llmEmbeddingModel: 'cohere.embed-v4:0',
      });
      const config = { get: jest.fn().mockReturnValue(undefined) } as any;
      const service = new EmbeddingService(prisma, config);
      // No fetch mock — the fallback path must never call fetch.
      const result = await service.callEmbeddingForUser(TEACHER_ID, ['hi']);
      expect(result.provider).toBe('fallback');
      expect(result.dimensions).toBe(1536);
      expect(result.vectors[0]!.length).toBe(1536);
    });
  });

  describe('SHA256 fallback vector length === spec.dimensions for every embedding spec', () => {
    // No key → fallback path. Length must follow the resolved spec's
    // declared dimension count, NOT a hard-coded 1536.
    //
    // Cohere multimodal (Stage 05) is excluded here because
    // `callEmbeddingForUser` is the TEXT funnel — it resolves the
    // teacher's openai/gemini default, not Cohere. The Cohere path
    // is exercised by `callMultimodalEmbedding` in the multimodal
    // spec. The pseudo-fallback shape is identical, so excluding
    // it from this loop doesn't lose coverage.
    const allSpecs = listEmbeddingModels().filter(
      (s) => s.provider === 'openai' || s.provider === 'gemini',
    );

    it.each(allSpecs.map((s) => [s.id, s.dimensions]))(
      'fallback for %s emits dim %d vectors',
      async (modelId, expectedDim) => {
        const spec = getEmbeddingModel(modelId as string)!;
        const prisma = makeMockPrisma({
          encryptedApiKey: null,
          llmProvider: spec.provider as 'openai' | 'gemini',
          llmEmbeddingModel: modelId as string,
        });
        const service = new EmbeddingService(prisma, mockConfig);
        // No fetch mock — fallback path doesn't call fetch.
        const result = await service.callEmbeddingForUser(TEACHER_ID, ['hello world']);
        expect(result.provider).toBe('fallback');
        // Stage 02 (Task E): pseudo-vector fallback is now tagged with
        // the sentinel `sha256-pseudo` model id so the retrieval guard
        // can surface `degradedRetrieval` without re-resolving funnel
        // state. The returned `dimensions` is still honest per spec.
        expect(result.model).toBe('sha256-pseudo');
        expect(result.dimensions).toBe(expectedDim);
        expect(result.vectors).toHaveLength(1);
        expect(result.vectors[0]!.length).toBe(expectedDim);
      },
    );

    it('fallback respects truncated dim from truncatableTo when requested', async () => {
      // text-embedding-3-large native = 3072, truncatableTo includes 1024.
      const prisma = makeMockPrisma({
        encryptedApiKey: null,
        llmProvider: 'openai',
        llmEmbeddingModel: 'text-embedding-3-large',
      });
      const service = new EmbeddingService(prisma, mockConfig);
      const result = await service.callEmbeddingForUser(TEACHER_ID, ['hi'], {
        outputDimensions: 1024,
      });
      expect(result.dimensions).toBe(1024);
      expect(result.vectors[0]!.length).toBe(1024);
    });
  });

  describe('RAG_ALLOW_PSEUDO_EMBEDDINGS gate (Stage 02 Task E)', () => {
    const prevAllow = process.env.RAG_ALLOW_PSEUDO_EMBEDDINGS;
    const prevEnv = process.env.NODE_ENV;
    afterEach(() => {
      if (prevAllow === undefined) delete process.env.RAG_ALLOW_PSEUDO_EMBEDDINGS;
      else process.env.RAG_ALLOW_PSEUDO_EMBEDDINGS = prevAllow;
      if (prevEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevEnv;
    });

    it('throws when prod-default gate blocks pseudo path', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.RAG_ALLOW_PSEUDO_EMBEDDINGS;
      const prisma = makeMockPrisma({
        encryptedApiKey: null,
        llmProvider: 'openai',
        llmEmbeddingModel: 'text-embedding-3-small',
      });
      const service = new EmbeddingService(prisma, mockConfig);
      await expect(service.callEmbeddingForUser(TEACHER_ID, ['hi'])).rejects.toThrow(
        /RAG_PSEUDO_EMBEDDING_BLOCKED/,
      );
    });

    it('honors RAG_ALLOW_PSEUDO_EMBEDDINGS=true override in prod', async () => {
      process.env.NODE_ENV = 'production';
      process.env.RAG_ALLOW_PSEUDO_EMBEDDINGS = 'true';
      const prisma = makeMockPrisma({
        encryptedApiKey: null,
        llmProvider: 'openai',
        llmEmbeddingModel: 'text-embedding-3-small',
      });
      const service = new EmbeddingService(prisma, mockConfig);
      const result = await service.callEmbeddingForUser(TEACHER_ID, ['hi']);
      expect(result.provider).toBe('fallback');
      expect(result.model).toBe('sha256-pseudo');
    });
  });

  describe('OpenAI truncation `dimensions` param', () => {
    it('text-embedding-3-large with truncated outputDimensions=1024 → request body has dimensions=1024', async () => {
      const prisma = makeMockPrisma({
        encryptedApiKey: encryptKey('sk-test'),
        llmProvider: 'openai',
        llmEmbeddingModel: 'text-embedding-3-large',
      });
      const service = new EmbeddingService(prisma, mockConfig);
      const fakeFetch = installFetchMock({ kind: 'openai', dimensions: 1024 });
      try {
        const result = await service.callEmbeddingForUser(TEACHER_ID, ['hi'], {
          outputDimensions: 1024,
        });
        expect(fakeFetch.captured).toHaveLength(1);
        const req = fakeFetch.captured[0]!;
        expect(req.url).toContain('api.openai.com/v1/embeddings');
        expect(req.body.model).toBe('text-embedding-3-large');
        expect(req.body.dimensions).toBe(1024);
        expect(result.dimensions).toBe(1024);
      } finally {
        fakeFetch.restore();
      }
    });

    it('text-embedding-3-small (native 1536) → no `dimensions` field in request body', async () => {
      // 3-small native dim equals the corpus default; no truncation
      // requested → don't send a `dimensions` field (legacy ada-002 would
      // reject it, and modern small still works without it).
      const prisma = makeMockPrisma({
        encryptedApiKey: encryptKey('sk-test'),
        llmProvider: 'openai',
        llmEmbeddingModel: 'text-embedding-3-small',
      });
      const service = new EmbeddingService(prisma, mockConfig);
      const fakeFetch = installFetchMock({ kind: 'openai', dimensions: 1536 });
      try {
        await service.callEmbeddingForUser(TEACHER_ID, ['hi']);
        const req = fakeFetch.captured[0]!;
        expect(req.body.dimensions).toBeUndefined();
      } finally {
        fakeFetch.restore();
      }
    });
  });

  describe('Gemini batchEmbedContents shape', () => {
    it('sets outputDimensionality on each request and posts to batchEmbedContents', async () => {
      const prisma = makeMockPrisma({
        encryptedApiKey: encryptKey('gm-test'),
        llmProvider: 'gemini',
        llmEmbeddingModel: 'gemini-embedding-001',
      });
      const service = new EmbeddingService(prisma, mockConfig);
      const fakeFetch = installFetchMock({ kind: 'gemini', dimensions: 1536 });
      try {
        await service.callEmbeddingForUser(TEACHER_ID, ['a', 'b'], {
          outputDimensions: 1536,
        });
        const req = fakeFetch.captured[0]!;
        expect(req.url).toContain('gemini-embedding-001:batchEmbedContents');
        expect(Array.isArray(req.body.requests)).toBe(true);
        expect(req.body.requests).toHaveLength(2);
        for (const r of req.body.requests) {
          expect(r.outputDimensionality).toBe(1536);
        }
      } finally {
        fakeFetch.restore();
      }
    });
  });

  describe('default resolution', () => {
    it('falls back to provider default when teacher has no embedding model pinned', async () => {
      const prisma = makeMockPrisma({
        encryptedApiKey: encryptKey('sk-test'),
        llmProvider: 'openai',
        llmEmbeddingModel: null,
      });
      const service = new EmbeddingService(prisma, mockConfig);
      const fakeFetch = installFetchMock({
        kind: 'openai',
        dimensions: defaultEmbeddingModel('openai').dimensions,
      });
      try {
        const result = await service.callEmbeddingForUser(TEACHER_ID, ['hi']);
        expect(result.model).toBe(defaultEmbeddingModel('openai').id);
        expect(result.dimensions).toBe(defaultEmbeddingModel('openai').dimensions);
      } finally {
        fakeFetch.restore();
      }
    });
  });
});
