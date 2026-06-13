/**
 * Unit tests for the practice-testing configuration surface added in
 * the 2026-06-03 extension:
 *   - `buildPracticeTestingSchema(mcq, short)` — pins minItems/maxItems
 *   - count resolution + validation inside `generatePracticeTest`
 *   - coverage validation inside `generatePracticeTest`
 *   - P4 — teacher-configured per-course default counts override the
 *     hard-coded 3+2 fallback
 *   - P2 — coverageFallback is set when the page filter yields no chunks
 *
 * The full LearningInterventionsService has 8 collaborator deps
 * (Prisma, LlmService, ActivityLogService, TextMiningService, ...) so
 * we stub them with `unknown as ...` casts. The four validation cases
 * all reject BEFORE any Prisma / LLM call, so the stubs never need to
 * do anything. Case (a) asserts the pure schema builder which has zero
 * deps. The P4 + P2 tests reach into private helpers via
 * `(svc as any).<method>` and pass a partial Prisma mock — cleaner
 * than trying to mock the full generatePracticeTest LLM funnel.
 */
import { BadRequestException } from '@nestjs/common';
import {
  LearningInterventionsService,
  buildPracticeTestingSchema,
} from './learning-interventions.service';
import type { GeneratePracticeTestDto } from './dto';

function makeService(): LearningInterventionsService {
  // Every dep is a black-box stub — none of them are reached on the
  // validation paths we exercise here.
  const stub = {} as unknown;
  return new LearningInterventionsService(
    stub as never,
    stub as never,
    stub as never,
    stub as never,
    stub as never,
    stub as never,
    stub as never,
    stub as never,
  );
}

/** Build a service with a minimal Prisma mock that returns the
 *  passed-in fixtures for the queries the helpers actually issue.
 *  Returns the service + a handle to the mock so individual tests
 *  can tweak what's returned per-call. */
function makeServiceWithPrismaMock(prisma: Record<string, unknown>) {
  const stub = {} as unknown;
  return new LearningInterventionsService(
    prisma as never,
    stub as never,
    stub as never,
    stub as never,
    stub as never,
    stub as never,
    stub as never,
    stub as never,
  );
}

