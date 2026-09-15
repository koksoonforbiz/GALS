/**
 * Bedrock Guardrails wiring (SMU checklist items 62/63).
 *
 * `callBedrockApi` must attach a `guardrailConfig` block to the Converse
 * request only when `BEDROCK_GUARDRAIL_ID` is configured, and must
 * surface a `guardrail_intervened` stop reason as `guardrailIntervened`
 * (with a warn log) while passing the guardrail's own blocked message
 * through as the content. Mocks `global.fetch` — no real network calls.
 */

import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LlmService } from '../rag/llm.service';
import { getChatModel } from './model-registry';

const BEDROCK_MODEL = 'global.openai.gpt-5.6-terra';

function makeService(env: Record<string, string>): LlmService {
  const prisma: any = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    llmUsageLog: { create: jest.fn().mockResolvedValue({}) },
    llmAuditLog: { create: jest.fn().mockResolvedValue({}) },
    llmModelPricing: { findFirst: jest.fn().mockResolvedValue(null) },
    sourceDocument: { updateMany: jest.fn() },
    studentSourceDocument: { updateMany: jest.fn() },
  };
  const config = {
    get: (key: string, defaultValue?: unknown) => env[key] ?? defaultValue,
    getOrThrow: (key: string) => env[key] ?? 'test-secret-must-be-at-least-16-chars',
  } as unknown as ConfigService;
  const usageQuota = { assertNotExceeded: jest.fn(), recordSpend: jest.fn() } as any;
  const securityEvents = { record: jest.fn() } as any;
  return new LlmService(
    prisma,
    config,
    null as any,
    new EventEmitter2(),
    usageQuota,
    securityEvents,
  );
}

function installFetchMock(response: Record<string, unknown>): {
  bodies: any[];
  restore: () => void;
} {
  const bodies: any[] = [];
  const previous = global.fetch;
  (global as any).fetch = jest.fn(async (_url: unknown, init: any) => {
    bodies.push(JSON.parse(init.body as string));
    return { ok: true, status: 200, json: async () => response, text: async () => '' } as any;
  });
  return {
    bodies,
    restore: () => {
      (global as any).fetch = previous;
    },
  };
}

const NORMAL_RESPONSE = {
  output: { message: { content: [{ text: 'a normal answer' }] } },
  usage: { inputTokens: 10, outputTokens: 5 },
  stopReason: 'end_turn',
};

async function callBedrock(service: LlmService) {
  const spec = getChatModel(BEDROCK_MODEL);
  if (!spec) throw new Error(`test model ${BEDROCK_MODEL} missing from registry`);
  return (service as any).callBedrockApi(
    { systemPrompt: 'sys', messages: [{ role: 'user', content: 'q' }] },
    'bearer-token',
    BEDROCK_MODEL,
    spec,
  );
}

describe('LlmService — Bedrock Guardrails (checklist items 62/63)', () => {
  it('sends no guardrailConfig when BEDROCK_GUARDRAIL_ID is unset', async () => {
    const service = makeService({});
    const fetchMock = installFetchMock(NORMAL_RESPONSE);
    try {
      const out = await callBedrock(service);
      expect(fetchMock.bodies).toHaveLength(1);
      expect(fetchMock.bodies[0]).not.toHaveProperty('guardrailConfig');
      expect(out.guardrailIntervened).toBe(false);
      expect(out.content).toBe('a normal answer');
    } finally {
      fetchMock.restore();
    }
  });

  it('attaches guardrailConfig (id, version, trace) when configured', async () => {
    const service = makeService({
      BEDROCK_GUARDRAIL_ID: 'gr-abc123',
      BEDROCK_GUARDRAIL_VERSION: '2',
    });
    const fetchMock = installFetchMock(NORMAL_RESPONSE);
    try {
      await callBedrock(service);
      expect(fetchMock.bodies[0].guardrailConfig).toEqual({
        guardrailIdentifier: 'gr-abc123',
        guardrailVersion: '2',
        trace: 'enabled',
      });
    } finally {
      fetchMock.restore();
    }
  });

  it('defaults the guardrail version to DRAFT', async () => {
    const service = makeService({ BEDROCK_GUARDRAIL_ID: 'gr-abc123' });
    const fetchMock = installFetchMock(NORMAL_RESPONSE);
    try {
      await callBedrock(service);
      expect(fetchMock.bodies[0].guardrailConfig.guardrailVersion).toBe('DRAFT');
    } finally {
      fetchMock.restore();
    }
  });

  it('flags an intervention, keeps the blocked message as content, and warns with the trace', async () => {
    const service = makeService({ BEDROCK_GUARDRAIL_ID: 'gr-abc123' });
    const fetchMock = installFetchMock({
      output: { message: { content: [{ text: 'Sorry, I cannot help with that.' }] } },
      usage: { inputTokens: 10, outputTokens: 0 },
      stopReason: 'guardrail_intervened',
      trace: {
        guardrail: {
          outputAssessments: { 'gr-abc123': [{ contentPolicy: { filters: [{ type: 'HATE' }] } }] },
        },
      },
    });
    const warnSpy = jest.spyOn((service as any).logger, 'warn');
    try {
      const out = await callBedrock(service);
      expect(out.guardrailIntervened).toBe(true);
      expect(out.content).toBe('Sorry, I cannot help with that.');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('guardrail intervened'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('HATE'));
    } finally {
      fetchMock.restore();
      warnSpy.mockRestore();
    }
  });
});
