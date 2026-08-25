/**
 * Stage 4 — server-side model validation tests (save layer).
 *
 * Drives `LlmService.saveApiKey` with a stub Prisma and asserts that the
 * stage 2 validation layer rejects:
 *   - Unknown model ids
 *   - Mismatched provider/id pairs (e.g. `openai` + `gemini-3.5-flash`)
 *   - Retired/non-selectable model ids (e.g. `gemini-2.0-flash`)
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
  const service = new LlmService(prisma, config, null as any, eventEmitter);
  return { service, prisma };
}

describe('LlmService.saveApiKey — validation', () => {
  describe('rejects', () => {
    it('unknown chat model id → BadRequestException', async () => {
      const { service } = makeService();
      await expect(
        service.saveApiKey('user-1', 'openai', 'sk-test', 'gpt-9000-unobtanium'),
      ).rejects.toThrow(BadRequestException);
    });

    it('mismatched provider/id (openai provider + gemini model) → BadRequestException', async () => {
      const { service } = makeService();
      await expect(
        service.saveApiKey('user-1', 'openai', 'sk-test', 'gemini-3.5-flash'),
      ).rejects.toThrow(BadRequestException);
    });

    it('mismatched provider/id (gemini provider + openai model) → BadRequestException', async () => {
      const { service } = makeService();
      await expect(
        service.saveApiKey('user-1', 'gemini', 'gm-test', 'gpt-5.4-mini'),
      ).rejects.toThrow(BadRequestException);
    });

    it('retired gemini-2.0-flash → BadRequestException', async () => {
      const { service } = makeService();
      await expect(
        service.saveApiKey('user-1', 'gemini', 'gm-test', 'gemini-2.0-flash'),
      ).rejects.toThrow(BadRequestException);
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
          'openai',
          'sk-test',
          'gpt-5.4-mini',
          'text-embedding-9000-nonexistent',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('mismatched embedding model provider → BadRequestException', async () => {
      const { service } = makeService();
      await expect(
        service.saveApiKey('user-1', 'openai', 'sk-test', 'gpt-5.4-mini', 'gemini-embedding-001'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('accepts', () => {
    it('valid openai default save', async () => {
      const { service, prisma } = makeService();
      await service.saveApiKey('user-1', 'openai', 'sk-test', 'gpt-5.4-mini');
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      const updateArg = prisma.user.update.mock.calls[0]![0];
      expect(updateArg.data.llmModel).toBe('gpt-5.4-mini');
      expect(updateArg.data.llmEmbeddingModel).toBe('text-embedding-3-small');
    });

    it('valid gemini default save', async () => {
      const { service, prisma } = makeService();
      await service.saveApiKey('user-1', 'gemini', 'gm-test', 'gemini-3.5-flash');
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      const updateArg = prisma.user.update.mock.calls[0]![0];
      expect(updateArg.data.llmModel).toBe('gemini-3.5-flash');
      expect(updateArg.data.llmEmbeddingModel).toBe('gemini-embedding-001');
    });

    it('legacy-but-still-selectable model (gpt-4o-mini) accepted', async () => {
      // gpt-4o-mini is `deprecated: true` but has no past `retiresOn` so it
      // remains selectable for teachers who already configured it.
      const { service, prisma } = makeService();
      await service.saveApiKey('user-1', 'openai', 'sk-test', 'gpt-4o-mini');
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      expect(prisma.user.update.mock.calls[0]![0].data.llmModel).toBe('gpt-4o-mini');
    });
  });
});
