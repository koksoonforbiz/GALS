/**
 * Stage 4 — funnel request-shaping unit tests.
 *
 * Asserts that `LlmService.callLlmStructured` builds provider-correct
 * HTTP requests for each representative model in the registry, and that
 * the response is normalized back into `{ content, promptTokens,
 * completionTokens }` for both OpenAI and Gemini.
 *
 * Mocks `global.fetch` — no real network calls.
 */

import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LlmService } from '../rag/llm.service';

// ─── Test helpers ───────────────────────────────────────────

type FetchInit = Parameters<typeof fetch>[1];

interface CapturedRequest {
  url: string;
  init: FetchInit | undefined;
  body: any;
}

function makeService(opts: {
  llmProvider: 'openai' | 'gemini';
  llmModel: string;
  apiKey?: string; // injected pre-encrypted (we mock decrypt by using saveApiKey style — easier to bypass via DI prisma stub)
}): { service: LlmService; prisma: any } {
  // Mock PrismaService surface used by the funnel:
  //   - user.findUnique → returns { llmProvider, llmModel, encryptedApiKey }
  //   - llmUsageLog.create → no-op
  //   - llmAuditLog.create → no-op (unused on this path)
  const prisma: any = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    llmUsageLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    llmAuditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    llmModelPricing: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    sourceDocument: { updateMany: jest.fn() },
    studentSourceDocument: { updateMany: jest.fn() },
  };

  const config = {
    get: (_k: string, defaultValue?: any) =>
      defaultValue ?? 'test-secret-must-be-at-least-16-chars',
    getOrThrow: (_k: string) => 'test-secret-must-be-at-least-16-chars',
  } as unknown as ConfigService;

  const eventEmitter = new EventEmitter2();
  const service = new LlmService(prisma, config, null as any, eventEmitter);

  // Encrypt a real key with the service's own crypto so getUserApiKey can
  // decrypt it. The encrypt() method is private — use saveApiKey indirectly
  // by calling encrypt via reflection through `service as any`.
  const apiKey = opts.apiKey ?? 'sk-test-abcdefghijklmnop';
  const encrypted = (service as any).encrypt(apiKey);

  prisma.user.findUnique.mockResolvedValue({
    llmProvider: opts.llmProvider,
    llmModel: opts.llmModel,
    llmEmbeddingModel: null,
    encryptedApiKey: encrypted,
  });

  return { service, prisma };
}

/** Install a `global.fetch` mock that records all requests and returns a
 *  canned provider response shape. The shape is chosen per the model id
 *  family (OpenAI vs Gemini). */
function installFetchMock(
  fakeResponse:
    | { kind: 'openai'; content: string; promptTokens: number; completionTokens: number }
    | {
        kind: 'gemini';
        content: string;
        promptTokenCount: number;
        candidatesTokenCount: number;
      },
): { captured: CapturedRequest[]; restore: () => void } {
  const captured: CapturedRequest[] = [];
  const fetchMock = jest.fn(async (url: any, init: any) => {
    let body: any = undefined;
    if (init && init.body) {
      try {
        body = JSON.parse(init.body as string);
      } catch {
        body = init.body;
      }
    }
    captured.push({ url: String(url), init, body });

    if (fakeResponse.kind === 'openai') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: fakeResponse.content } }],
          usage: {
            prompt_tokens: fakeResponse.promptTokens,
            completion_tokens: fakeResponse.completionTokens,
          },
        }),
        text: async () => '',
      } as any;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: fakeResponse.content }] } }],
        usageMetadata: {
          promptTokenCount: fakeResponse.promptTokenCount,
          candidatesTokenCount: fakeResponse.candidatesTokenCount,
        },
      }),
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

// ─── Tests ──────────────────────────────────────────────────

