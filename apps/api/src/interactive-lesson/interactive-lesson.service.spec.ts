import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { InteractiveLessonService } from './interactive-lesson.service';

const LESSON = {
  schemaVersion: 1,
  source: { file: 'course_slides.html', sha256: 'x', importedAt: '2026-10-07T00:00:00Z' },
  session: { id: 1, title: 'S1', covers: '', bigq: '', core: [], appendix: false },
  slides: [
    { key: 's1-0', t: 'title', contentHash: 'a' },
    { key: 's1-1', t: 'think', contentHash: 'b', prompt: 'p' },
  ],
};

function lessonItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    type: 'INTERACTIVE_LESSON',
    title: 'S1',
    moduleId: 'mod-1',
    lessonJson: LESSON,
    module: { courseId: 'course-1', course: { teacherId: 'teacher-1' } },
    ...overrides,
  };
}

function createMockPrisma() {
  return {
    moduleItem: { findUnique: jest.fn() },
    enrollment: { findUnique: jest.fn() },
    lessonSlideState: { findMany: jest.fn(), upsert: jest.fn() },
  };
}

describe('InteractiveLessonService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: InteractiveLessonService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new InteractiveLessonService(prisma as any);
  });

  describe('getLesson', () => {
    it('returns the lesson and the student’s saved state when enrolled', async () => {
      prisma.moduleItem.findUnique.mockResolvedValue(lessonItem());
      prisma.enrollment.findUnique.mockResolvedValue({ status: 'ACTIVE' });
      prisma.lessonSlideState.findMany.mockResolvedValue([
        { slideKey: 's1-1', state: { fields: { text: 'my prediction' } } },
      ]);
      const res = await service.getLesson('item-1', { id: 'stu-1', role: 'student' });
      expect(res.item).toEqual({
        id: 'item-1',
        title: 'S1',
        moduleId: 'mod-1',
        courseId: 'course-1',
      });
      expect(res.lesson.slides).toHaveLength(2);
      expect(res.state).toEqual({ 's1-1': { fields: { text: 'my prediction' } } });
      expect(prisma.lessonSlideState.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { studentId: 'stu-1', moduleItemId: 'item-1' } }),
      );
    });

    it('refuses a student without an ACTIVE enrollment', async () => {
      prisma.moduleItem.findUnique.mockResolvedValue(lessonItem());
      prisma.enrollment.findUnique.mockResolvedValue({ status: 'DROPPED' });
      await expect(service.getLesson('item-1', { id: 'stu-1', role: 'student' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lets the owning teacher preview without loading any student state', async () => {
      prisma.moduleItem.findUnique.mockResolvedValue(lessonItem());
      const res = await service.getLesson('item-1', { id: 'teacher-1', role: 'teacher' });
      expect(res.state).toEqual({});
      expect(prisma.lessonSlideState.findMany).not.toHaveBeenCalled();
    });

    it('refuses a teacher who does not own the course', async () => {
      prisma.moduleItem.findUnique.mockResolvedValue(lessonItem());
      await expect(
        service.getLesson('item-1', { id: 'teacher-2', role: 'teacher' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('404s for a non-interactive item', async () => {
      prisma.moduleItem.findUnique.mockResolvedValue(
        lessonItem({ type: 'PAGE', lessonJson: null }),
      );
      await expect(service.getLesson('item-1', { id: 'admin-1', role: 'admin' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('saveSlideState', () => {
    beforeEach(() => {
      prisma.moduleItem.findUnique.mockResolvedValue(lessonItem());
      prisma.enrollment.findUnique.mockResolvedValue({ status: 'ACTIVE' });
      prisma.lessonSlideState.upsert.mockResolvedValue({
        slideKey: 's1-1',
        updatedAt: new Date(0),
      });
    });

    it('upserts the slide state keyed by student, item and slide', async () => {
      const res = await service.saveSlideState(
        'item-1',
        's1-1',
        'stu-1',
        { fields: { text: 'abc' } },
        'sess-1',
      );
      expect(res.ok).toBe(true);
      expect(prisma.lessonSlideState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            studentId_moduleItemId_slideKey: {
              studentId: 'stu-1',
              moduleItemId: 'item-1',
              slideKey: 's1-1',
            },
          },
          create: expect.objectContaining({
            lastSessionId: 'sess-1',
            state: { fields: { text: 'abc' } },
          }),
        }),
      );
    });

    it('rejects a slide key that is not in the lesson', async () => {
      await expect(
        service.saveSlideState('item-1', 's9-9', 'stu-1', { fields: {} }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects oversized state', async () => {
      const big = { fields: { text: 'x'.repeat(40_000) } };
      await expect(service.saveSlideState('item-1', 's1-1', 'stu-1', big)).rejects.toThrow(
        PayloadTooLargeException,
      );
      expect(prisma.lessonSlideState.upsert).not.toHaveBeenCalled();
    });
  });
});
