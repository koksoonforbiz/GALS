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
