import { SessionService } from './session.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

// ─── Helpers ────────────────────────────────────────────

function createMockPrisma() {
  return {
    studentSession: {
      findUnique: jest.fn(),
    },
    course: {
      findUnique: jest.fn(),
    },
    enrollment: {
      findFirst: jest.fn(),
    },
  };
}

function createMockActivityLog() {
  return { record: jest.fn().mockResolvedValue(undefined) };
}

// ─── Tests ──────────────────────────────────────────────

describe('SessionService — ownership checks', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: SessionService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new SessionService(prisma as any, createMockActivityLog() as any);
  });

  describe('assertOwnsSession', () => {
    it('passes when the session belongs to the caller', async () => {
      prisma.studentSession.findUnique.mockResolvedValue({ userId: 'user-1' });
      await expect(service.assertOwnsSession('sess-1', 'user-1')).resolves.toBeUndefined();
    });

    it('throws Forbidden when the session belongs to someone else', async () => {
      prisma.studentSession.findUnique.mockResolvedValue({ userId: 'user-1' });
      await expect(service.assertOwnsSession('sess-1', 'attacker')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFound when the session does not exist', async () => {
      prisma.studentSession.findUnique.mockResolvedValue(null);
      await expect(service.assertOwnsSession('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('assertTeacherOwnsSession', () => {
    it('passes when the session is in a course the teacher teaches', async () => {
      prisma.studentSession.findUnique.mockResolvedValue({ courseId: 'course-1' });
      prisma.course.findUnique.mockResolvedValue({ teacherId: 'teacher-1' });
      await expect(
        service.assertTeacherOwnsSession('sess-1', 'teacher-1'),
      ).resolves.toBeUndefined();
    });

    it('throws Forbidden when a different teacher owns the course', async () => {
      prisma.studentSession.findUnique.mockResolvedValue({ courseId: 'course-1' });
      prisma.course.findUnique.mockResolvedValue({ teacherId: 'teacher-1' });
      await expect(service.assertTeacherOwnsSession('sess-1', 'other-teacher')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws Forbidden when the session has no course attached', async () => {
      prisma.studentSession.findUnique.mockResolvedValue({ courseId: null });
      await expect(service.assertTeacherOwnsSession('sess-1', 'teacher-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.course.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFound when the session does not exist', async () => {
      prisma.studentSession.findUnique.mockResolvedValue(null);
      await expect(service.assertTeacherOwnsSession('missing', 'teacher-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('assertTeacherOwnsStudent', () => {
    it('passes when the student is enrolled in one of the teacher’s courses', async () => {
      prisma.enrollment.findFirst.mockResolvedValue({ id: 'enr-1' });
      await expect(
        service.assertTeacherOwnsStudent('student-1', 'teacher-1'),
      ).resolves.toBeUndefined();
    });

    it('throws Forbidden when the student is not enrolled in any of the teacher’s courses', async () => {
      prisma.enrollment.findFirst.mockResolvedValue(null);
      await expect(service.assertTeacherOwnsStudent('student-1', 'teacher-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
