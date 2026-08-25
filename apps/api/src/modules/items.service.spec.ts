import { ItemsService } from './items.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

// ─── Helpers ────────────────────────────────────────────

function createMockPrisma() {
  return {
    moduleItem: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    courseModule: {
      findUnique: jest.fn(),
    },
  };
}

function createMockBlob() {
  return {
    getPresignedUploadUrl: jest.fn(),
    getPresignedDownloadUrl: jest.fn(),
    exists: jest.fn(),
  };
}

function pdfItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    type: 'PDF',
    moduleId: 'mod-1',
    module: {
      id: 'mod-1',
      courseId: 'course-1',
      course: { id: 'course-1', teacherId: 'teacher-1' },
    },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────

describe('ItemsService — PDF upload flow', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let blob: ReturnType<typeof createMockBlob>;
  let service: ItemsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    blob = createMockBlob();
    service = new ItemsService(prisma as any, blob as any);
  });

  describe('getUploadUrl', () => {
    it('issues a presigned URL without writing pdfBlobKey to the database yet', async () => {
      prisma.moduleItem.findUnique.mockResolvedValue(pdfItem());
      blob.getPresignedUploadUrl.mockResolvedValue('https://minio.local/signed-put');

      const result = await service.getUploadUrl('item-1', 'teacher-1', 'notes.pdf');

      expect(result.url).toBe('https://minio.local/signed-put');
      expect(result.key).toBe('course-materials/course-1/item-1/notes.pdf');
      // The whole point of the fix: no DB write happens until confirmUpload
      // verifies the file actually exists in storage.
      expect(prisma.moduleItem.update).not.toHaveBeenCalled();
    });

    it('rejects a teacher who does not own the course', async () => {
      prisma.moduleItem.findUnique.mockResolvedValue(pdfItem());

      await expect(service.getUploadUrl('item-1', 'someone-else', 'notes.pdf')).rejects.toThrow(
        ForbiddenException,
      );
      expect(blob.getPresignedUploadUrl).not.toHaveBeenCalled();
    });

    it('rejects uploading to a non-PDF item', async () => {
      prisma.moduleItem.findUnique.mockResolvedValue(pdfItem({ type: 'PAGE' }));

      await expect(service.getUploadUrl('item-1', 'teacher-1', 'notes.pdf')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('confirmUpload', () => {
    it('writes pdfBlobKey/filename/size once the object is verified to exist', async () => {
      prisma.moduleItem.findUnique.mockResolvedValue(pdfItem());
      blob.exists.mockResolvedValue(true);
      prisma.moduleItem.update.mockResolvedValue({ id: 'item-1' });

      await service.confirmUpload(
        'item-1',
        'teacher-1',
        'course-materials/course-1/item-1/notes.pdf',
        'notes.pdf',
        2048,
      );

      expect(blob.exists).toHaveBeenCalledWith('course-materials/course-1/item-1/notes.pdf');
      expect(prisma.moduleItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: {
          pdfBlobKey: 'course-materials/course-1/item-1/notes.pdf',
          pdfFilename: 'notes.pdf',
          pdfSize: 2048,
        },
      });
    });

    it('refuses to commit metadata when the upload never actually landed in storage', async () => {
      prisma.moduleItem.findUnique.mockResolvedValue(pdfItem());
      blob.exists.mockResolvedValue(false);

      await expect(
        service.confirmUpload(
          'item-1',
          'teacher-1',
          'course-materials/course-1/item-1/notes.pdf',
          'notes.pdf',
          2048,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.moduleItem.update).not.toHaveBeenCalled();
    });

    it('rejects a key that does not belong to this item (spoofed/mismatched key)', async () => {
      prisma.moduleItem.findUnique.mockResolvedValue(pdfItem());
      blob.exists.mockResolvedValue(true);

      await expect(
        service.confirmUpload(
          'item-1',
          'teacher-1',
          'course-materials/course-1/OTHER-ITEM/notes.pdf',
          'notes.pdf',
          2048,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.moduleItem.update).not.toHaveBeenCalled();
    });

    it('rejects a teacher who does not own the course', async () => {
      prisma.moduleItem.findUnique.mockResolvedValue(pdfItem());

      await expect(
        service.confirmUpload(
          'item-1',
          'someone-else',
          'course-materials/course-1/item-1/notes.pdf',
          'notes.pdf',
          2048,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(blob.exists).not.toHaveBeenCalled();
    });
  });
});
