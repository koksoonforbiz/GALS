import { RecordingService } from './recording.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

// ─── Helpers ────────────────────────────────────────────
//
// This suite targets the IDOR fix directly: getDownloadUrl and getSegments
// must never hand back a video (or its listing) unless the requesting
// teacher actually teaches the course the recording belongs to.

function createMockPrisma() {
  return {
    course: { findUnique: jest.fn() },
    enrollment: { findUnique: jest.fn() },
    recordingSegment: { findUnique: jest.fn(), findMany: jest.fn() },
    recordingConfig: { findUnique: jest.fn(), create: jest.fn() },
  };
}

function createMockBlob() {
  return {
    getPresignedDownloadUrl: jest.fn(),
    getPresignedUploadUrl: jest.fn(),
    exists: jest.fn(),
  };
}

function createService(prisma: ReturnType<typeof createMockPrisma>) {
  return new RecordingService(
    prisma as any,
    createMockBlob() as any,
    {} as any, // PyfeatService — unused by the methods under test
    {} as any, // Openface3Service — unused by the methods under test
    { record: jest.fn() } as any, // ActivityLogService — unused by the methods under test
  );
}

// ─── Tests ──────────────────────────────────────────────

describe('RecordingService — video access control (IDOR fix)', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: RecordingService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = createService(prisma);
  });

  describe('getDownloadUrl', () => {
    it("returns a signed URL when the requesting teacher owns the segment's course", async () => {
      prisma.recordingSegment.findUnique.mockResolvedValue({
        id: 'seg-1',
        minioKey: 'recordings/course-1/student-9/session-1/clip.webm',
        course: { teacherId: 'teacher-1' },
      });
      const blob = createMockBlob();
      blob.getPresignedDownloadUrl.mockResolvedValue('https://minio.local/signed-get');
      const svc = new RecordingService(
        prisma as any,
        blob as any,
        {} as any,
        {} as any,
        { record: jest.fn() } as any,
      );

      const url = await svc.getDownloadUrl('seg-1', 'teacher-1');

      expect(url).toBe('https://minio.local/signed-get');
    });

    it('blocks a teacher requesting a segment from a course they do not teach — the exact IDOR from the report', async () => {
      prisma.recordingSegment.findUnique.mockResolvedValue({
        id: 'seg-102',
        minioKey: 'recordings/course-1/student-102/session-1/clip.webm',
        course: { teacherId: 'teacher-A' },
      });

      // teacher-B swaps the segmentId in the URL, hoping to get student
      // 102's video even though they don't teach that course.
      await expect(service.getDownloadUrl('seg-102', 'teacher-B')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns NotFound (not a blob URL) for a segment that does not exist', async () => {
      prisma.recordingSegment.findUnique.mockResolvedValue(null);
      await expect(service.getDownloadUrl('missing', 'teacher-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getSegments', () => {
    it('lists segments when the teacher owns the course', async () => {
      prisma.course.findUnique.mockResolvedValue({ teacherId: 'teacher-1' });
      prisma.recordingSegment.findMany.mockResolvedValue([{ id: 'seg-1' }]);

      const result = await service.getSegments('student-1', 'course-1', 'teacher-1');

      expect(result).toEqual([{ id: 'seg-1' }]);
    });

    it("blocks listing a course's segments for a teacher who doesn't teach it", async () => {
      prisma.course.findUnique.mockResolvedValue({ teacherId: 'teacher-A' });

      await expect(service.getSegments('student-1', 'course-1', 'teacher-B')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.recordingSegment.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getConfig', () => {
    it('allows a teacher who owns the course', async () => {
      prisma.course.findUnique.mockResolvedValue({ teacherId: 'teacher-1' });
      prisma.recordingConfig.findUnique.mockResolvedValue({
        courseId: 'course-1',
        isEnabled: true,
      });

      await expect(
        service.getConfig('course-1', { id: 'teacher-1', role: 'teacher' }),
      ).resolves.toBeDefined();
    });

    it('blocks a teacher who does not own the course', async () => {
      prisma.course.findUnique.mockResolvedValue({ teacherId: 'teacher-A' });

      await expect(
        service.getConfig('course-1', { id: 'teacher-B', role: 'teacher' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows an enrolled student', async () => {
      prisma.enrollment.findUnique.mockResolvedValue({ id: 'enr-1' });
      prisma.recordingConfig.findUnique.mockResolvedValue({
        courseId: 'course-1',
        isEnabled: true,
      });

      await expect(
        service.getConfig('course-1', { id: 'student-1', role: 'student' }),
      ).resolves.toBeDefined();
    });

    it('blocks a student who is not enrolled', async () => {
      prisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(
        service.getConfig('course-1', { id: 'student-1', role: 'student' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