describe('LearningInterventionsService.generatePracticeTest — config & coverage', () => {
  describe('buildPracticeTestingSchema', () => {
    it('pins minItems and maxItems to mcq + short for the requested mix', () => {
      const schema = buildPracticeTestingSchema(4, 3) as {
        properties: { questions: { minItems: number; maxItems: number } };
      };
      expect(schema.properties.questions.minItems).toBe(7);
      expect(schema.properties.questions.maxItems).toBe(7);
    });

    it('still pins minItems/maxItems when one side is zero', () => {
      const schema = buildPracticeTestingSchema(5, 0) as {
        properties: { questions: { minItems: number; maxItems: number } };
      };
      expect(schema.properties.questions.minItems).toBe(5);
      expect(schema.properties.questions.maxItems).toBe(5);
    });
  });

  describe('count validation', () => {
    it('rejects mcqCount: -1 with 400', async () => {
      const svc = makeService();
      const dto: GeneratePracticeTestDto = {
        selectedText: 'a'.repeat(50),
        courseId: 'course-1',
        mcqCount: -1,
        shortAnswerCount: 2,
      };
      await expect(svc.generatePracticeTest('user-1', dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects sum of 12 (mcqCount: 7, shortAnswerCount: 5) with 400', async () => {
      const svc = makeService();
      const dto: GeneratePracticeTestDto = {
        selectedText: 'a'.repeat(50),
        courseId: 'course-1',
        mcqCount: 7,
        shortAnswerCount: 5,
      };
      await expect(svc.generatePracticeTest('user-1', dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects sum of 0 (mcqCount: 0, shortAnswerCount: 0) with 400', async () => {
      const svc = makeService();
      const dto: GeneratePracticeTestDto = {
        selectedText: 'a'.repeat(50),
        courseId: 'course-1',
        mcqCount: 0,
        shortAnswerCount: 0,
      };
      await expect(svc.generatePracticeTest('user-1', dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('coverage validation', () => {
    it('rejects pages mode with pageStart > pageEnd with 400', async () => {
      const svc = makeService();
      const dto: GeneratePracticeTestDto = {
        selectedText: 'a'.repeat(50),
        courseId: 'course-1',
        mcqCount: 3,
        shortAnswerCount: 2,
        coverage: { mode: 'pages', pageStart: 5, pageEnd: 3 },
      };
      await expect(svc.generatePracticeTest('user-1', dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects subtopic mode without a subtopic with 400', async () => {
      const svc = makeService();
      const dto: GeneratePracticeTestDto = {
        selectedText: 'a'.repeat(50),
        courseId: 'course-1',
        mcqCount: 3,
        shortAnswerCount: 2,
        coverage: { mode: 'subtopic' },
      };
      await expect(svc.generatePracticeTest('user-1', dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects pages mode with missing pageStart with 400', async () => {
      const svc = makeService();
      const dto: GeneratePracticeTestDto = {
        selectedText: 'a'.repeat(50),
        courseId: 'course-1',
        mcqCount: 3,
        shortAnswerCount: 2,
        coverage: { mode: 'pages', pageEnd: 5 },
      };
      await expect(svc.generatePracticeTest('user-1', dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // P4 — Teacher-tunable defaults.
  describe('teacher-configured default counts (P4)', () => {
    it('lookupTeacherPracticeDefaults returns the row when at least one default is set', async () => {
      const prisma = {
        interventionPromptConfig: {
          findUnique: jest.fn().mockResolvedValue({
            defaultMcqCount: 4,
            defaultShortAnswerCount: 1,
          }),
        },
      };
      const svc = makeServiceWithPrismaMock(prisma);
      const result = await (
        svc as unknown as {
          lookupTeacherPracticeDefaults: (id: string) => Promise<unknown>;
        }
      ).lookupTeacherPracticeDefaults('course-1');
      expect(result).toEqual({
        defaultMcqCount: 4,
        defaultShortAnswerCount: 1,
      });
      expect(prisma.interventionPromptConfig.findUnique).toHaveBeenCalledWith({
        where: {
          courseId_interventionType: {
            courseId: 'course-1',
            interventionType: 'PRACTICE_TESTING',
          },
        },
        select: { defaultMcqCount: true, defaultShortAnswerCount: true },
      });
    });

    it('lookupTeacherPracticeDefaults returns null when both defaults are null', async () => {
      const prisma = {
        interventionPromptConfig: {
          findUnique: jest.fn().mockResolvedValue({
            defaultMcqCount: null,
            defaultShortAnswerCount: null,
          }),
        },
      };
      const svc = makeServiceWithPrismaMock(prisma);
      const result = await (
        svc as unknown as {
          lookupTeacherPracticeDefaults: (id: string) => Promise<unknown>;
        }
      ).lookupTeacherPracticeDefaults('course-1');
      // No teacher override ⇒ caller will use the hard-coded 3+2.
      expect(result).toBeNull();
    });

    it('lookupTeacherPracticeDefaults returns null when no row exists', async () => {
      const prisma = {
        interventionPromptConfig: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      };
      const svc = makeServiceWithPrismaMock(prisma);
      const result = await (
        svc as unknown as {
          lookupTeacherPracticeDefaults: (id: string) => Promise<unknown>;
        }
      ).lookupTeacherPracticeDefaults('course-1');
      expect(result).toBeNull();
    });
  });

  // P2 — coverageFallback signalled when a page filter empties the chunk set.
  describe('coverage fallback signalling (P2)', () => {
    it('hasChunksInPageRange returns false when no chunk matches the range', async () => {
      // PDF item resolves to a sourceDocument with chunks, but none
      // in [40, 50]. The helper must return false so the caller can
      // flag coverageFallback (instead of treating the paged helper's
      // full-text fallback as a successful narrowing).
      const prisma = {
        moduleItem: {
          findUnique: jest.fn().mockResolvedValue({
            type: 'PDF',
            pdfFilename: 'lesson.pdf',
            module: { courseId: 'course-1' },
          }),
        },
        sourceDocument: {
          findFirst: jest.fn().mockResolvedValue({ id: 'doc-1' }),
        },
        documentChunk: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };
      const svc = makeServiceWithPrismaMock(prisma);
      const out = await (
        svc as unknown as {
          hasChunksInPageRange: (
            courseId: string,
            contentId: string,
            lo: number,
            hi: number,
          ) => Promise<boolean>;
        }
      ).hasChunksInPageRange('course-1', 'item-1', 40, 50);
      expect(out).toBe(false);
      expect(prisma.documentChunk.findFirst).toHaveBeenCalledWith({
        where: {
          documentId: 'doc-1',
          pageNumber: { gte: 40, lte: 50 },
        },
        select: { id: true },
      });
    });

    it('hasChunksInPageRange returns true when at least one chunk is in range', async () => {
      const prisma = {
        moduleItem: {
          findUnique: jest.fn().mockResolvedValue({
            type: 'PDF',
            pdfFilename: 'lesson.pdf',
            module: { courseId: 'course-1' },
          }),
        },
        sourceDocument: {
          findFirst: jest.fn().mockResolvedValue({ id: 'doc-1' }),
        },
        documentChunk: {
          findFirst: jest.fn().mockResolvedValue({ id: 'chunk-7' }),
        },
      };
      const svc = makeServiceWithPrismaMock(prisma);
      const out = await (
        svc as unknown as {
          hasChunksInPageRange: (
            courseId: string,
            contentId: string,
            lo: number,
            hi: number,
          ) => Promise<boolean>;
        }
      ).hasChunksInPageRange('course-1', 'item-1', 4, 9);
      expect(out).toBe(true);
    });

    it('lookupMaxPageForContent returns the highest pageNumber on the document', async () => {
      const prisma = {
        moduleItem: {
          findUnique: jest.fn().mockResolvedValue({
            type: 'PDF',
            pdfFilename: 'lesson.pdf',
            module: { courseId: 'course-1' },
          }),
        },
        sourceDocument: {
          findFirst: jest.fn().mockResolvedValue({ id: 'doc-1' }),
        },
        documentChunk: {
          findFirst: jest.fn().mockResolvedValue({ pageNumber: 20 }),
        },
      };
      const svc = makeServiceWithPrismaMock(prisma);
      const out = await (
        svc as unknown as {
          lookupMaxPageForContent: (
            courseId: string,
            contentId: string,
          ) => Promise<number | null>;
        }
      ).lookupMaxPageForContent('course-1', 'item-1');
      expect(out).toBe(20);
    });
  });
});

// ─── Bug 1/3/4 — Page-aware chat + Elab refresh (2026-06-12) ──────────
//
// The three tests below cover the new behaviour added in BUG_REPORT
// 2026-06-12:
//   1. chat() with { contentId, currentPage } narrows via the paged
//      helper around [currentPage ± W].
//   2. chat() falls back to the unwindowed resolver when no chunks
//      exist in the requested range.
//   3. askQuestion() with a per-turn currentPage re-resolves via
//      resolveInterventionContext using the LATEST page, not the
//      session-start one stored in sessionData.selectedText.
describe('LearningInterventionsService — page-aware chat + Elab refresh (2026-06-12)', () => {
  // Helper — minimal Prisma stub for chat()'s persistence path. The
  // service fires-and-forgets the createMany so a permissive stub is
  // enough; assertion happens on the spied resolver calls instead.
  function makeChatPrismaStub() {
    return {
      moduleItem: {
        findUnique: jest.fn().mockResolvedValue({
          type: 'PDF',
          pdfFilename: 'lesson.pdf',
          module: { courseId: 'course-1' },
          contentMdx: null,
        }),
      },
      sourceDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      },
      documentChunk: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      chatbotMessage: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      course: {
        findUnique: jest.fn().mockResolvedValue({ teacherId: 'teacher-1' }),
      },
    };
  }

  // Stub the LLM funnel + everything else chat() touches so the focus
  // is purely on which resolver path was taken. callLlmStructured
  // returns a canned reply with no SUGGEST tag so no strategy parse
  // logic runs.
  function stubChatDependencies(
    svc: LearningInterventionsService,
    llmStub: { callLlmStructured: jest.Mock },
  ) {
    llmStub.callLlmStructured = jest.fn().mockResolvedValue({
      content: 'stub reply',
      promptTokens: 1,
      completionTokens: 1,
      model: 'gpt-stub',
    });

    // Quiet the helpers that pull noisy metadata for the citation
    // label / teacher key lookup so they don't blow up on the bare
    // Prisma stub.
    (svc as unknown as { lookupPdfFilenameForContent: jest.Mock }).lookupPdfFilenameForContent =
      jest.fn().mockResolvedValue('lesson.pdf');
    (
      svc as unknown as { getCourseTeacherIdWithApiKey: jest.Mock }
    ).getCourseTeacherIdWithApiKey = jest.fn().mockResolvedValue('teacher-1');
  }

  it('chat() with { contentId, currentPage: 10 } fetches page-windowed chunks via tryResolveFromModuleItemPaged', async () => {
    const prisma = makeChatPrismaStub();
    const stub = {} as unknown;
    const llmService = { callLlmStructured: jest.fn() };
    const svc = new LearningInterventionsService(
      prisma as never,
      llmService as never,
      stub as never,
      stub as never,
      stub as never,
      stub as never,
      stub as never,
      stub as never,
    );
    stubChatDependencies(svc, llmService);

    const hasChunksSpy = jest
      .spyOn(
        svc as unknown as { hasChunksInPageRange: jest.Mock },
        'hasChunksInPageRange',
      )
      .mockResolvedValue(true);
    const pagedSpy = jest
      .spyOn(
        svc as unknown as { tryResolveFromModuleItemPaged: jest.Mock },
        'tryResolveFromModuleItemPaged',
      )
      .mockResolvedValue('PAGED PDF TEXT pp.8-12');
    const unwindowedSpy = jest
      .spyOn(
        svc as unknown as { tryResolveFromModuleItem: jest.Mock },
        'tryResolveFromModuleItem',
      )
      .mockResolvedValue('FULL PDF TEXT (should not be used)');

    delete process.env.RAG_PAGE_WINDOW; // default window = 2

    await svc.chat(
      'student-1',
      {
        message: 'what is this page about?',
        conversationHistory: [],
        courseId: 'course-1',
        contentId: 'item-1',
        currentPage: 10,
      },
      undefined,
    );

    // Window default = 2 → [8, 12].
    expect(hasChunksSpy).toHaveBeenCalledWith('course-1', 'item-1', 8, 12);
    expect(pagedSpy).toHaveBeenCalledWith('course-1', 'item-1', 8, 12);
    // The unwindowed resolver must NOT have been called when the
    // paged fetch succeeded.
    expect(unwindowedSpy).not.toHaveBeenCalled();
  });

  it('chat() falls back to tryResolveFromModuleItem when no chunks exist in the page range', async () => {
    const prisma = makeChatPrismaStub();
    const stub = {} as unknown;
    const llmService = { callLlmStructured: jest.fn() };
    const svc = new LearningInterventionsService(
      prisma as never,
      llmService as never,
      stub as never,
      stub as never,
      stub as never,
      stub as never,
      stub as never,
      stub as never,
    );
    stubChatDependencies(svc, llmService);

    // hasChunksInPageRange = false → the chat() guard should skip
    // the paged fetch entirely and fall through to the unwindowed
    // resolver.
    const hasChunksSpy = jest
      .spyOn(
        svc as unknown as { hasChunksInPageRange: jest.Mock },
        'hasChunksInPageRange',
      )
      .mockResolvedValue(false);
    const pagedSpy = jest
      .spyOn(
        svc as unknown as { tryResolveFromModuleItemPaged: jest.Mock },
        'tryResolveFromModuleItemPaged',
      )
      .mockResolvedValue(null);
    const unwindowedSpy = jest
      .spyOn(
        svc as unknown as { tryResolveFromModuleItem: jest.Mock },
        'tryResolveFromModuleItem',
      )
      .mockResolvedValue('FULL PDF TEXT (fallback)');

    delete process.env.RAG_PAGE_WINDOW;

    await svc.chat(
      'student-1',
      {
        message: 'anything',
        conversationHistory: [],
        courseId: 'course-1',
        contentId: 'item-1',
        currentPage: 10,
      },
      undefined,
    );

    expect(hasChunksSpy).toHaveBeenCalledWith('course-1', 'item-1', 8, 12);
    expect(pagedSpy).not.toHaveBeenCalled();
    // Triple-defensive: when the page window has no chunks, the
    // chat() path must still produce a grounded reply by falling
    // back to the unwindowed PDF text.
    expect(unwindowedSpy).toHaveBeenCalledWith('course-1', 'item-1');
  });

  it('askQuestion() with per-turn currentPage re-resolves via resolveInterventionContext (NOT the frozen session-start text)', async () => {
    const SESSION_START_TEXT = 'slide-10 frozen context — must NOT be used';
    const REFRESHED_TEXT = 'slide-12 fresh context after scroll';

    const prisma = {
      learningIntervention: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1',
          userId: 'student-1',
          type: 'INTERROGATIVE_ELABORATION',
          courseId: 'course-1',
          sessionData: {
            suggestedQuestions: [],
            keyConcepts: [],
            conversation: [],
            selectedText: SESSION_START_TEXT,
            questionsAsked: 0,
          },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const stub = {} as unknown;
    const llmService = {
      callLlmForUser: jest.fn().mockResolvedValue({ content: 'fresh answer' }),
    } as unknown;
    const svc = new LearningInterventionsService(
      prisma as never,
      llmService as never,
      stub as never,
      stub as never,
      stub as never,
      stub as never,
      stub as never,
      stub as never,
    );

    (
      svc as unknown as { getCourseTeacherIdWithApiKey: jest.Mock }
    ).getCourseTeacherIdWithApiKey = jest.fn().mockResolvedValue('teacher-1');

    const resolveSpy = jest
      .spyOn(
        svc as unknown as { resolveInterventionContext: jest.Mock },
        'resolveInterventionContext',
      )
      .mockResolvedValue({
        text: REFRESHED_TEXT,
        source: 'pdf-source',
        evidence: null,
      });

    delete process.env.RAG_PAGE_WINDOW; // default window = 2

    const out = await svc.askQuestion('student-1', 'session-1', {
      question: 'what is on this NEW slide?',
      conversationHistory: [],
      // The per-turn payload — currentPage 12 must beat
      // sessionData.selectedText which was frozen at slide 10.
      currentPage: 12,
      contentId: 'item-1',
      courseId: 'course-1',
    });

    // The resolver MUST have been called, and with the FRESH page
    // window — not the session-start state.
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    const callArgs = resolveSpy.mock.calls[0]![1] as {
      coverage?: { mode: string; pageStart: number; pageEnd: number };
      contentId?: string;
    };
    expect(callArgs.coverage).toEqual({
      mode: 'pages',
      pageStart: 10,
      pageEnd: 14,
    });
    expect(callArgs.contentId).toBe('item-1');

    // The downstream LLM must have been called with the REFRESHED
    // text in the system prompt — buildElaborationAnswerPrompt embeds
    // sourceText into `system`, with the bare question going as
    // `user`. callLlmForUser(teacherId, system, user, opts).
    const llmCalls = (llmService as { callLlmForUser: jest.Mock }).callLlmForUser.mock.calls;
    expect(llmCalls.length).toBe(1);
    const systemPrompt = String(llmCalls[0][1] ?? '');
    expect(systemPrompt).toContain(REFRESHED_TEXT);
    expect(systemPrompt).not.toContain(SESSION_START_TEXT);

    expect(out).toEqual({ answer: 'fresh answer' });

    // The new conversation entry must persist the per-turn page so
    // the student review surface can render "(page 12)".
    const updateCall = (prisma.learningIntervention.update as jest.Mock).mock.calls[0]![0];
    const sessionData = updateCall.data.sessionData as {
      conversation: Array<{ role: string; currentPage?: number }>;
    };
    const userTurn = sessionData.conversation.find((m) => m.role === 'user');
    expect(userTurn?.currentPage).toBe(12);
  });
});
