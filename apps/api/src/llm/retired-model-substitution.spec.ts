/**
 * Stage 4 — read-time guard test.
 *
 * When a User row still holds a retired model id (e.g. `gemini-2.0-flash`
 * pre-migration), the funnel's `getUserApiKey` -> `resolveChatModelWithGuard`
 * path must substitute the provider's recommended default AND emit a
 * `console.warn` so operators see the stale config.
 *
 * We verify the substitution by inspecting the model id that ends up in
 * the outgoing provider request body.
 */

import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LlmService } from '../rag/llm.service';
import { defaultChatModel } from './model-registry';

function encryptViaService(service: LlmService, plain: string): string {
  return (service as any).encrypt(plain);
}

describe('LlmService — read-time guard (retired model substitution)', () => {
  it('substitutes default and emits console.warn when User.llmModel is retired (gemini-2.0-flash)', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      sourceDocument: { updateMany: jest.fn() },
      studentSourceDocument: { updateMany: jest.fn() },
      llmAuditLog: { create: jest.fn() },
      llmUsageLog: { create: jest.fn().mockResolvedValue({}) },
      llmModelPricing: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const config = {
      get: (_k: string, defaultValue?: any) =>
        defaultValue ?? 'test-secret-must-be-at-least-16-chars',
    } as unknown as ConfigService;
    const service = new LlmService(prisma, config, null as any, new EventEmitter2());

    const encrypted = encryptViaService(service, 'gm-test');
    prisma.user.findUnique.mockResolvedValue({
      llmProvider: 'gemini',
      llmModel: 'gemini-2.0-flash', // RETIRED
      llmEmbeddingModel: null,
      encryptedApiKey: encrypted,
    });

    // Spy on console.warn
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Mock fetch so we can read the substituted model from the URL
    const captured: Array<{ url: string }> = [];
    const previousFetch = global.fetch;
    (global as any).fetch = jest.fn(async (url: any) => {
      captured.push({ url: String(url) });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
        text: async () => '',
      } as any;
    });

    try {
      const out = await service.callLlmStructured('user-1', {
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
      });

      // The model in the response should be the recommended Gemini default,
      // NOT the retired id.
      const expectedDefault = defaultChatModel('gemini').id;
      expect(expectedDefault).toBe('gemini-3.5-flash');
      expect(out.model).toBe(expectedDefault);

      // Outgoing URL targets the substituted model.
      expect(captured).toHaveLength(1);
      expect(captured[0]!.url).toContain(`${expectedDefault}:generateContent`);
      expect(captured[0]!.url).not.toContain('gemini-2.0-flash');

      // Warn fired with the retired model id in the message.
      expect(warnSpy).toHaveBeenCalled();
      const warnedMessages = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(warnedMessages.some((m) => m.includes('gemini-2.0-flash'))).toBe(true);
      expect(
        warnedMessages.some((m) => m.includes(expectedDefault) || m.includes('substituting')),
      ).toBe(true);
    } finally {
      (global as any).fetch = previousFetch;
      warnSpy.mockRestore();
    }
  });

  it('does NOT warn or substitute when User.llmModel is a current selectable model', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn(),
      },
      llmUsageLog: { create: jest.fn().mockResolvedValue({}) },
      llmModelPricing: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const config = {
      get: (_k: string, defaultValue?: any) =>
        defaultValue ?? 'test-secret-must-be-at-least-16-chars',
    } as unknown as ConfigService;
    const service = new LlmService(prisma, config, null as any, new EventEmitter2());

    const encrypted = encryptViaService(service, 'sk-test');
    prisma.user.findUnique.mockResolvedValue({
      llmProvider: 'openai',
      llmModel: 'gpt-5.4-mini', // current default — selectable
      llmEmbeddingModel: null,
      encryptedApiKey: encrypted,
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const previousFetch = global.fetch;
    (global as any).fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      text: async () => '',
    })) as any;

    try {
      const out = await service.callLlmStructured('user-1', {
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(out.model).toBe('gpt-5.4-mini');
      // No retirement warnings.
      const retiredWarns = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('Read-time guard'),
      );
      expect(retiredWarns).toHaveLength(0);
    } finally {
      (global as any).fetch = previousFetch;
      warnSpy.mockRestore();
    }
  });
});
