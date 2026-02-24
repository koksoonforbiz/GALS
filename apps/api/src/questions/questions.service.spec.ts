import { QuestionsService } from './questions.service';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';

// ─── Helpers ────────────────────────────────────────────

function createMockPrisma() {
  return {
    question: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      updateMany: jest.fn(),
    },
    course: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    topic: {
      findUnique: jest.fn(),
    },
    questionKc: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
}

function createService(prisma: any): QuestionsService {
  return new QuestionsService(prisma);
}

// ─── Tests ──────────────────────────────────────────────

describe('QuestionsService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: QuestionsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = createService(prisma);
  });

  // ─── create ──────────────────────────────────────────

  describe('create', () => {
    const teacherId = 'teacher-1';

    const baseDto = {
      courseId: 'course-1',
      prompt: 'What is 2+2?',
      type: 'STRUCTURED' as const,
      maxScore: 10,
    };

    beforeEach(() => {
      prisma.course.findUnique.mockResolvedValue({ teacherId });
      prisma.question.create.mockResolvedValue({ id: 'q1', ...baseDto });
      prisma.questionKc.createMany.mockResolvedValue({ count: 0 });
    });

    it('should create a question with courseId', async () => {
      const result = await service.create(teacherId, baseDto);

      expect(prisma.course.findUnique).toHaveBeenCalledWith({
        where: { id: 'course-1' },
        select: { teacherId: true },
      });
      expect(prisma.question.create).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ id: 'q1' }));
    });

    it('should create a question with topicId', async () => {
      prisma.topic.findUnique.mockResolvedValue({
        id: 'topic-1',
        course: { teacherId },
      });

      const dto = { ...baseDto, courseId: undefined, topicId: 'topic-1' };
      await service.create(teacherId, dto);

      expect(prisma.topic.findUnique).toHaveBeenCalledWith({
        where: { id: 'topic-1' },
        include: { course: { select: { teacherId: true } } },
      });
      expect(prisma.question.create).toHaveBeenCalled();
    });

    it('should link KCs via join table when kcIds provided', async () => {
      prisma.question.create.mockResolvedValue({ id: 'q1' });

      await service.create(teacherId, {
        ...baseDto,
        kcIds: ['kc-1', 'kc-2'],
      });

      expect(prisma.questionKc.createMany).toHaveBeenCalledWith({
        data: [
          { questionId: 'q1', kcId: 'kc-1' },
          { questionId: 'q1', kcId: 'kc-2' },
        ],
      });
    });

    it('should throw BadRequestException if no courseId or topicId', async () => {
      const dto = { ...baseDto, courseId: undefined };

      await expect(service.create(teacherId, dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException if teacher does not own course', async () => {
      prisma.course.findUnique.mockResolvedValue({ teacherId: 'other-teacher' });

      await expect(service.create(teacherId, baseDto)).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if course does not exist', async () => {
      prisma.course.findUnique.mockResolvedValue(null);

      await expect(service.create(teacherId, baseDto)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if teacher does not own topic course', async () => {
      prisma.topic.findUnique.mockResolvedValue({
        id: 'topic-1',
        course: { teacherId: 'other-teacher' },
      });

      const dto = { ...baseDto, courseId: undefined, topicId: 'topic-1' };
      await expect(service.create(teacherId, dto)).rejects.toThrow(ForbiddenException);
    });

    // MCQ validations

    it('should validate MCQ_SINGLE requires exactly 1 correct option', async () => {
      const dto = {
        ...baseDto,
        type: 'MCQ_SINGLE' as const,
        options: [
          { id: 'a', text: 'A', isCorrect: true },
          { id: 'b', text: 'B', isCorrect: true },
        ],
      };

      await expect(service.create(teacherId, dto)).rejects.toThrow(BadRequestException);
    });

    it('should allow MCQ_SINGLE with exactly 1 correct option', async () => {
      const dto = {
        ...baseDto,
        type: 'MCQ_SINGLE' as const,
        options: [
          { id: 'a', text: 'A', isCorrect: true },
          { id: 'b', text: 'B', isCorrect: false },
        ],
      };

      await service.create(teacherId, dto);
      expect(prisma.question.create).toHaveBeenCalled();
    });

    it('should allow MCQ_SINGLE with correctOptionId instead of isCorrect', async () => {
      const dto = {
        ...baseDto,
        type: 'MCQ_SINGLE' as const,
        options: [
          { id: 'a', text: 'A', isCorrect: false },
          { id: 'b', text: 'B', isCorrect: false },
        ],
        correctOptionId: 'a',
      };

      await service.create(teacherId, dto);
      expect(prisma.question.create).toHaveBeenCalled();
    });

    it('should throw BadRequestException for MCQ_SINGLE with no options', async () => {
      const dto = {
        ...baseDto,
        type: 'MCQ_SINGLE' as const,
        options: [],
      };

      await expect(service.create(teacherId, dto)).rejects.toThrow(BadRequestException);
    });

    it('should validate MCQ_MULTI requires at least 1 correct option', async () => {
      const dto = {
        ...baseDto,
        type: 'MCQ_MULTI' as const,
        options: [
          { id: 'a', text: 'A', isCorrect: false },
          { id: 'b', text: 'B', isCorrect: false },
        ],
      };

      await expect(service.create(teacherId, dto)).rejects.toThrow(BadRequestException);
    });

    it('should allow MCQ_MULTI with at least 1 correct option', async () => {
      const dto = {
        ...baseDto,
        type: 'MCQ_MULTI' as const,
        options: [
          { id: 'a', text: 'A', isCorrect: true },
          { id: 'b', text: 'B', isCorrect: false },
          { id: 'c', text: 'C', isCorrect: true },
        ],
      };

      await service.create(teacherId, dto);
      expect(prisma.question.create).toHaveBeenCalled();
    });

    it('should throw BadRequestException for MCQ_MULTI with no options', async () => {
      const dto = {
        ...baseDto,
        type: 'MCQ_MULTI' as const,
        options: [],
      };

      await expect(service.create(teacherId, dto)).rejects.toThrow(BadRequestException);
    });
  });

  // ─── findByCourse ──────────────────────────────────────

  describe('findByCourse', () => {
    it('should return questions for a course', async () => {
      prisma.question.findMany.mockResolvedValue([{ id: 'q1' }, { id: 'q2' }]);

      const result = await service.findByCourse('course-1');

      expect(prisma.question.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { courseId: 'course-1' },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result).toHaveLength(2);
    });

    it('should apply type filter', async () => {
      prisma.question.findMany.mockResolvedValue([]);

      await service.findByCourse('course-1', { type: 'MCQ_SINGLE' });

      expect(prisma.question.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            courseId: 'course-1',
            type: 'MCQ_SINGLE',
          }),
        }),
      );
    });

    it('should apply status filter', async () => {
      prisma.question.findMany.mockResolvedValue([]);

      await service.findByCourse('course-1', { status: 'active' });

      expect(prisma.question.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'active' }),
        }),
      );
    });

    it('should apply difficulty filter', async () => {
      prisma.question.findMany.mockResolvedValue([]);

      await service.findByCourse('course-1', { difficulty: 3 });

      expect(prisma.question.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ difficulty: 3 }),
        }),
      );
    });

    it('should apply bloomsLevel filter', async () => {
      prisma.question.findMany.mockResolvedValue([]);

      await service.findByCourse('course-1', { bloomsLevel: 'APPLY' });

      expect(prisma.question.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ bloomsLevel: 'APPLY' }),
        }),
      );
    });

    it('should apply search filter with case-insensitive contains', async () => {
      prisma.question.findMany.mockResolvedValue([]);

      await service.findByCourse('course-1', { search: 'algebra' });

      expect(prisma.question.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            prompt: { contains: 'algebra', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('should apply multiple filters simultaneously', async () => {
      prisma.question.findMany.mockResolvedValue([]);

      await service.findByCourse('course-1', {
        type: 'MCQ_SINGLE',
        status: 'active',
        search: 'test',
      });

      expect(prisma.question.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            courseId: 'course-1',
            type: 'MCQ_SINGLE',
            status: 'active',
            prompt: { contains: 'test', mode: 'insensitive' },
          }),
        }),
      );
    });
  });

  // ─── findAll ──────────────────────────────────────────

  describe('findAll', () => {
    const teacherId = 'teacher-1';

    beforeEach(() => {
      prisma.course.findMany.mockResolvedValue([{ id: 'course-1' }, { id: 'course-2' }]);
      prisma.question.findMany.mockResolvedValue([{ id: 'q1' }]);
    });

    it('should find courses by teacherId then query questions', async () => {
      await service.findAll(teacherId);

      expect(prisma.course.findMany).toHaveBeenCalledWith({
        where: { teacherId },
        select: { id: true },
      });
      expect(prisma.question.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { courseId: { in: ['course-1', 'course-2'] } },
              { topic: { course: { teacherId } } },
            ],
          }),
        }),
      );
    });

    it('should scope to specific courseId when provided', async () => {
      await service.findAll(teacherId, { courseId: 'course-1' });

      expect(prisma.question.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ courseId: 'course-1' }),
        }),
      );
    });

    it('should throw ForbiddenException if filtering by unowned courseId', async () => {
      await expect(service.findAll(teacherId, { courseId: 'not-owned' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should apply filters', async () => {
      await service.findAll(teacherId, { type: 'MCQ_SINGLE', status: 'draft' });

      expect(prisma.question.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 'MCQ_SINGLE',
            status: 'draft',
          }),
        }),
      );
    });
  });

  // ─── findOne ──────────────────────────────────────────

  describe('findOne', () => {
    it('should return question with full includes', async () => {
      const question = { id: 'q1', prompt: 'Test', course: null, topic: null, questionKcs: [] };
      prisma.question.findUnique.mockResolvedValue(question);

      const result = await service.findOne('q1');

      expect(result).toEqual(question);
      expect(prisma.question.findUnique).toHaveBeenCalledWith({
        where: { id: 'q1' },
        include: expect.objectContaining({
          course: expect.any(Object),
          topic: expect.any(Object),
          questionKcs: expect.any(Object),
        }),
      });
    });

    it('should throw NotFoundException when question not found', async () => {
      prisma.question.findUnique.mockResolvedValue(null);

      await expect(service.findOne('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── update ──────────────────────────────────────────

  describe('update', () => {
    const teacherId = 'teacher-1';

    const existingQuestion = {
      id: 'q1',
      prompt: 'Old prompt',
      type: 'STRUCTURED',
      courseId: 'course-1',
      topicId: null,
      version: 1,
      course: { teacherId },
      topic: null,
    };

    beforeEach(() => {
      prisma.question.findUnique.mockResolvedValue(existingQuestion);
      prisma.question.update.mockResolvedValue({
        ...existingQuestion,
        version: 2,
      });
      prisma.questionKc.deleteMany.mockResolvedValue({ count: 0 });
      prisma.questionKc.createMany.mockResolvedValue({ count: 0 });
    });

    it('should update a question and increment version', async () => {
      await service.update('q1', teacherId, { prompt: 'New prompt' });

      expect(prisma.question.update).toHaveBeenCalledWith({
        where: { id: 'q1' },
        data: expect.objectContaining({
          version: { increment: 1 },
          prompt: 'New prompt',
        }),
      });
    });

    it('should throw NotFoundException for non-existent question', async () => {
      prisma.question.findUnique.mockResolvedValue(null);

      await expect(service.update('bad-id', teacherId, { prompt: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if teacher does not own question', async () => {
      prisma.question.findUnique.mockResolvedValue({
        ...existingQuestion,
        course: { teacherId: 'other-teacher' },
      });

      await expect(service.update('q1', teacherId, { prompt: 'X' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should update KC join table when kcIds are provided', async () => {
      await service.update('q1', teacherId, { kcIds: ['kc-a', 'kc-b'] });

      expect(prisma.questionKc.deleteMany).toHaveBeenCalledWith({
        where: { questionId: 'q1' },
      });
      expect(prisma.questionKc.createMany).toHaveBeenCalledWith({
        data: [
          { questionId: 'q1', kcId: 'kc-a' },
          { questionId: 'q1', kcId: 'kc-b' },
        ],
      });
    });

    it('should verify new course ownership when moving question', async () => {
      prisma.course.findUnique.mockResolvedValue({ teacherId });

      await service.update('q1', teacherId, { courseId: 'course-2' });

      expect(prisma.course.findUnique).toHaveBeenCalledWith({
        where: { id: 'course-2' },
        select: { teacherId: true },
      });
    });

    it('should validate MCQ options when type changes', async () => {
      await expect(
        service.update('q1', teacherId, {
          type: 'MCQ_SINGLE',
          options: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── remove ──────────────────────────────────────────

  describe('remove', () => {
    const teacherId = 'teacher-1';

    it('should delete a question owned by teacher', async () => {
      prisma.question.findUnique.mockResolvedValue({
        id: 'q1',
        course: { teacherId },
        topic: null,
      });
      prisma.question.delete.mockResolvedValue({});

      const result = await service.remove('q1', teacherId);

      expect(result).toEqual({ deleted: true });
      expect(prisma.question.delete).toHaveBeenCalledWith({
        where: { id: 'q1' },
      });
    });

    it('should throw NotFoundException for non-existent question', async () => {
      prisma.question.findUnique.mockResolvedValue(null);

      await expect(service.remove('bad-id', teacherId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if teacher does not own question', async () => {
      prisma.question.findUnique.mockResolvedValue({
        id: 'q1',
        course: { teacherId: 'other-teacher' },
        topic: null,
      });

      await expect(service.remove('q1', teacherId)).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── bulkImport ──────────────────────────────────────

  describe('bulkImport', () => {
    const teacherId = 'teacher-1';
    const courseId = 'course-1';

    beforeEach(() => {
      prisma.course.findUnique.mockResolvedValue({ teacherId });
      prisma.question.create
        .mockResolvedValueOnce({ id: 'q1' })
        .mockResolvedValueOnce({ id: 'q2' });
      prisma.questionKc.createMany.mockResolvedValue({ count: 0 });
    });

    it('should verify course ownership then create each question', async () => {
      const questions = [
        { prompt: 'Q1', type: 'STRUCTURED' as const, maxScore: 5 },
        { prompt: 'Q2', type: 'STRUCTURED' as const, maxScore: 10 },
      ];

      const result = await service.bulkImport(teacherId, courseId, questions as any);

      expect(result).toHaveLength(2);
      // Ownership checked: once for bulkImport itself, plus once per question in create
      expect(prisma.course.findUnique).toHaveBeenCalled();
    });

    it('should throw ForbiddenException if teacher does not own course', async () => {
      prisma.course.findUnique.mockResolvedValue({ teacherId: 'other' });

      await expect(service.bulkImport(teacherId, courseId, [])).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── bulkUpdateStatus ──────────────────────────────────

  describe('bulkUpdateStatus', () => {
    const teacherId = 'teacher-1';

    it('should update status for owned questions', async () => {
      prisma.question.findMany.mockResolvedValue([
        { id: 'q1', course: { teacherId }, topic: null },
        { id: 'q2', course: { teacherId }, topic: null },
      ]);
      prisma.question.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.bulkUpdateStatus(teacherId, ['q1', 'q2'], 'active');

      expect(result).toEqual({ updated: 2 });
      expect(prisma.question.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['q1', 'q2'] } },
        data: { status: 'active', version: { increment: 1 } },
      });
    });

    it('should throw NotFoundException if any question not found', async () => {
      prisma.question.findMany.mockResolvedValue([
        { id: 'q1', course: { teacherId }, topic: null },
      ]);

      await expect(service.bulkUpdateStatus(teacherId, ['q1', 'q2'], 'active')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if teacher does not own a question', async () => {
      prisma.question.findMany.mockResolvedValue([
        { id: 'q1', course: { teacherId }, topic: null },
        { id: 'q2', course: { teacherId: 'other' }, topic: null },
      ]);

      await expect(service.bulkUpdateStatus(teacherId, ['q1', 'q2'], 'active')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should accept ownership through topic.course', async () => {
      prisma.question.findMany.mockResolvedValue([
        { id: 'q1', course: null, topic: { course: { teacherId } } },
      ]);
      prisma.question.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.bulkUpdateStatus(teacherId, ['q1'], 'active');

      expect(result).toEqual({ updated: 1 });
    });
  });

  // ─── duplicate ──────────────────────────────────────

  describe('duplicate', () => {
    const teacherId = 'teacher-1';

    const original = {
      id: 'q1',
      courseId: 'course-1',
      topicId: null,
      prompt: 'Original',
      stem: null,
      type: 'STRUCTURED',
      maxScore: 10,
      rubricJson: null,
      options: null,
      correctOptionId: null,
      correctAnswer: null,
      explanation: null,
      difficulty: 3,
      bloomsLevel: 'APPLY',
      kcIds: ['kc-1'],
      pageIds: [],
      tags: null,
      status: 'active',
      createdBy: null,
      sourceType: null,
      course: { id: 'course-1', title: 'C1', teacherId },
      topic: null,
      questionKcs: [{ kcId: 'kc-1', kc: { id: 'kc-1', code: 'KC1', label: 'KC One' } }],
    };

    beforeEach(() => {
      // findOne is called internally
      prisma.question.findUnique.mockResolvedValue(original);
      prisma.question.create.mockResolvedValue({ id: 'q2', status: 'draft' });
      prisma.questionKc.createMany.mockResolvedValue({ count: 1 });
    });

    it('should create a duplicate with status draft', async () => {
      const result = await service.duplicate('q1', teacherId);

      expect(prisma.question.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          prompt: 'Original',
          status: 'draft',
        }),
      });
      expect(result).toEqual(expect.objectContaining({ status: 'draft' }));
    });

    it('should copy KC join-table links to duplicate', async () => {
      await service.duplicate('q1', teacherId);

      expect(prisma.questionKc.createMany).toHaveBeenCalledWith({
        data: [{ questionId: 'q2', kcId: 'kc-1' }],
      });
    });

    it('should throw NotFoundException for non-existent question', async () => {
      prisma.question.findUnique.mockResolvedValue(null);

      await expect(service.duplicate('bad-id', teacherId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if teacher does not own question', async () => {
      prisma.question.findUnique.mockResolvedValue({
        ...original,
        course: { ...original.course, teacherId: 'other-teacher' },
      });

      await expect(service.duplicate('q1', teacherId)).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── archive ──────────────────────────────────────────

  describe('archive', () => {
    const teacherId = 'teacher-1';

    it('should set status to archived', async () => {
      prisma.question.findUnique.mockResolvedValue({
        id: 'q1',
        course: { teacherId },
        topic: null,
      });
      prisma.question.update.mockResolvedValue({ id: 'q1', status: 'archived' });

      const result = await service.archive('q1', teacherId);

      expect(prisma.question.update).toHaveBeenCalledWith({
        where: { id: 'q1' },
        data: { status: 'archived', version: { increment: 1 } },
      });
      expect(result).toEqual(expect.objectContaining({ status: 'archived' }));
    });

    it('should throw NotFoundException for non-existent question', async () => {
      prisma.question.findUnique.mockResolvedValue(null);

      await expect(service.archive('bad-id', teacherId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if teacher does not own question', async () => {
      prisma.question.findUnique.mockResolvedValue({
        id: 'q1',
        course: { teacherId: 'other-teacher' },
        topic: null,
      });

      await expect(service.archive('q1', teacherId)).rejects.toThrow(ForbiddenException);
    });
  });
});
