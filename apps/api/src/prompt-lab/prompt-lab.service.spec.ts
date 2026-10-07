import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { PromptLabService, PROMPT_LAB_DEFAULT_SYSTEM } from './prompt-lab.service';
import { approxTokens, wordDiffStats } from './text-diff';

const LESSON = {
  slides: [
    { key: 's1-3', t: 'think' },
    { key: 's1-21', t: 'task' },
    { key: 's1-19', t: 'exercise' },
  ],
};

function item() {
  return {
    type: 'INTERACTIVE_LESSON',
    lessonJson: LESSON,
    module: { courseId: 'course-1', course: { teacherId: 'teacher-1' } },
  };
}

function createMocks() {
  const prisma = {
    moduleItem: { findUnique: jest.fn().mockResolvedValue(item()) },
    enrollment: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    course: { findUnique: jest.fn() },
    promptLabRun: {
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { promptTokens: 0, completionTokens: 0 } }),
      create: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve({ id: `run-${data.sampleNo}`, ...data })),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    promptLabVersion: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'v', ...data })),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    promptLabTestCase: {
      findUnique: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      findMany: jest.fn().mockResolvedValue([]),
    },
    promptLabTestResult: {
      upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve(create)),
    },
    promptLabOutputRating: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
    },
  };
  const llm = {
    callLlmStructured: jest.fn().mockResolvedValue({
      content: 'answer',
      promptTokens: 120,
      completionTokens: 30,
      model: 'm1',
      provider: 'bedrock',
    }),
    getResolvedChatModelForUser: jest.fn().mockResolvedValue(null),
  };
  return { prisma, llm };
}

describe('PromptLabService', () => {
  let m: ReturnType<typeof createMocks>;
  let service: PromptLabService;
  const base = {
    moduleItemId: '11111111-1111-1111-1111-111111111111',
    slideKey: 's1-21',
    samples: 1,
  };

  beforeEach(() => {
    m = createMocks();
    service = new PromptLabService(m.prisma as any, m.llm as any);
  });

  describe('run', () => {
    it('calls the funnel as the course teacher, attributed to the student', async () => {
      const res = await service.run('stu-1', {
        ...base,
        promptText: 'Summarise this.',
        temperature: 0.7,
        model: 'm2',
      });
      expect(m.llm.callLlmStructured).toHaveBeenCalledWith(
        'teacher-1',
        expect.objectContaining({
          systemPrompt: PROMPT_LAB_DEFAULT_SYSTEM,
          messages: [{ role: 'user', content: 'Summarise this.' }],
          temperature: 0.7,
          model: 'm2',
        }),
        { feature: 'prompt_lab', courseId: 'course-1', triggeredByUserId: 'stu-1' },
      );
      expect(res.runs[0]).toMatchObject({
        promptTokens: 120,
        completionTokens: 30,
        responseText: 'answer',
        declaredExperiment: false,
        systemText: PROMPT_LAB_DEFAULT_SYSTEM,
      });
    });

    it('marks multi-sample runs as a declared experiment chained to the first sample', async () => {
      const res = await service.run('stu-1', { ...base, promptText: 'p', samples: 3 });
      expect(m.llm.callLlmStructured).toHaveBeenCalledTimes(3);
      expect(res.runs.map((r) => [r.sampleNo, r.declaredExperiment, r.parentRunId])).toEqual([
        [1, true, null],
        [2, true, 'run-1'],
        [3, true, 'run-1'],
      ]);
    });

    it('appends the test case input to the prompt version', async () => {
      m.prisma.promptLabTestCase.findUnique.mockResolvedValue({
        inputText: 'Q1: what is the warranty?',
      });
      await service.run('stu-1', { ...base, promptText: 'Brief…', testCaseKey: 'c1' });
      expect(m.llm.callLlmStructured.mock.calls[0][1].messages[0].content).toBe(
        'Brief…\n\n---\nQ1: what is the warranty?',
      );
    });

    it('enforces the hourly run limit per student per course', async () => {
      m.prisma.promptLabRun.count.mockResolvedValue(59);
      await expect(service.run('stu-1', { ...base, promptText: 'p', samples: 2 })).rejects.toThrow(
        HttpException,
      );
      expect(m.llm.callLlmStructured).not.toHaveBeenCalled();
    });

    it('enforces the daily token budget', async () => {
      m.prisma.promptLabRun.aggregate.mockResolvedValue({
        _sum: { promptTokens: 150_000, completionTokens: 50_000 },
      });
      await expect(service.run('stu-1', { ...base, promptText: 'p' })).rejects.toThrow(
        /tokens per day/,
      );
    });

    it('only allows lab slides (exercise/task/stretch)', async () => {
      await expect(
        service.run('stu-1', { ...base, slideKey: 's1-3', promptText: 'p' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses students who are not enrolled', async () => {
      m.prisma.enrollment.findUnique.mockResolvedValue(null);
      await expect(service.run('stu-1', { ...base, promptText: 'p' })).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('versions', () => {
    it('numbers versions and stores diff stats (not text) against the previous one', async () => {
      m.prisma.promptLabVersion.findFirst.mockResolvedValue({
        versionNo: 2,
        promptText: 'answer the two questions briefly',
      });
      const v = await service.saveVersion('stu-1', {
        ...base,
        promptText: 'answer both questions briefly using only the brief',
        revisionTags: ['constraint'],
      });
      expect(v).toMatchObject({
        versionNo: 3,
        revisionTags: ['constraint'],
        tokenCountSource: 'approx_chars4',
      });
      expect(v.diffFromPrev).toMatchObject({
        addedWords: expect.any(Number),
        removedWords: expect.any(Number),
      });
    });
  });

  describe('ratings and test results', () => {
    it('only lets a student rate their own runs', async () => {
      m.prisma.promptLabRun.findFirst.mockResolvedValue(null);
      await expect(service.rate('stu-1', { runId: 'r', criteria: { correct: 4 } })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('drops the failure reason when a test passes', async () => {
      m.prisma.promptLabVersion.findFirst.mockResolvedValue({ id: 'v1' });
      const r = await service.recordTestResult('stu-1', {
        versionId: 'v1',
        testCaseKey: 'c1',
        pass: true,
        failureReason: 'format',
      });
      expect(r).toMatchObject({ pass: true, failureReason: null });
    });
  });

  describe('models', () => {
    it('falls back to the template model when the teacher has no LLM configured', async () => {
      const res = await service.models('course-1', 'teacher-1');
      expect(res.defaultModel).toBe('template');
    });
  });
});

describe('text-diff', () => {
  it('computes word-level edit statistics', () => {
    expect(wordDiffStats('a b c d', 'a b c d')).toEqual({
      addedWords: 0,
      removedWords: 0,
      editRatio: 0,
    });
    expect(wordDiffStats('a b c d', 'a x c d e')).toEqual({
      addedWords: 2,
      removedWords: 1,
      editRatio: 0.75,
    });
    expect(wordDiffStats('', 'new')).toEqual({ addedWords: 1, removedWords: 0, editRatio: 1 });
  });

  it('approximates tokens as chars ÷ 4', () => {
    expect(approxTokens('x'.repeat(401))).toBe(101);
  });
});
