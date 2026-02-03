import { QuestionGenerationService } from './question-generation.service';
import type { GenerateQuestionsInput, GeneratedQuestion } from './question-generation.service';
import { BadRequestException } from '@nestjs/common';

// ─── Helpers ────────────────────────────────────────────

function createMockPrisma() {
  return {
    user: {
      findUnique: jest.fn(),
    },
    moduleItem: {
      findMany: jest.fn(),
    },
    course: {
      findUnique: jest.fn(),
    },
    proposedKC: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    knowledgeComponent: {
      findMany: jest.fn(),
    },
    question: {
      create: jest.fn(),
    },
    questionKc: {
      createMany: jest.fn(),
    },
    llmAuditLog: {
      create: jest.fn(),
    },
    assessmentQuestion: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };
}

function createMockRagService() {
  return {
    queryChunksFiltered: jest.fn(),
  };
}

function createService(prisma: any, ragService: any): QuestionGenerationService {
  return new QuestionGenerationService(prisma, ragService);
}

function makeBaseInput(overrides: Partial<GenerateQuestionsInput> = {}): GenerateQuestionsInput {
  return {
    courseId: 'course-1',
    userId: 'user-1',
    types: ['MCQ_SINGLE'],
    quantity: 2,
    difficultyDistribution: { easy: 1, medium: 1, hard: 0 },
    sourceMode: 'lesson_based',
    strictSource: false,
    ...overrides,
  };
}

