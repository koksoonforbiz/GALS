/**
 * Stage 4 — server-side model validation tests (save layer).
 *
 * Drives `LlmService.saveApiKey` with a stub Prisma and asserts that the
 * stage 2 validation layer rejects:
 *   - Unknown model ids
 *   - Mismatched provider/id pairs (e.g. `bedrock` provider + a Gemini model)
 *   - Retired/non-selectable model ids (e.g. `gemini-2.0-flash`)
 *   - A non-Bedrock provider entirely (product decision: teachers can no
 *     longer bring their own OpenAI/Gemini key — see
 *     LlmService.assertSelectableProvider's doc comment)
 *
 * No DB; no network; no real provider call.
 */

import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException } from '@nestjs/common';
import { LlmService } from '../rag/llm.service';

function makeService(): { service: LlmService; prisma: any } {
  const prisma: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ llmEmbeddingModel: null }),
      update: jest.fn().mockResolvedValue({}),
    },
    sourceDocument: { updateMany: jest.fn() },
    studentSourceDocument: { updateMany: jest.fn() },
    llmAuditLog: { create: jest.fn() },
    llmUsageLog: { create: jest.fn() },
    llmModelPricing: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const config = {
    get: (_k: string, defaultValue?: any) =>
      defaultValue ?? 'test-secret-must-be-at-least-16-chars',
    getOrThrow: (_k: string) => 'test-secret-must-be-at-least-16-chars',
  } as unknown as ConfigService;
  const eventEmitter = new EventEmitter2();
  const usageQuota = { assertNotExceeded: jest.fn(), recordSpend: jest.fn() } as any;
  const securityEvents = { record: jest.fn() } as any;
  const service = new LlmService(
    prisma,
    config,
    null as any,
    eventEmitter,
    usageQuota,
    securityEvents,
  );
  return { service, prisma };
}

describe('LlmService.saveApiKey — validation', () => {
  describe('rejects', () => {
    it('unknown chat model id → BadRequestException', async () => {
      const { service } = makeService();
      await expect(
        service.saveApiKey('user-1', 'bedrock', '', 'gpt-9000-unobtanium'),
      ).rejects.toThrow(BadRequestException);
    });

    it('mismatched provider/id (bedrock provider + gemini model) → BadRequestException', async () => {
      const { service } = makeService();
      await expect(service.saveApiKey('user-1', 'bedrock', '', 'gemini-3.5-flash')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('mismatched provider/id (bedrock provider + openai model) → BadRequestException', async () => {
      const { service } = makeService();
      await expect(service.saveApiKey('user-1', 'bedrock', '', 'gpt-5.4-mini')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('retired gemini-2.0-flash → BadRequestException (also caught by the provider check below, but the model itself is retired regardless)', async () => {
      const { service } = makeService();
      await expect(
        service.saveApiKey('user-1', 'gemini', 'gm-test', 'gemini-2.0-flash'),
      ).rejects.toThrow(BadRequestException);
    });

    it('openai provider → BadRequestException (no longer selectable)', async () => {
      const { service } = makeService();
      await expect(
        service.saveApiKey('user-1', 'openai', 'sk-test', 'gpt-5.4-mini'),
      ).rejects.toThrow('Only "bedrock" can be selected');
    });

    it('gemini provider → BadRequestException (no longer selectable)', async () => {
      const { service } = makeService();
      await expect(
        service.saveApiKey('user-1', 'gemini', 'gm-test', 'gemini-3.5-flash'),
      ).rejects.toThrow('Only "bedrock" can be selected');
    });

    it('unsupported provider string → BadRequestException', async () => {
      const { service } = makeService();
      await expect(
        service.saveApiKey('user-1', 'mistral', 'mst-test', 'gpt-5.4-mini'),
      ).rejects.toThrow(BadRequestException);
    });

    it('unknown embedding model id → BadRequestException', async () => {
      const { service } = makeService();
      await expect(
        service.saveApiKey(
          'user-1',
          'bedrock',
          '',
          'global.openai.gpt-5.6-sol',
          'text-embedding-9000-nonexistent',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('mismatched embedding model provider → BadRequestException', async () => {
      const { service } = makeService();
      await expect(
        service.saveApiKey(
          'user-1',
          'bedrock',
          '',
          'global.openai.gpt-5.6-sol',
          'gemini-embedding-001',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('accepts', () => {
    it('valid bedrock default save', async () => {
      const { service, prisma } = makeService();
      await service.saveApiKey('user-1', 'bedrock', '', 'global.openai.gpt-5.6-sol');
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      const updateArg = prisma.user.update.mock.calls[0]![0];
      expect(updateArg.data.llmModel).toBe('global.openai.gpt-5.6-sol');
      expect(updateArg.data.llmEmbeddingModel).toBe('global.cohere.embed-v4:0');
      // Bedrock uses one shared server-side credential — nothing per-teacher
      // to encrypt/store.
      expect(updateArg.data.encryptedApiKey).toBeNull();
    });

    it('the other selectable bedrock chat model (Terra) is accepted too', async () => {
      const { service, prisma } = makeService();
      await service.saveApiKey('user-1', 'bedrock', '', 'global.openai.gpt-5.6-terra');
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      expect(prisma.user.update.mock.calls[0]![0].data.llmModel).toBe(
        'global.openai.gpt-5.6-terra',
      );
    });
  });
});
