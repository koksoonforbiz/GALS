/**
 * LLM-turn record (Prompt B, P5 / R12, CAP-06/25): the request context and
 * the reply facts of every Learning Assistant turn.
 */
import { LearningInterventionsService } from './learning-interventions.service';

describe('LLM-turn record', () => {
  function service(opts: { attempt?: boolean; errorAgoS?: number; previous?: boolean }) {
    const now = Date.now();
    const prisma = {
      activityLog: {
        findFirst: jest.fn().mockResolvedValue(opts.attempt ? { id: 'a1' } : null),
        findMany: jest.fn().mockResolvedValue(
          opts.errorAgoS != null
            ? [
                { occurredAt: new Date(now - 5_000), metadata: { correct: true } },
                {
                  occurredAt: new Date(now - opts.errorAgoS * 1000),
                  metadata: { isCorrect: false },
                },
              ]
            : [],
        ),
      },
      llmTurn: {
        findFirst: jest.fn().mockResolvedValue(opts.previous ? { id: 'p' } : null),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const none = {} as never; // dependencies the turn record does not use
    const svc = new LearningInterventionsService(
      prisma as never,
      none,
      none,
      none,
      none,
      none,
      none,
      none,
      none,
    );
    return { prisma, svc };
  }

  const turn = {
    turnId: '22222222-2222-4222-8222-222222222222',
    requestMessageId: '33333333-3333-4333-8333-333333333333',
    userId: 'u1',
    activitySessionId: '44444444-4444-4444-8444-444444444444',
    dto: {
      message: 'why is this wrong?',
      conversationHistory: [],
      courseId: 'c1',
      contentId: 'item-1',
      selectedText: '  some selected text ',
      currentPage: 3,
      pageType: 'pdf',
    },
    contextSource: 'selection',
    model: 'model-x',
    latencyMs: 1234,
    promptTokens: 100,
    completionTokens: 50,
    suggestedStrategy: null,
    flags: ['pii_in_reply'],
  };

  it('records the request context and the reply facts', async () => {
    const { prisma, svc } = service({ attempt: true, errorAgoS: 40, previous: true });
    await (svc as unknown as { recordLlmTurn: (t: typeof turn) => Promise<void> }).recordLlmTurn(
      turn,
    );
    expect(prisma.llmTurn.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: turn.turnId,
        requestMessageId: turn.requestMessageId,
        sessionId: turn.activitySessionId,
        channel: 'learning_assistant',
        selectionSource: 'selection',
        selectionLen: 'some selected text'.length,
        contextSource: 'selection',
        currentPage: 3,
        attemptBefore: true,
        timeSinceLastErrorS: 40,
        followUp: true,
        model: 'model-x',
        latencyMs: 1234,
        responseRole: 'assistant',
        guardrailFlags: ['pii_in_reply'],
      }),
    });
  });

  it('no attempt, no error, no earlier turn; never throws', async () => {
    const { prisma, svc } = service({});
    await (svc as unknown as { recordLlmTurn: (t: typeof turn) => Promise<void> }).recordLlmTurn({
      ...turn,
      dto: { ...turn.dto, selectedText: '' },
    });
    expect(prisma.llmTurn.create.mock.calls[0][0].data).toMatchObject({
      selectionSource: 'none',
      selectionLen: 0,
      attemptBefore: false,
      timeSinceLastErrorS: null,
      followUp: false,
    });
    prisma.llmTurn.create.mockRejectedValue(new Error('db down'));
    await expect(
      (svc as unknown as { recordLlmTurn: (t: typeof turn) => Promise<void> }).recordLlmTurn(turn),
    ).resolves.toBeUndefined();
  });
});
