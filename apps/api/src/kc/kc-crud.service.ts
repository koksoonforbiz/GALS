import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class KcCrudService {
  constructor(private readonly prisma: PrismaService) {}

  /** List proposed KCs for a course, optionally filtered by status */
  async list(courseId: string, status?: string) {
    const where: any = { courseId };
    if (status && ['PROPOSED', 'APPROVED', 'ARCHIVED'].includes(status)) {
      where.status = status;
    }
    return this.prisma.proposedKC.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        relatedTo: { select: { id: true, name: true } },
      },
    });
  }

  /** Get a single proposed KC */
  async findOne(id: string) {
    const kc = await this.prisma.proposedKC.findUnique({
      where: { id },
      include: {
        relatedTo: { select: { id: true, name: true } },
        duplicates: { select: { id: true, name: true, status: true } },
      },
    });
    if (!kc) throw new NotFoundException(`ProposedKC ${id} not found`);
    return kc;
  }

  /** Update a proposed KC */
  async update(
    id: string,
    dto: { name?: string; description?: string; status?: string; confidenceLevel?: string },
  ) {
    const kc = await this.prisma.proposedKC.findUnique({ where: { id } });
    if (!kc) throw new NotFoundException(`ProposedKC ${id} not found`);

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.status && ['PROPOSED', 'APPROVED', 'ARCHIVED'].includes(dto.status)) {
      data.status = dto.status;
    }
    if (dto.confidenceLevel !== undefined) data.confidenceLevel = dto.confidenceLevel;

    return this.prisma.proposedKC.update({ where: { id }, data });
  }

  /** Approve a proposed KC */
  async approve(id: string) {
    const kc = await this.prisma.proposedKC.findUnique({ where: { id } });
    if (!kc) throw new NotFoundException(`ProposedKC ${id} not found`);
    return this.prisma.proposedKC.update({
      where: { id },
      data: { status: 'APPROVED' },
    });
  }

  /** Archive a proposed KC */
  async archive(id: string) {
    const kc = await this.prisma.proposedKC.findUnique({ where: { id } });
    if (!kc) throw new NotFoundException(`ProposedKC ${id} not found`);
    return this.prisma.proposedKC.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
  }

  /** Merge: keep target KC, archive source KC, combine evidence */
  async merge(targetId: string, sourceId: string) {
    const [target, source] = await Promise.all([
      this.prisma.proposedKC.findUnique({ where: { id: targetId } }),
      this.prisma.proposedKC.findUnique({ where: { id: sourceId } }),
    ]);
    if (!target) throw new NotFoundException(`Target KC ${targetId} not found`);
    if (!source) throw new NotFoundException(`Source KC ${sourceId} not found`);

    // Merge evidence
    const targetEvidence = (target.evidence as any) || {};
    const sourceEvidence = (source.evidence as any) || {};

    const mergedBlockIds = [
      ...new Set([
        ...(targetEvidence.blockIds || []),
        ...(sourceEvidence.blockIds || []),
      ]),
    ];

    // Merge pageIds
    const mergedPageIds = [...new Set([...target.pageIds, ...source.pageIds])];

    // Update target with merged data
    await this.prisma.proposedKC.update({
      where: { id: targetId },
      data: {
        evidence: {
          pageId: targetEvidence.pageId || sourceEvidence.pageId,
          blockIds: mergedBlockIds,
        } as unknown as Prisma.InputJsonValue,
        pageIds: mergedPageIds,
      },
    });

    // Archive source and link to target
    await this.prisma.proposedKC.update({
      where: { id: sourceId },
      data: {
        status: 'ARCHIVED',
        relatedToKCId: targetId,
      },
    });

    return this.findOne(targetId);
  }

  /** Delete a proposed KC permanently */
  async remove(id: string) {
    const kc = await this.prisma.proposedKC.findUnique({ where: { id } });
    if (!kc) throw new NotFoundException(`ProposedKC ${id} not found`);

    // Unlink any duplicates referencing this KC
    await this.prisma.proposedKC.updateMany({
      where: { relatedToKCId: id },
      data: { relatedToKCId: null },
    });

    await this.prisma.proposedKC.delete({ where: { id } });
    return { deleted: true };
  }

  /** Summary stats for a course */
  async stats(courseId: string) {
    const [proposed, approved, archived, total] = await Promise.all([
      this.prisma.proposedKC.count({ where: { courseId, status: 'PROPOSED' } }),
      this.prisma.proposedKC.count({ where: { courseId, status: 'APPROVED' } }),
      this.prisma.proposedKC.count({ where: { courseId, status: 'ARCHIVED' } }),
      this.prisma.proposedKC.count({ where: { courseId } }),
    ]);
    return { proposed, approved, archived, total };
  }
}
