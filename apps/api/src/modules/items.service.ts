import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
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

  async update(itemId: string, teacherId: string, dto: UpdateItemDto, source?: string) {
    await this.verifyItemOwnership(itemId, teacherId);

    // Create version snapshot when contentMdx changes
    if (dto.contentMdx !== undefined) {
      await this.createVersionSnapshot(itemId, dto.contentMdx, source || 'human', teacherId);
    }

    return this.prisma.moduleItem.update({
      where: { id: itemId },
      data: dto,
    });
  }

  // ─── Version History ──────────────────────────────────

  async getVersionHistory(itemId: string, teacherId: string) {
    await this.verifyItemOwnership(itemId, teacherId);

    return this.prisma.pageContentVersion.findMany({
      where: { itemId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        source: true,
        authorId: true,
        jobId: true,
        createdAt: true,
      },
    });
  }

  async getVersion(itemId: string, versionId: string, teacherId: string) {
    await this.verifyItemOwnership(itemId, teacherId);

    const ver = await this.prisma.pageContentVersion.findFirst({
      where: { id: versionId, itemId },
    });
    if (!ver) throw new NotFoundException('Version not found');
    return ver;
  }

  async rollbackToVersion(itemId: string, versionId: string, teacherId: string) {
    await this.verifyItemOwnership(itemId, teacherId);

    const ver = await this.prisma.pageContentVersion.findFirst({
      where: { id: versionId, itemId },
    });
    if (!ver) throw new NotFoundException('Version not found');

    // Create a new version from the rollback
    await this.createVersionSnapshot(itemId, ver.contentJson, 'rollback', teacherId);

    return this.prisma.moduleItem.update({
      where: { id: itemId },
      data: { contentMdx: ver.contentJson },
    });
  }

  private async createVersionSnapshot(
    itemId: string,
    contentJson: string,
    source: string,
    authorId?: string,
    jobId?: string,
  ) {
    const latest = await this.prisma.pageContentVersion.findFirst({
      where: { itemId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    await this.prisma.pageContentVersion.create({
      data: {
        itemId,
        version: nextVersion,
        contentJson,
        source,
        authorId: authorId || null,
        jobId: jobId || null,
      },
    });
  }

  async remove(itemId: string, teacherId: string) {
    await this.verifyItemOwnership(itemId, teacherId);
    await this.prisma.moduleItem.delete({ where: { id: itemId } });
    return { deleted: true };
  }

  async reorder(moduleId: string, teacherId: string, orderedIds: string[]) {
    await this.verifyModuleOwnership(moduleId, teacherId);

    // Validate: every id must belong to this module, and the payload must
    // cover the module's current items exactly (no duplicates, no strays,
    // no missing items). This prevents a malformed reorder from moving an
    // item out of its module or leaving holes in orderIndex.
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new BadRequestException('orderedIds must be a non-empty array');
    }
    const unique = new Set(orderedIds);
    if (unique.size !== orderedIds.length) {
      throw new BadRequestException('orderedIds contains duplicate ids');
    }
    const existing = await this.prisma.moduleItem.findMany({
      where: { moduleId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((i) => i.id));
    if (existingIds.size !== unique.size) {
      throw new BadRequestException(
        `orderedIds must contain exactly the ${existingIds.size} item(s) in this module`,
      );
    }
    for (const id of orderedIds) {
      if (!existingIds.has(id)) {
        throw new BadRequestException(`Item ${id} does not belong to module ${moduleId}`);
      }
    }

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