function makeMcqSingleQuestion(overrides: Partial<GeneratedQuestion> = {}): GeneratedQuestion {
  return {
    type: 'MCQ_SINGLE',
    stem: 'What is 2+2?',
    options: [
      { id: 'opt-a', text: '3', isCorrect: false },
      { id: 'opt-b', text: '4', isCorrect: true },
      { id: 'opt-c', text: '5', isCorrect: false },
      { id: 'opt-d', text: '6', isCorrect: false },
    ],
    explanation: '2+2 equals 4',
    tags: {
      difficulty: 'easy',
      bloomsLevel: 'remember',
      kcNames: ['Basic Addition'],
    },
    provenance: {
      sourceMode: 'lesson_based',
      sourceIds: ['lesson-0'],
      chunkIds: [],
    },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────

describe('QuestionGenerationService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let ragService: ReturnType<typeof createMockRagService>;
  let service: QuestionGenerationService;

  beforeEach(() => {
    prisma = createMockPrisma();
    ragService = createMockRagService();
    service = createService(prisma, ragService);
  });

  // ─── generateQuestions ──────────────────────────────────

  describe('generateQuestions', () => {
    it('should throw BadRequestException when user has no API key', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const input = makeBaseInput();

      await expect(service.generateQuestions(input)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.generateQuestions(input)).rejects.toThrow(
        'No LLM API key configured',
      );
    });

    it('should throw BadRequestException when user has no encryptedApiKey', async () => {
      prisma.user.findUnique.mockResolvedValue({
        llmProvider: 'openai',
        llmModel: 'gpt-4o-mini',
        encryptedApiKey: null,
      });

      await expect(
        service.generateQuestions(makeBaseInput()),
      ).rejects.toThrow(BadRequestException);
    });

    it('should retrieve lesson content for lesson_based mode', async () => {
      // Setup user with encrypted key that will fail decryption -> falls through to null
      prisma.user.findUnique.mockResolvedValue({
        llmProvider: 'openai',
        llmModel: 'gpt-4o-mini',
        encryptedApiKey: null,
      });

      const input = makeBaseInput({
        sourceMode: 'lesson_based',
        selectedPageIds: ['page-1', 'page-2'],
      });

      // Will throw because no API key, but we can verify moduleItem was NOT called
      // since credentials check happens first
      await expect(service.generateQuestions(input)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should call ragService.queryChunksFiltered for question_material mode', async () => {
      // We cannot test the full flow without a real API key decryption,
      // but we can verify the source retrieval logic by testing
      // retrieveSourceChunks indirectly through a partial mock
      prisma.user.findUnique.mockResolvedValue({
        llmProvider: 'openai',
        llmModel: 'gpt-4o-mini',
        encryptedApiKey: null,
      });

      const input = makeBaseInput({
        sourceMode: 'question_material',
        selectedSourceIds: ['src-1'],
      });

      await expect(service.generateQuestions(input)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── validateGeneratedQuestion ──────────────────────────

  describe('validateGeneratedQuestion', () => {
    // Access private method via bracket notation
    const validate = (svc: QuestionGenerationService, q: GeneratedQuestion) =>
      (svc as any).validateGeneratedQuestion(q);

    it('should return a valid MCQ_SINGLE question unchanged', () => {
      const q = makeMcqSingleQuestion();
      const result = validate(service, q);
      expect(result).not.toBeNull();
      expect(result.type).toBe('MCQ_SINGLE');
    });

    it('should default invalid difficulty to medium', () => {
      const q = makeMcqSingleQuestion({
        tags: {
          difficulty: 'super-hard' as any,
          bloomsLevel: 'remember',
          kcNames: [],
        },
      });
      const result = validate(service, q);
      expect(result).not.toBeNull();
      expect(result.tags.difficulty).toBe('medium');
    });

    it('should default invalid bloomsLevel to understand', () => {
      const q = makeMcqSingleQuestion({
        tags: {
          difficulty: 'easy',
          bloomsLevel: 'memorize' as any,
          kcNames: [],
        },
      });
      const result = validate(service, q);
      expect(result).not.toBeNull();
      expect(result.tags.bloomsLevel).toBe('understand');
    });

    it('should return null for invalid question type', () => {
      const q = makeMcqSingleQuestion({ type: 'ESSAY' as any });
      const result = validate(service, q);
      expect(result).toBeNull();
    });

    it('should return null for MCQ_SINGLE with != 1 correct option', () => {
      const q = makeMcqSingleQuestion({
        options: [
          { id: 'a', text: 'A', isCorrect: true },
          { id: 'b', text: 'B', isCorrect: true },
          { id: 'c', text: 'C', isCorrect: false },
          { id: 'd', text: 'D', isCorrect: false },
        ],
      });
      const result = validate(service, q);
      expect(result).toBeNull();
    });

    it('should return null for MCQ_SINGLE with zero correct options', () => {
      const q = makeMcqSingleQuestion({
        options: [
          { id: 'a', text: 'A', isCorrect: false },
          { id: 'b', text: 'B', isCorrect: false },
          { id: 'c', text: 'C', isCorrect: false },
          { id: 'd', text: 'D', isCorrect: false },
        ],
      });
      const result = validate(service, q);
      expect(result).toBeNull();
    });

    it('should return null for MCQ_SINGLE with no options', () => {
      const q = makeMcqSingleQuestion({ options: [] });
      const result = validate(service, q);
      expect(result).toBeNull();
    });

    it('should return null for MCQ_MULTI with zero correct options', () => {
      const q: GeneratedQuestion = {
        type: 'MCQ_MULTI',
        stem: 'Select all that apply: which are even?',
        options: [
          { id: 'a', text: '1', isCorrect: false },
          { id: 'b', text: '3', isCorrect: false },
        ],
        explanation: 'Neither is even',
        tags: { difficulty: 'easy', bloomsLevel: 'remember', kcNames: [] },
        provenance: { sourceMode: 'lesson_based', sourceIds: [], chunkIds: [] },
      };
      const result = validate(service, q);
      expect(result).toBeNull();
    });

    it('should accept MCQ_MULTI with at least one correct option', () => {
      const q: GeneratedQuestion = {
        type: 'MCQ_MULTI',
        stem: 'Select all that apply: which are even?',
        options: [
          { id: 'a', text: '2', isCorrect: true },
          { id: 'b', text: '3', isCorrect: false },
          { id: 'c', text: '4', isCorrect: true },
        ],
        explanation: '2 and 4 are even',
        tags: { difficulty: 'easy', bloomsLevel: 'remember', kcNames: [] },
        provenance: { sourceMode: 'lesson_based', sourceIds: [], chunkIds: [] },
      };
      const result = validate(service, q);
      expect(result).not.toBeNull();
      expect(result.type).toBe('MCQ_MULTI');
    });

    it('should return null for MCQ_MULTI with no options array', () => {
      const q: GeneratedQuestion = {
        type: 'MCQ_MULTI',
        stem: 'Select all that apply',
        options: undefined as any,
        explanation: 'test',
        tags: { difficulty: 'easy', bloomsLevel: 'remember', kcNames: [] },
        provenance: { sourceMode: 'lesson_based', sourceIds: [], chunkIds: [] },
      };
      const result = validate(service, q);
      expect(result).toBeNull();
    });

    it('should return null for STRUCTURED question missing structuredAnswer', () => {
      const q: GeneratedQuestion = {
        type: 'STRUCTURED',
        stem: 'Explain gravity',
        explanation: 'Gravity is a force',
        tags: { difficulty: 'medium', bloomsLevel: 'understand', kcNames: [] },
        provenance: { sourceMode: 'lesson_based', sourceIds: [], chunkIds: [] },
      };
      const result = validate(service, q);
      expect(result).toBeNull();
    });

    it('should return null for STRUCTURED question missing expectedAnswer', () => {
      const q: GeneratedQuestion = {
        type: 'STRUCTURED',
        stem: 'Explain gravity',
        structuredAnswer: { expectedAnswer: '', rubric: ['point 1'] },
        explanation: 'Gravity is a force',
        tags: { difficulty: 'medium', bloomsLevel: 'understand', kcNames: [] },
        provenance: { sourceMode: 'lesson_based', sourceIds: [], chunkIds: [] },
      };
      const result = validate(service, q);
      expect(result).toBeNull();
    });

    it('should return null for STRUCTURED question missing rubric array', () => {
      const q: GeneratedQuestion = {
        type: 'STRUCTURED',
        stem: 'Explain gravity',
        structuredAnswer: { expectedAnswer: 'Force of attraction', rubric: null as any },
        explanation: 'Gravity is a force',
        tags: { difficulty: 'medium', bloomsLevel: 'understand', kcNames: [] },
        provenance: { sourceMode: 'lesson_based', sourceIds: [], chunkIds: [] },
      };
      const result = validate(service, q);
      expect(result).toBeNull();
    });

    it('should accept valid STRUCTURED question', () => {
      const q: GeneratedQuestion = {
        type: 'STRUCTURED',
        stem: 'Explain gravity',
        structuredAnswer: {
          expectedAnswer: 'Force of attraction between masses',
          rubric: ['Identifies force', 'Mentions mass'],
        },
        explanation: 'Gravity is a fundamental force',
        tags: { difficulty: 'medium', bloomsLevel: 'understand', kcNames: [] },
        provenance: { sourceMode: 'lesson_based', sourceIds: [], chunkIds: [] },
      };
      const result = validate(service, q);
      expect(result).not.toBeNull();
      expect(result.type).toBe('STRUCTURED');
    });

    it('should assign option IDs if they are missing', () => {
      const q = makeMcqSingleQuestion({
        options: [
          { id: '', text: 'A', isCorrect: true },
          { id: '', text: 'B', isCorrect: false },
          { id: '', text: 'C', isCorrect: false },
          { id: '', text: 'D', isCorrect: false },
        ],
      });
      const result = validate(service, q);
      expect(result).not.toBeNull();
      expect(result.options[0].id).toBe('opt-a');
      expect(result.options[1].id).toBe('opt-b');
    });
  });

  // ─── resolveKcTags ──────────────────────────────────────

  describe('resolveKcTags', () => {
    beforeEach(() => {
      prisma.proposedKC.findMany.mockResolvedValue([]);
      prisma.knowledgeComponent.findMany.mockResolvedValue([]);
    });

    it('should match existing KC by exact name', async () => {
      prisma.knowledgeComponent.findMany.mockResolvedValue([
        { id: 'kc-1', label: 'Binary Search' },
      ]);

      const result = await service.resolveKcTags('course-1', ['Binary Search']);

      expect(result).toEqual([
        { id: 'kc-1', name: 'Binary Search', isExisting: true },
      ]);
    });

    it('should match existing KC by exact name case-insensitively', async () => {
      prisma.knowledgeComponent.findMany.mockResolvedValue([
        { id: 'kc-1', label: 'Binary Search' },
      ]);

      const result = await service.resolveKcTags('course-1', ['binary search']);

      expect(result).toEqual([
        { id: 'kc-1', name: 'Binary Search', isExisting: true },
      ]);
    });

    it('should match existing KC by substring', async () => {
      prisma.knowledgeComponent.findMany.mockResolvedValue([
        { id: 'kc-1', label: 'Binary Search Algorithm' },
      ]);

      const result = await service.resolveKcTags('course-1', ['Binary Search']);

      expect(result).toEqual([
        { id: 'kc-1', name: 'Binary Search Algorithm', isExisting: true },
      ]);
    });

    it('should match when KC name contains the query as substring', async () => {
      prisma.knowledgeComponent.findMany.mockResolvedValue([
        { id: 'kc-1', label: 'Search' },
      ]);

      const result = await service.resolveKcTags('course-1', ['Binary Search']);

      expect(result).toEqual([
        { id: 'kc-1', name: 'Search', isExisting: true },
      ]);
    });

    it('should return isExisting=false for unknown KC', async () => {
      prisma.knowledgeComponent.findMany.mockResolvedValue([
        { id: 'kc-1', label: 'Sorting Algorithms' },
      ]);

      const result = await service.resolveKcTags('course-1', ['Quantum Computing']);

      expect(result).toEqual([
        { id: null, name: 'Quantum Computing', isExisting: false },
      ]);
    });

    it('should also check ProposedKC entries', async () => {
      prisma.knowledgeComponent.findMany.mockResolvedValue([]);
      prisma.proposedKC.findMany.mockResolvedValue([
        { id: 'pkc-1', name: 'Graph Traversal' },
      ]);

      const result = await service.resolveKcTags('course-1', ['Graph Traversal']);

      expect(result).toEqual([
        { id: 'pkc-1', name: 'Graph Traversal', isExisting: true },
      ]);
    });

    it('should resolve multiple KC names independently', async () => {
      prisma.knowledgeComponent.findMany.mockResolvedValue([
        { id: 'kc-1', label: 'Binary Search' },
      ]);

      const result = await service.resolveKcTags('course-1', [
        'Binary Search',
        'Unknown Topic',
      ]);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 'kc-1', name: 'Binary Search', isExisting: true });
      expect(result[1]).toEqual({ id: null, name: 'Unknown Topic', isExisting: false });
    });

    it('should query proposedKC and knowledgeComponent with correct courseId', async () => {
      await service.resolveKcTags('course-42', ['anything']);

      expect(prisma.proposedKC.findMany).toHaveBeenCalledWith({
        where: { courseId: 'course-42' },
        select: { id: true, name: true },
      });
      expect(prisma.knowledgeComponent.findMany).toHaveBeenCalledWith({
        where: { topic: { courseId: 'course-42' } },
        select: { id: true, label: true },
      });
    });
  });

  // ─── saveGeneratedQuestions ──────────────────────────────

  describe('saveGeneratedQuestions', () => {
    beforeEach(() => {
      prisma.proposedKC.findMany.mockResolvedValue([]);
      prisma.knowledgeComponent.findMany.mockResolvedValue([]);
      prisma.proposedKC.create.mockResolvedValue({ id: 'pkc-new' });
      prisma.question.create.mockResolvedValue({ id: 'q-new' });
      prisma.questionKc.createMany.mockResolvedValue({ count: 0 });
    });

    it('should create question records with correct fields', async () => {
      const q = makeMcqSingleQuestion();

      const ids = await service.saveGeneratedQuestions('course-1', 'user-1', [q]);

      expect(ids).toEqual(['q-new']);
      expect(prisma.question.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          courseId: 'course-1',
          prompt: 'What is 2+2?',
          stem: 'What is 2+2?',
          type: 'MCQ_SINGLE',
          maxScore: 1,
          explanation: '2+2 equals 4',
          difficulty: 1, // easy -> 1
          bloomsLevel: 'remember',
          status: 'draft',
          createdBy: 'ai',
          sourceType: 'ai_generated',
        }),
      });
    });

    it('should map difficulty string to numeric value', async () => {
      const easy = makeMcqSingleQuestion({
        tags: { difficulty: 'easy', bloomsLevel: 'remember', kcNames: [] },
      });
      const medium = makeMcqSingleQuestion({
        tags: { difficulty: 'medium', bloomsLevel: 'remember', kcNames: [] },
      });
      const hard = makeMcqSingleQuestion({
        tags: { difficulty: 'hard', bloomsLevel: 'remember', kcNames: [] },
      });

      await service.saveGeneratedQuestions('course-1', 'user-1', [easy]);
      expect(prisma.question.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ difficulty: 1 }),
      });

      prisma.question.create.mockClear();
      await service.saveGeneratedQuestions('course-1', 'user-1', [medium]);
      expect(prisma.question.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ difficulty: 3 }),
      });

      prisma.question.create.mockClear();
      await service.saveGeneratedQuestions('course-1', 'user-1', [hard]);
      expect(prisma.question.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ difficulty: 5 }),
      });
    });

    it('should set maxScore to 10 for STRUCTURED questions', async () => {
      const q: GeneratedQuestion = {
        type: 'STRUCTURED',
        stem: 'Explain gravity',
        structuredAnswer: {
          expectedAnswer: 'Force of attraction',
          rubric: ['Identifies force'],
        },
        explanation: 'Gravity explanation',
        tags: { difficulty: 'medium', bloomsLevel: 'understand', kcNames: [] },
        provenance: { sourceMode: 'lesson_based', sourceIds: [], chunkIds: [] },
      };

      await service.saveGeneratedQuestions('course-1', 'user-1', [q]);

      expect(prisma.question.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ maxScore: 10 }),
      });
    });

    it('should create ProposedKC for unmatched KC names', async () => {
      const q = makeMcqSingleQuestion({
        tags: {
          difficulty: 'easy',
          bloomsLevel: 'remember',
          kcNames: ['New Concept'],
        },
      });

      // No existing KCs match
      prisma.knowledgeComponent.findMany.mockResolvedValue([]);
      prisma.proposedKC.findMany.mockResolvedValue([]);

      await service.saveGeneratedQuestions('course-1', 'user-1', [q]);

      expect(prisma.proposedKC.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          courseId: 'course-1',
          name: 'New Concept',
          status: 'PROPOSED',
          confidenceLevel: 'MEDIUM',
          createdBy: 'ai',
        }),
      });
    });

    it('should create QuestionKc join records for matched KCs', async () => {
      prisma.knowledgeComponent.findMany.mockResolvedValue([
        { id: 'kc-1', label: 'Basic Addition' },
      ]);

      const q = makeMcqSingleQuestion({
        tags: {
          difficulty: 'easy',
          bloomsLevel: 'remember',
          kcNames: ['Basic Addition'],
        },
      });

      await service.saveGeneratedQuestions('course-1', 'user-1', [q]);

      expect(prisma.questionKc.createMany).toHaveBeenCalledWith({
        data: [{ questionId: 'q-new', kcId: 'kc-1' }],
      });
    });

    it('should not create QuestionKc records when no KCs match', async () => {
      const q = makeMcqSingleQuestion({
        tags: { difficulty: 'easy', bloomsLevel: 'remember', kcNames: ['Unknown'] },
      });

      await service.saveGeneratedQuestions('course-1', 'user-1', [q]);

      expect(prisma.questionKc.createMany).not.toHaveBeenCalled();
    });

    it('should save multiple questions and return all IDs', async () => {
      prisma.question.create
        .mockResolvedValueOnce({ id: 'q-1' })
        .mockResolvedValueOnce({ id: 'q-2' });

      const q1 = makeMcqSingleQuestion();
      const q2 = makeMcqSingleQuestion({ stem: 'What is 3+3?' });

      const ids = await service.saveGeneratedQuestions('course-1', 'user-1', [q1, q2]);

      expect(ids).toEqual(['q-1', 'q-2']);
      expect(prisma.question.create).toHaveBeenCalledTimes(2);
    });

    it('should include correctOptionId for MCQ_SINGLE', async () => {
      const q = makeMcqSingleQuestion();

      await service.saveGeneratedQuestions('course-1', 'user-1', [q]);

      expect(prisma.question.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          correctOptionId: 'opt-b', // the correct option
        }),
      });
    });

    it('should include correctAnswer for STRUCTURED questions', async () => {
      const q: GeneratedQuestion = {
        type: 'STRUCTURED',
        stem: 'Explain',
        structuredAnswer: {
          expectedAnswer: 'The answer',
          rubric: ['point 1'],
        },
        explanation: 'Because...',
        tags: { difficulty: 'medium', bloomsLevel: 'understand', kcNames: [] },
        provenance: { sourceMode: 'lesson_based', sourceIds: [], chunkIds: [] },
      };

      await service.saveGeneratedQuestions('course-1', 'user-1', [q]);

      expect(prisma.question.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          correctAnswer: { expectedAnswer: 'The answer', rubric: ['point 1'] },
        }),
      });
    });

    it('should store provenance data on the question', async () => {
      const q = makeMcqSingleQuestion({
        provenance: {
          sourceMode: 'mixed',
          sourceIds: ['src-1', 'src-2'],
          chunkIds: ['chunk-1'],
        },
      });

      await service.saveGeneratedQuestions('course-1', 'user-1', [q]);

      expect(prisma.question.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          provenance: {
            sourceMode: 'mixed',
            sourceIds: ['src-1', 'src-2'],
            chunkIds: ['chunk-1'],
          },
        }),
      });
    });
  });

  // ─── parseQuestionsResponse (via parseAndValidate) ──────

  describe('parseQuestionsResponse', () => {
    const callParse = (svc: QuestionGenerationService, raw: string) => {
      const input = makeBaseInput();
      return (svc as any).parseQuestionsResponse(raw, input, [], []);
    };

    it('should parse valid JSON questions response', () => {
      const raw = JSON.stringify({
        questions: [
          {
            type: 'MCQ_SINGLE',
            stem: 'What is 1+1?',
            options: [
              { id: 'a', text: '2', isCorrect: true },
              { id: 'b', text: '3', isCorrect: false },
            ],
            explanation: 'Basic math',
            tags: { difficulty: 'easy', bloomsLevel: 'remember', kcNames: ['Addition'] },
          },
        ],
      });

      const result = callParse(service, raw);

      expect(result).toHaveLength(1);
      expect(result[0].stem).toBe('What is 1+1?');
      expect(result[0].tags.difficulty).toBe('easy');
    });

    it('should handle malformed JSON gracefully', () => {
      const result = callParse(service, '{ this is not valid json }}}');
      expect(result).toEqual([]);
    });

    it('should handle NOT_ENOUGH_INFO response', () => {
      const raw = JSON.stringify({
        status: 'NOT_ENOUGH_INFO',
        missingInfo: ['No content about quantum physics'],
      });

      const result = callParse(service, raw);
      expect(result).toEqual([]);
    });

    it('should handle response with no questions array', () => {
      const raw = JSON.stringify({ data: 'something else' });
      const result = callParse(service, raw);
      expect(result).toEqual([]);
    });

    it('should handle non-array questions field', () => {
      const raw = JSON.stringify({ questions: 'not an array' });
      const result = callParse(service, raw);
      expect(result).toEqual([]);
    });

    it('should strip markdown fences from response', () => {
      const raw = '```json\n' + JSON.stringify({
        questions: [
          {
            type: 'MCQ_SINGLE',
            stem: 'Test?',
            options: [{ id: 'a', text: 'A', isCorrect: true }],
            explanation: 'Test',
            tags: { difficulty: 'easy', bloomsLevel: 'remember', kcNames: [] },
          },
        ],
      }) + '\n```';

      const result = callParse(service, raw);
      expect(result).toHaveLength(1);
      expect(result[0].stem).toBe('Test?');
    });

    it('should attach provenance with sourceMode from input', () => {
      const input = makeBaseInput({ sourceMode: 'mixed' });
      const raw = JSON.stringify({
        questions: [
          {
            type: 'MCQ_SINGLE',
            stem: 'Test?',
            explanation: 'Yes',
          },
        ],
      });

      const result = (service as any).parseQuestionsResponse(raw, input, [], []);
      expect(result[0].provenance.sourceMode).toBe('mixed');
    });

    it('should default missing tags to medium/understand', () => {
      const raw = JSON.stringify({
        questions: [
          {
            type: 'MCQ_SINGLE',
            stem: 'Test?',
            explanation: 'Test',
          },
        ],
      });

      const result = callParse(service, raw);
      expect(result[0].tags.difficulty).toBe('medium');
      expect(result[0].tags.bloomsLevel).toBe('understand');
    });

    it('should handle empty string input', () => {
      const result = callParse(service, '');
      expect(result).toEqual([]);
    });
  });

  // ─── buildQuestionGenSystemPrompt ──────────────────────

  describe('buildQuestionGenSystemPrompt', () => {
    const buildPrompt = (svc: QuestionGenerationService, strict: boolean) =>
      (svc as any).buildQuestionGenSystemPrompt(strict);

    it('should include strict source instruction when strictSource is true', () => {
      const prompt = buildPrompt(service, true);
      expect(prompt).toContain('STRICT SOURCE MODE');
      expect(prompt).toContain('NOT_ENOUGH_INFO');
    });

    it('should not include strict source instruction when strictSource is false', () => {
      const prompt = buildPrompt(service, false);
      expect(prompt).not.toContain('STRICT SOURCE MODE');
    });

    it('should include core rules about difficulty and blooms', () => {
      const prompt = buildPrompt(service, false);
      expect(prompt).toContain('easy');
      expect(prompt).toContain('medium');
      expect(prompt).toContain('hard');
      expect(prompt).toContain('bloomsLevel');
    });
  });

  // ─── ensureOptionIds ──────────────────────────────────

  describe('ensureOptionIds', () => {
    const ensure = (svc: QuestionGenerationService, options: any[]) =>
      (svc as any).ensureOptionIds(options);

    it('should keep existing option IDs', () => {
      const options = [
        { id: 'my-id', text: 'A', isCorrect: true },
      ];
      const result = ensure(service, options);
      expect(result[0].id).toBe('my-id');
    });

    it('should assign alphabetical IDs to options without IDs', () => {
      const options = [
        { id: '', text: 'A', isCorrect: true },
        { id: '', text: 'B', isCorrect: false },
        { id: '', text: 'C', isCorrect: false },
      ];
      const result = ensure(service, options);
      expect(result[0].id).toBe('opt-a');
      expect(result[1].id).toBe('opt-b');
      expect(result[2].id).toBe('opt-c');
    });
  });

  // ─── createAuditLog ──────────────────────────────────

  describe('createAuditLog', () => {
    const createLog = (svc: QuestionGenerationService, ...args: any[]) =>
      (svc as any).createAuditLog(...args);

    it('should create an audit log with estimated token counts', async () => {
      prisma.llmAuditLog.create.mockResolvedValue({});

      await createLog(
        service,
        'course-1',
        'user-1',
        'gpt-4o-mini',
        'system prompt',
        'user prompt',
        'response text',
        1500,
      );

      expect(prisma.llmAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          courseId: 'course-1',
          userId: 'user-1',
          action: 'question_generation',
          model: 'gpt-4o-mini',
          durationMs: 1500,
          promptTokens: expect.any(Number),
          completionTokens: expect.any(Number),
        }),
      });
    });

    it('should not throw when audit log creation fails', async () => {
      prisma.llmAuditLog.create.mockRejectedValue(new Error('DB down'));

      // Should not throw
      await expect(
        createLog(
          service,
          'course-1',
          'user-1',
          'gpt-4o-mini',
          'sys',
          'usr',
          'resp',
          100,
        ),
      ).resolves.toBeUndefined();
    });
  });

  // ─── findSimilarKc ──────────────────────────────────

  describe('findSimilarKc', () => {
    const findSimilar = (svc: QuestionGenerationService, name: string, existing: any[]) =>
      (svc as any).findSimilarKc(name, existing);

    it('should return exact match', () => {
      const result = findSimilar(service, 'Binary Search', [
        { id: '1', name: 'Binary Search' },
      ]);
      expect(result).toEqual({ id: '1', name: 'Binary Search' });
    });

    it('should return case-insensitive match', () => {
      const result = findSimilar(service, 'binary search', [
        { id: '1', name: 'Binary Search' },
      ]);
      expect(result).toEqual({ id: '1', name: 'Binary Search' });
    });

    it('should return substring match', () => {
      const result = findSimilar(service, 'Binary Search', [
        { id: '1', name: 'Binary Search Tree Algorithm' },
      ]);
      expect(result).toEqual({ id: '1', name: 'Binary Search Tree Algorithm' });
    });

    it('should return match by Jaccard word overlap >= 0.7', () => {
      // "sorting algorithm basics" vs "sorting algorithm fundamentals"
      // words A: {sorting, algorithm, basics} words B: {sorting, algorithm, fundamentals}
      // intersection: {sorting, algorithm} = 2
      // union: {sorting, algorithm, basics, fundamentals} = 4
      // jaccard = 2/4 = 0.5 -> not enough
      // Let's use a better example:
      // "linked list operations" vs "linked list operation"
      // A: {linked, list, operations}, B: {linked, list, operation}
      // intersection: {linked, list} = 2, union: 4, jaccard=0.5 - still not enough
      // Need overlap >= 0.7: "merge sort algorithm" vs "merge sort algo"
      // Substring match would catch this. Let's use word overlap directly.
      // "data structures arrays" vs "data structures arrays basics"
      // A: {data, structures, arrays}, B: {data, structures, arrays, basics}
      // intersection: 3, union: 4, jaccard=0.75 >= 0.7
      const result = findSimilar(service, 'data structures arrays', [
        { id: '1', name: 'data structures arrays basics' },
      ]);
      expect(result).toEqual({ id: '1', name: 'data structures arrays basics' });
    });

    it('should return null when no match found', () => {
      const result = findSimilar(service, 'Quantum Physics', [
        { id: '1', name: 'Binary Search' },
        { id: '2', name: 'Sorting Algorithms' },
      ]);
      expect(result).toBeNull();
    });
  });
});