describe('LlmService funnel — request shaping', () => {
  const USER_ID = 'user-test-1';

  describe('OpenAI: reasoning vs non-reasoning param shape', () => {
    it('gpt-5.5 (reasoning) uses max_completion_tokens, no temperature, no max_tokens', async () => {
      const { service } = makeService({ llmProvider: 'openai', llmModel: 'gpt-5.5' });
      const fakeFetch = installFetchMock({
        kind: 'openai',
        content: 'ok',
        promptTokens: 10,
        completionTokens: 20,
      });
      try {
        await service.callLlmStructured(USER_ID, {
          systemPrompt: 'sys',
          messages: [{ role: 'user', content: 'hi' }],
          temperature: 0.4, // should be DROPPED by the funnel for gpt-5.x
          maxTokens: 256,
        });

        expect(fakeFetch.captured).toHaveLength(1);
        const req = fakeFetch.captured[0]!;
        expect(req.url).toContain('api.openai.com/v1/chat/completions');
        expect(req.body.model).toBe('gpt-5.5');
        expect(req.body.max_completion_tokens).toBe(256);
        expect(req.body.max_tokens).toBeUndefined();
        expect(req.body.temperature).toBeUndefined();
      } finally {
        fakeFetch.restore();
      }
    });

    it('gpt-5.4-mini (default reasoning) uses max_completion_tokens, no temperature', async () => {
      const { service } = makeService({ llmProvider: 'openai', llmModel: 'gpt-5.4-mini' });
      const fakeFetch = installFetchMock({
        kind: 'openai',
        content: 'ok',
        promptTokens: 5,
        completionTokens: 7,
      });
      try {
        await service.callLlmStructured(USER_ID, {
          systemPrompt: 'sys',
          messages: [{ role: 'user', content: 'hello' }],
          maxTokens: 1024,
          temperature: 0.7,
        });
        const req = fakeFetch.captured[0]!;
        expect(req.body.max_completion_tokens).toBe(1024);
        expect(req.body.max_tokens).toBeUndefined();
        expect(req.body.temperature).toBeUndefined();
      } finally {
        fakeFetch.restore();
      }
    });

    it('gpt-4o-mini (legacy) uses max_tokens + temperature', async () => {
      const { service } = makeService({ llmProvider: 'openai', llmModel: 'gpt-4o-mini' });
      const fakeFetch = installFetchMock({
        kind: 'openai',
        content: 'ok',
        promptTokens: 3,
        completionTokens: 4,
      });
      try {
        await service.callLlmStructured(USER_ID, {
          systemPrompt: 'sys',
          messages: [{ role: 'user', content: 'hello' }],
          maxTokens: 512,
          temperature: 0.3,
        });
        const req = fakeFetch.captured[0]!;
        expect(req.body.max_tokens).toBe(512);
        expect(req.body.max_completion_tokens).toBeUndefined();
        expect(req.body.temperature).toBe(0.3);
      } finally {
        fakeFetch.restore();
      }
    });

    it('OpenAI request maps the system prompt to a system-role message', async () => {
      const { service } = makeService({ llmProvider: 'openai', llmModel: 'gpt-4o-mini' });
      const fakeFetch = installFetchMock({
        kind: 'openai',
        content: 'ok',
        promptTokens: 1,
        completionTokens: 1,
      });
      try {
        await service.callLlmStructured(USER_ID, {
          systemPrompt: 'YOU ARE A TUTOR',
          messages: [{ role: 'user', content: 'q' }],
        });
        const req = fakeFetch.captured[0]!;
        expect(Array.isArray(req.body.messages)).toBe(true);
        expect(req.body.messages[0]).toEqual({ role: 'system', content: 'YOU ARE A TUTOR' });
        expect(req.body.messages[1]).toEqual({ role: 'user', content: 'q' });
      } finally {
        fakeFetch.restore();
      }
    });
  });

  describe('Gemini: thinking + system instruction shape', () => {
    it('gemini-3.5-flash (default) uses thinkingLevel (NOT thinking_budget) and top-level systemInstruction', async () => {
      const { service } = makeService({ llmProvider: 'gemini', llmModel: 'gemini-3.5-flash' });
      const fakeFetch = installFetchMock({
        kind: 'gemini',
        content: 'ok',
        promptTokenCount: 12,
        candidatesTokenCount: 34,
      });
      try {
        await service.callLlmStructured(USER_ID, {
          systemPrompt: 'TUTOR SYS',
          messages: [{ role: 'user', content: 'hi' }],
        });
        expect(fakeFetch.captured).toHaveLength(1);
        const req = fakeFetch.captured[0]!;
        expect(req.url).toContain('gemini-3.5-flash:generateContent');
        // systemInstruction at top level
        expect(req.body.systemInstruction).toBeDefined();
        expect(req.body.systemInstruction.parts[0].text).toBe('TUTOR SYS');
        // contents has NO `system` role
        for (const c of req.body.contents) {
          expect(c.role).not.toBe('system');
        }
        // thinkingConfig.thinkingLevel set, NOT thinkingBudget
        expect(req.body.generationConfig.thinkingConfig).toBeDefined();
        expect(req.body.generationConfig.thinkingConfig.thinkingLevel).toBeDefined();
        expect(req.body.generationConfig.thinkingConfig.thinkingBudget).toBeUndefined();
        expect(req.body.generationConfig.thinking_budget).toBeUndefined();
      } finally {
        fakeFetch.restore();
      }
    });

    it('gemini-3.1-pro (reasoning) uses thinkingLevel', async () => {
      const { service } = makeService({ llmProvider: 'gemini', llmModel: 'gemini-3.1-pro' });
      const fakeFetch = installFetchMock({
        kind: 'gemini',
        content: 'ok',
        promptTokenCount: 1,
        candidatesTokenCount: 1,
      });
      try {
        await service.callLlmStructured(USER_ID, {
          systemPrompt: 'sys',
          messages: [{ role: 'user', content: 'hi' }],
        });
        const req = fakeFetch.captured[0]!;
        expect(req.url).toContain('gemini-3.1-pro:generateContent');
        expect(req.body.generationConfig.thinkingConfig.thinkingLevel).toBeDefined();
        expect(req.body.generationConfig.thinkingConfig.thinkingBudget).toBeUndefined();
      } finally {
        fakeFetch.restore();
      }
    });

    it('gemini-2.5-flash (legacy) uses thinkingBudget integer', async () => {
      const { service } = makeService({ llmProvider: 'gemini', llmModel: 'gemini-2.5-flash' });
      const fakeFetch = installFetchMock({
        kind: 'gemini',
        content: 'ok',
        promptTokenCount: 1,
        candidatesTokenCount: 1,
      });
      try {
        await service.callLlmStructured(USER_ID, {
          systemPrompt: 'sys',
          messages: [{ role: 'user', content: 'hi' }],
        });
        const req = fakeFetch.captured[0]!;
        expect(req.body.generationConfig.thinkingConfig).toBeDefined();
        expect(typeof req.body.generationConfig.thinkingConfig.thinkingBudget).toBe('number');
        expect(req.body.generationConfig.thinkingConfig.thinkingLevel).toBeUndefined();
      } finally {
        fakeFetch.restore();
      }
    });

    it('Gemini user/assistant role names map (assistant → model)', async () => {
      const { service } = makeService({ llmProvider: 'gemini', llmModel: 'gemini-3.5-flash' });
      const fakeFetch = installFetchMock({
        kind: 'gemini',
        content: 'ok',
        promptTokenCount: 1,
        candidatesTokenCount: 1,
      });
      try {
        await service.callLlmStructured(USER_ID, {
          systemPrompt: 'sys',
          messages: [
            { role: 'user', content: 'q1' },
            { role: 'assistant', content: 'a1' },
            { role: 'user', content: 'q2' },
          ],
        });
        const req = fakeFetch.captured[0]!;
        expect(req.body.contents.map((c: any) => c.role)).toEqual(['user', 'model', 'user']);
      } finally {
        fakeFetch.restore();
      }
    });
  });

  describe('JSON mode + schema', () => {
    it('OpenAI: jsonMode (no schema) → response_format: { type: "json_object" }', async () => {
      const { service } = makeService({ llmProvider: 'openai', llmModel: 'gpt-4o-mini' });
      const fakeFetch = installFetchMock({
        kind: 'openai',
        content: '{}',
        promptTokens: 1,
        completionTokens: 1,
      });
      try {
        await service.callLlmStructured(USER_ID, {
          systemPrompt: 'sys',
          messages: [{ role: 'user', content: 'q' }],
          jsonMode: true,
        });
        const req = fakeFetch.captured[0]!;
        expect(req.body.response_format).toEqual({ type: 'json_object' });
      } finally {
        fakeFetch.restore();
      }
    });

    it('OpenAI: jsonSchema → response_format: json_schema with schema', async () => {
      const { service } = makeService({ llmProvider: 'openai', llmModel: 'gpt-4o-mini' });
      const fakeFetch = installFetchMock({
        kind: 'openai',
        content: '{}',
        promptTokens: 1,
        completionTokens: 1,
      });
      try {
        const schema = {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
        };
        await service.callLlmStructured(USER_ID, {
          systemPrompt: 'sys',
          messages: [{ role: 'user', content: 'q' }],
          jsonSchema: schema,
        });
        const req = fakeFetch.captured[0]!;
        expect(req.body.response_format.type).toBe('json_schema');
        expect(req.body.response_format.json_schema.schema).toEqual(schema);
      } finally {
        fakeFetch.restore();
      }
    });

    it('Gemini: jsonMode → responseMimeType "application/json", no schema', async () => {
      const { service } = makeService({ llmProvider: 'gemini', llmModel: 'gemini-3.5-flash' });
      const fakeFetch = installFetchMock({
        kind: 'gemini',
        content: '{}',
        promptTokenCount: 1,
        candidatesTokenCount: 1,
      });
      try {
        await service.callLlmStructured(USER_ID, {
          systemPrompt: 'sys',
          messages: [{ role: 'user', content: 'q' }],
          jsonMode: true,
        });
        const req = fakeFetch.captured[0]!;
        expect(req.body.generationConfig.responseMimeType).toBe('application/json');
        expect(req.body.generationConfig.responseSchema).toBeUndefined();
      } finally {
        fakeFetch.restore();
      }
    });

    it('Gemini: jsonSchema → responseMimeType + responseSchema', async () => {
      const { service } = makeService({ llmProvider: 'gemini', llmModel: 'gemini-3.5-flash' });
      const fakeFetch = installFetchMock({
        kind: 'gemini',
        content: '{}',
        promptTokenCount: 1,
        candidatesTokenCount: 1,
      });
      try {
        const schema = { type: 'object', properties: { x: { type: 'number' } } };
        await service.callLlmStructured(USER_ID, {
          systemPrompt: 'sys',
          messages: [{ role: 'user', content: 'q' }],
          jsonSchema: schema,
        });
        const req = fakeFetch.captured[0]!;
        expect(req.body.generationConfig.responseMimeType).toBe('application/json');
        expect(req.body.generationConfig.responseSchema).toEqual(schema);
      } finally {
        fakeFetch.restore();
      }
    });
  });

  describe('Response normalization', () => {
    it('OpenAI usage.prompt_tokens / completion_tokens → non-zero promptTokens / completionTokens', async () => {
      const { service } = makeService({ llmProvider: 'openai', llmModel: 'gpt-4o-mini' });
      const fakeFetch = installFetchMock({
        kind: 'openai',
        content: 'hello world',
        promptTokens: 42,
        completionTokens: 99,
      });
      try {
        const out = await service.callLlmStructured(USER_ID, {
          systemPrompt: 'sys',
          messages: [{ role: 'user', content: 'q' }],
        });
        expect(out.content).toBe('hello world');
        expect(out.promptTokens).toBe(42);
        expect(out.completionTokens).toBe(99);
        expect(out.provider).toBe('openai');
        expect(out.model).toBe('gpt-4o-mini');
      } finally {
        fakeFetch.restore();
      }
    });

    it('Gemini usageMetadata.{promptTokenCount,candidatesTokenCount} → non-zero promptTokens / completionTokens', async () => {
      const { service } = makeService({ llmProvider: 'gemini', llmModel: 'gemini-3.5-flash' });
      const fakeFetch = installFetchMock({
        kind: 'gemini',
        content: 'hi from gemini',
        promptTokenCount: 11,
        candidatesTokenCount: 22,
      });
      try {
        const out = await service.callLlmStructured(USER_ID, {
          systemPrompt: 'sys',
          messages: [{ role: 'user', content: 'q' }],
        });
        expect(out.content).toBe('hi from gemini');
        expect(out.promptTokens).toBe(11);
        expect(out.completionTokens).toBe(22);
        expect(out.provider).toBe('gemini');
        expect(out.model).toBe('gemini-3.5-flash');
      } finally {
        fakeFetch.restore();
      }
    });
  });
});
