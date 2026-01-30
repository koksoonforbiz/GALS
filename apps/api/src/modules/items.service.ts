import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { BlobService } from '../blob/blob.service';

interface CreateItemDto {
  type: 'PAGE' | 'PDF' | 'LINK' | 'ASSESSMENT';
  title: string;
  contentMdx?: string;
  url?: string;
  assessmentId?: string;
}

interface UpdateItemDto {
  title?: string;
  contentMdx?: string;
  url?: string;
}

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blob: BlobService,
  ) {}

  private async verifyModuleOwnership(moduleId: string, teacherId: string) {
    const mod = await this.prisma.courseModule.findUnique({
      where: { id: moduleId },
      include: { course: true },
    });
    if (!mod) throw new NotFoundException(`Module ${moduleId} not found`);
    if (mod.course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only manage items in your own courses');
    }
    return mod;
  }

  private async verifyItemOwnership(itemId: string, teacherId: string) {
    const item = await this.prisma.moduleItem.findUnique({
      where: { id: itemId },
      include: { module: { include: { course: true } } },
    });
    if (!item) throw new NotFoundException(`Item ${itemId} not found`);
    if (item.module.course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only manage items in your own courses');
    }
    return item;
  }

  async create(moduleId: string, teacherId: string, dto: CreateItemDto) {
    await this.verifyModuleOwnership(moduleId, teacherId);

    const maxOrder = await this.prisma.moduleItem.aggregate({
      where: { moduleId },
      _max: { orderIndex: true },
    });

    return this.prisma.moduleItem.create({
      data: {
        moduleId,
        type: dto.type,
        title: dto.title,
        orderIndex: (maxOrder._max.orderIndex ?? -1) + 1,
        contentMdx: dto.contentMdx,
        url: dto.url,
        assessmentId: dto.assessmentId,
      },
    });
  }

  async update(itemId: string, teacherId: string, dto: UpdateItemDto) {
    await this.verifyItemOwnership(itemId, teacherId);

    return this.prisma.moduleItem.update({
      where: { id: itemId },
      data: dto,
    });
  }

  async remove(itemId: string, teacherId: string) {
    await this.verifyItemOwnership(itemId, teacherId);
    await this.prisma.moduleItem.delete({ where: { id: itemId } });
    return { deleted: true };
  }

  async reorder(moduleId: string, teacherId: string, orderedIds: string[]) {
    await this.verifyModuleOwnership(moduleId, teacherId);

    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.moduleItem.update({
          where: { id },
          data: { orderIndex: index },
        }),
      ),
    );

    return this.prisma.moduleItem.findMany({
      where: { moduleId },
      orderBy: { orderIndex: 'asc' },
    });
  }

  // PDF upload: returns a presigned URL for the client to upload to
  async getUploadUrl(itemId: string, teacherId: string, filename: string, size: number) {
    const item = await this.verifyItemOwnership(itemId, teacherId);

    if (item.type !== 'PDF') {
      throw new ForbiddenException('Can only upload PDFs to PDF-type items');
    }

    const key = `course-materials/${item.module.courseId}/${itemId}/${filename}`;
    const url = await this.blob.getPresignedUploadUrl({
      key,
      contentType: 'application/pdf',
    });

    // Store the blob key and metadata
    await this.prisma.moduleItem.update({
      where: { id: itemId },
      data: {
        pdfBlobKey: key,
        pdfFilename: filename,
        pdfSize: size,
      },
    });

    return { url, key };
  }

  async getDownloadUrl(itemId: string) {
    const item = await this.prisma.moduleItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException(`Item ${itemId} not found`);
    if (!item.pdfBlobKey) throw new NotFoundException('No PDF attached to this item');

    const url = await this.blob.getPresignedDownloadUrl({ key: item.pdfBlobKey });
    return { url, filename: item.pdfFilename };
  }
}
