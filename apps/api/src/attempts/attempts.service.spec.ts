import { AttemptsService } from './attempts.service';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { EventTopics } from '@ats/shared';

// ─── Helpers ────────────────────────────────────────────

function createMockPrisma() {
  return {
    attempt: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    question: {
      findUnique: jest.fn(),
    },
    enrollment: {
      findUnique: jest.fn(),
    },
    assessmentQuestion: {
      findFirst: jest.fn(),
    },
    gradingResult: {
      create: jest.fn(),
    },
  };
}

function createMockEventBus() {
  return { publish: jest.fn().mockResolvedValue(undefined) };
}

function createMockMasteryService() {
  return { updateMasteryAfterGrading: jest.fn().mockResolvedValue(undefined) };
}

function createMockActivityLogService() {
  return { record: jest.fn().mockResolvedValue(undefined) };
}

function createService(
  prisma: any,
  eventBus: any,
  masteryService: any,
  activityLogService?: any,
): AttemptsService {
  return new AttemptsService(
    prisma,
    eventBus,
    masteryService,
    activityLogService ?? createMockActivityLogService(),
  );
}

// ─── Tests ──────────────────────────────────────────────

describe('AttemptsService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let eventBus: ReturnType<typeof createMockEventBus>;
  let masteryService: ReturnType<typeof createMockMasteryService>;
  let service: AttemptsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    eventBus = createMockEventBus();
    masteryService = createMockMasteryService();
    service = createService(prisma, eventBus, masteryService);
  });

  // ─── create ──────────────────────────────────────────

  describe('create', () => {
    const studentId = 'student-1';

    it('should create attempt with assessmentId', async () => {
      prisma.assessmentQuestion.findFirst.mockResolvedValue({
        questionId: 'q1',
        question: { id: 'q1' },
        assessment: { courseId: 'course-1' },
      });
      prisma.enrollment.findUnique.mockResolvedValue({ id: 'enr-1' });
      prisma.attempt.create.mockResolvedValue({
        id: 'att-1',
        studentId,
        questionId: 'q1',
        status: 'in_progress',
      });

      const result = await service.create(studentId, { assessmentId: 'assess-1' });

      expect(prisma.assessmentQuestion.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { assessmentId: 'assess-1' },
        }),
      );
      expect(prisma.enrollment.findUnique).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ id: 'att-1' }));
    });

    it('should throw NotFoundException if assessment has no questions', async () => {
      prisma.assessmentQuestion.findFirst.mockResolvedValue(null);

      await expect(service.create(studentId, { assessmentId: 'assess-1' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if student not enrolled (assessment)', async () => {
      prisma.assessmentQuestion.findFirst.mockResolvedValue({
        questionId: 'q1',
        question: { id: 'q1' },
        assessment: { courseId: 'course-1' },
      });
      prisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(service.create(studentId, { assessmentId: 'assess-1' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should create attempt with questionId', async () => {
      prisma.question.findUnique.mockResolvedValue({
        id: 'q1',
        courseId: 'course-1',
        course: { id: 'course-1' },
        topic: null,
      });
      prisma.enrollment.findUnique.mockResolvedValue({ id: 'enr-1' });
      prisma.attempt.create.mockResolvedValue({
        id: 'att-1',
        studentId,
        questionId: 'q1',
        status: 'in_progress',
      });

      const result = await service.create(studentId, { questionId: 'q1' });

      expect(prisma.question.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'q1' } }),
      );
      expect(result).toEqual(expect.objectContaining({ id: 'att-1' }));
    });

    it('should throw NotFoundException if question not found', async () => {
      prisma.question.findUnique.mockResolvedValue(null);

      await expect(service.create(studentId, { questionId: 'bad-id' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if student not enrolled (question)', async () => {
      prisma.question.findUnique.mockResolvedValue({
        id: 'q1',
        courseId: 'course-1',
        course: { id: 'course-1' },
        topic: null,
      });
      prisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(service.create(studentId, { questionId: 'q1' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException if neither assessmentId nor questionId', async () => {
      await expect(service.create(studentId, {} as any)).rejects.toThrow(BadRequestException);
    });
  });

  // ─── update ──────────────────────────────────────────

  describe('update', () => {
    const studentId = 'student-1';

    const existingAttempt = {
      id: 'att-1',
      studentId,
      status: 'in_progress',
    };

    beforeEach(() => {
      prisma.attempt.findUnique.mockResolvedValue(existingAttempt);
      prisma.attempt.update.mockResolvedValue({ ...existingAttempt, textResponse: 'answer' });
    });

    it('should update text response', async () => {
      await service.update('att-1', studentId, { textResponse: 'answer' });

      expect(prisma.attempt.update).toHaveBeenCalledWith({
        where: { id: 'att-1' },
        data: expect.objectContaining({ textResponse: 'answer' }),
      });
    });

    it('should update selectedOptionIds', async () => {
      await service.update('att-1', studentId, { selectedOptionIds: ['a', 'b'] });

      expect(prisma.attempt.update).toHaveBeenCalledWith({
        where: { id: 'att-1' },
        data: expect.objectContaining({ selectedOptionIds: ['a', 'b'] }),
      });
    });

    it('should throw NotFoundException if attempt not found', async () => {
      prisma.attempt.findUnique.mockResolvedValue(null);

      await expect(service.update('bad-id', studentId, { textResponse: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException if not the student's attempt", async () => {
      prisma.attempt.findUnique.mockResolvedValue({
        ...existingAttempt,
        studentId: 'other-student',
      });

      await expect(service.update('att-1', studentId, { textResponse: 'X' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException if attempt is not in_progress', async () => {
      prisma.attempt.findUnique.mockResolvedValue({
        ...existingAttempt,
        status: 'submitted',
      });

      await expect(service.update('att-1', studentId, { textResponse: 'X' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── submit ──────────────────────────────────────────

  describe('submit', () => {
    const studentId = 'student-1';

    describe('MCQ_SINGLE auto-grading', () => {
      const mcqQuestion = {
        id: 'q1',
        type: 'MCQ_SINGLE',
        maxScore: 10,
        correctOptionId: null,
        options: [
          { id: 'opt-a', text: 'A', isCorrect: false },
          { id: 'opt-b', text: 'B', isCorrect: true },
          { id: 'opt-c', text: 'C', isCorrect: false },
        ],
        rubricJson: null,
      };

      const baseAttempt = {
        id: 'att-1',
        studentId,
        questionId: 'q1',
        status: 'in_progress',
        textResponse: null,
        selectedOptionIds: null,

        question: mcqQuestion,
      };

      beforeEach(() => {
        prisma.attempt.update.mockResolvedValue({ ...baseAttempt, status: 'submitted' });
        prisma.gradingResult.create.mockResolvedValue({ id: 'gr-1' });
        // For findOne after auto-grade
        prisma.attempt.findUnique.mockResolvedValue(baseAttempt);
      });

      it('should give full score for correct answer', async () => {
        prisma.attempt.findUnique.mockResolvedValue(baseAttempt);

        await service.submit('att-1', studentId, {
          selectedOptionIds: ['opt-b'],
        });

        expect(prisma.gradingResult.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            attemptId: 'att-1',
            score: 10,
            feedback: 'Correct!',
            gradedBy: 'auto',
          }),
        });

        // Should update attempt to graded status
        expect(prisma.attempt.update).toHaveBeenCalledWith({
          where: { id: 'att-1' },
          data: expect.objectContaining({
            status: 'graded',
            currentScore: 10,
            autoFeedback: 'Correct!',
          }),
        });
      });

      it('should give 0 score for wrong answer and show correct answer', async () => {
        prisma.attempt.findUnique.mockResolvedValue(baseAttempt);

        await service.submit('att-1', studentId, {
          selectedOptionIds: ['opt-a'],
        });

        expect(prisma.gradingResult.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            score: 0,
            feedback: 'Incorrect. The correct answer was: B',
          }),
        });
      });
    });

    describe('MCQ_MULTI auto-grading', () => {
      const mcqMultiQuestion = {
        id: 'q2',
        type: 'MCQ_MULTI',
        maxScore: 12,
        correctOptionId: null,
        options: [
          { id: 'opt-a', text: 'A', isCorrect: true },
          { id: 'opt-b', text: 'B', isCorrect: true },
          { id: 'opt-c', text: 'C', isCorrect: true },
          { id: 'opt-d', text: 'D', isCorrect: false },
        ],
        rubricJson: null,
      };

      const baseAttempt = {
        id: 'att-2',
        studentId: 'student-1',
        questionId: 'q2',
        status: 'in_progress',
        textResponse: null,
        selectedOptionIds: null,

        question: mcqMultiQuestion,
      };

      beforeEach(() => {
        prisma.attempt.update.mockResolvedValue({ ...baseAttempt, status: 'submitted' });
        prisma.gradingResult.create.mockResolvedValue({ id: 'gr-2' });
        prisma.attempt.findUnique.mockResolvedValue(baseAttempt);
      });

      it('should give full score when all correct options selected', async () => {
        prisma.attempt.findUnique.mockResolvedValue(baseAttempt);

        await service.submit('att-2', 'student-1', {
          selectedOptionIds: ['opt-a', 'opt-b', 'opt-c'],
        });

        expect(prisma.gradingResult.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            score: 12,
            feedback: 'All correct!',
          }),
        });
      });

      it('should give partial credit: 2/3 correct, 0 incorrect', async () => {
        prisma.attempt.findUnique.mockResolvedValue(baseAttempt);

        await service.submit('att-2', 'student-1', {
          selectedOptionIds: ['opt-a', 'opt-b'],
        });

        // score = (2/3) * 12 = 8.0
        const expectedScore = Math.round((2 / 3) * 12 * 100) / 100;
        expect(prisma.gradingResult.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            score: expectedScore,
          }),
        });
      });

      it('should penalize incorrect selections: 1 correct, 1 incorrect out of 3 total correct', async () => {
        prisma.attempt.findUnique.mockResolvedValue(baseAttempt);

        await service.submit('att-2', 'student-1', {
          selectedOptionIds: ['opt-a', 'opt-d'],
        });

        // correctSelected=1, incorrectSelected=1, totalCorrect=3
        // rawScore = max(0, (1-1)/3) = 0
        expect(prisma.gradingResult.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            score: 0,
          }),
        });
      });

      it('should give 0 when only incorrect options selected', async () => {
        prisma.attempt.findUnique.mockResolvedValue(baseAttempt);

        await service.submit('att-2', 'student-1', {
          selectedOptionIds: ['opt-d'],
        });

        // correctSelected=0, incorrectSelected=1, totalCorrect=3
        // rawScore = max(0, (0-1)/3) = 0
        expect(prisma.gradingResult.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            score: 0,
          }),
        });
      });

      it('should handle 2 correct, 1 incorrect out of 3 total correct', async () => {
        prisma.attempt.findUnique.mockResolvedValue(baseAttempt);

        await service.submit('att-2', 'student-1', {
          selectedOptionIds: ['opt-a', 'opt-b', 'opt-d'],
        });

        // correctSelected=2, incorrectSelected=1, totalCorrect=3
        // rawScore = max(0, (2-1)/3) = 1/3
        // score = round(1/3 * 12 * 100) / 100 = 4
        const expectedScore = Math.round((1 / 3) * 12 * 100) / 100;
        expect(prisma.gradingResult.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            score: expectedScore,
          }),
        });
      });
    });

    describe('non-MCQ submission', () => {
      const shortAnswerQuestion = {
        id: 'q3',
        type: 'SHORT_ANSWER',
        maxScore: 20,
        correctOptionId: null,
        options: null,
        rubricJson: { criteria: 'test' },
      };

      const baseAttempt = {
        id: 'att-3',
        studentId: 'student-1',
        questionId: 'q3',
        status: 'in_progress',
        textResponse: null,
        selectedOptionIds: null,

        question: shortAnswerQuestion,
      };

      beforeEach(() => {
        prisma.attempt.findUnique.mockResolvedValue(baseAttempt);
        prisma.attempt.update.mockResolvedValue({ ...baseAttempt, status: 'submitted' });
      });

      it('should publish GRADE_SUBMISSION event for non-MCQ type', async () => {
        await service.submit('att-3', 'student-1', {
          textResponse: 'My answer',
        });

        expect(eventBus.publish).toHaveBeenCalledWith(
          EventTopics.GRADE_SUBMISSION,
          expect.objectContaining({
            attemptId: 'att-3',
            questionId: 'q3',
            studentId: 'student-1',
            textResponse: 'My answer',
            maxScore: 20,
          }),
        );
      });

      it('should not create gradingResult for non-MCQ type', async () => {
        await service.submit('att-3', 'student-1', {
          textResponse: 'My answer',
        });

        expect(prisma.gradingResult.create).not.toHaveBeenCalled();
      });
    });

    describe('submission guards', () => {
      it('should throw NotFoundException for non-existent attempt', async () => {
        prisma.attempt.findUnique.mockResolvedValue(null);

        await expect(service.submit('bad-id', 'student-1', {})).rejects.toThrow(NotFoundException);
      });

      it("should throw ForbiddenException if not the student's attempt", async () => {
        prisma.attempt.findUnique.mockResolvedValue({
          id: 'att-1',
          studentId: 'other-student',
          status: 'in_progress',
          question: { type: 'SHORT_ANSWER', maxScore: 10, options: null },
        });

        await expect(service.submit('att-1', 'student-1', {})).rejects.toThrow(ForbiddenException);
      });

      it('should throw BadRequestException if attempt already submitted', async () => {
        prisma.attempt.findUnique.mockResolvedValue({
          id: 'att-1',
          studentId: 'student-1',
          status: 'submitted',
          question: { type: 'SHORT_ANSWER', maxScore: 10, options: null },
        });

        await expect(service.submit('att-1', 'student-1', {})).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException if attempt already graded', async () => {
        prisma.attempt.findUnique.mockResolvedValue({
          id: 'att-1',
          studentId: 'student-1',
          status: 'graded',
          question: { type: 'SHORT_ANSWER', maxScore: 10, options: null },
        });

        await expect(service.submit('att-1', 'student-1', {})).rejects.toThrow(BadRequestException);
      });
    });
  });

  // ─── manualGrade ──────────────────────────────────────

  describe('manualGrade', () => {
    const teacherId = 'teacher-1';

    const attemptWithQuestion = {
      id: 'att-1',
      studentId: 'student-1',
      questionId: 'q1',
      status: 'submitted',
      question: {
        id: 'q1',
        maxScore: 10,
        topic: { course: { teacherId, id: 'course-1' } },
        course: null,
      },
    };

    beforeEach(() => {
      prisma.attempt.findUnique.mockResolvedValue(attemptWithQuestion);
      prisma.gradingResult.create.mockResolvedValue({ id: 'gr-1' });
      prisma.attempt.update.mockResolvedValue({
        ...attemptWithQuestion,
        status: 'graded',
        currentScore: 8,
      });
    });

    it('should create grading result and update attempt', async () => {
      await service.manualGrade('att-1', teacherId, {
        score: 8,
        feedback: 'Good work',
      });

      expect(prisma.gradingResult.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          attemptId: 'att-1',
          score: 8,
          feedback: 'Good work',
          gradedBy: 'manual',
          graderId: teacherId,
        }),
      });

      expect(prisma.attempt.update).toHaveBeenCalledWith({
        where: { id: 'att-1' },
        data: { status: 'graded', currentScore: 8 },
      });
    });

    it('should update mastery after grading', async () => {
      await service.manualGrade('att-1', teacherId, {
        score: 8,
        feedback: 'Good',
      });

      expect(masteryService.updateMasteryAfterGrading).toHaveBeenCalledWith('gr-1', 'att-1');
    });

    it('should publish GRADE_COMPLETED event', async () => {
      await service.manualGrade('att-1', teacherId, {
        score: 8,
        feedback: 'Good',
      });

      expect(eventBus.publish).toHaveBeenCalledWith(
        EventTopics.GRADE_COMPLETED,
        expect.objectContaining({
          attemptId: 'att-1',
          studentId: 'student-1',
          questionId: 'q1',
          score: 8,
          feedback: 'Good',
          gradedBy: 'manual',
        }),
      );
    });

    it('should throw NotFoundException for non-existent attempt', async () => {
      prisma.attempt.findUnique.mockResolvedValue(null);

      await expect(
        service.manualGrade('bad-id', teacherId, { score: 5, feedback: '' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if teacher does not own the course', async () => {
      prisma.attempt.findUnique.mockResolvedValue({
        ...attemptWithQuestion,
        question: {
          ...attemptWithQuestion.question,
          topic: { course: { teacherId: 'other-teacher', id: 'course-1' } },
        },
      });

      await expect(
        service.manualGrade('att-1', teacherId, { score: 5, feedback: '' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if attempt is in_progress', async () => {
      prisma.attempt.findUnique.mockResolvedValue({
        ...attemptWithQuestion,
        status: 'in_progress',
      });

      await expect(
        service.manualGrade('att-1', teacherId, { score: 5, feedback: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if score exceeds maxScore', async () => {
      await expect(
        service.manualGrade('att-1', teacherId, { score: 15, feedback: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept ownership through question.course', async () => {
      prisma.attempt.findUnique.mockResolvedValue({
        ...attemptWithQuestion,
        question: {
          id: 'q1',
          maxScore: 10,
          topic: null,
          course: { teacherId, id: 'course-1' },
        },
      });
      prisma.gradingResult.create.mockResolvedValue({ id: 'gr-1' });
      prisma.attempt.update.mockResolvedValue({ status: 'graded' });

      await expect(
        service.manualGrade('att-1', teacherId, { score: 5, feedback: 'Ok' }),
      ).resolves.not.toThrow();
    });
  });
});
