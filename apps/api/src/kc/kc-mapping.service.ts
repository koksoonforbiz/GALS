import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class KcMappingService {
  constructor(private readonly prisma: PrismaService) {}

  /** List all mappings for a course */
  async listByCourse(courseId: string) {
    return this.prisma.kcContentMapping.findMany({
      where: { courseId },
      include: {
        kc: { select: { id: true, name: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** List mappings for a specific KC */
  async listByKc(kcId: string) {
    return this.prisma.kcContentMapping.findMany({
      where: { kcId },
      orderBy: { strength: 'asc' },
    });
  }

  /** List mappings for a specific page */
  async listByPage(pageId: string) {
    return this.prisma.kcContentMapping.findMany({
      where: { pageId },
      include: {
        kc: { select: { id: true, name: true, status: true, confidenceLevel: true } },
      },
      orderBy: { strength: 'asc' },
    });
  }

  /** Create or update a mapping */
  async upsertMapping(dto: {
    courseId: string;
    kcId: string;
    pageId: string;
    strength: string;
    blockIds?: string[];
    createdBy?: string;
  }) {
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(dto.strength)) {
      throw new BadRequestException('Strength must be LOW, MEDIUM, or HIGH');
    }

    return this.prisma.kcContentMapping.upsert({
      where: {
        kcId_pageId: {
          kcId: dto.kcId,
          pageId: dto.pageId,
        },
      },
      update: {
        strength: dto.strength,
        blockIds: dto.blockIds || [],
        createdBy: dto.createdBy || 'human',
      },
      create: {
        courseId: dto.courseId,
        kcId: dto.kcId,
        pageId: dto.pageId,
        strength: dto.strength,
        blockIds: dto.blockIds || [],
        createdBy: dto.createdBy || 'human',
      },
    });
  }

  /** Update mapping strength */
  async updateStrength(id: string, strength: string) {
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(strength)) {
      throw new BadRequestException('Strength must be LOW, MEDIUM, or HIGH');
    }

    const mapping = await this.prisma.kcContentMapping.findUnique({ where: { id } });
    if (!mapping) throw new NotFoundException(`Mapping ${id} not found`);

    return this.prisma.kcContentMapping.update({
      where: { id },
      data: { strength, createdBy: 'human' },
    });
  }

  /** Remove a mapping */
  async remove(id: string) {
    const mapping = await this.prisma.kcContentMapping.findUnique({ where: { id } });
    if (!mapping) throw new NotFoundException(`Mapping ${id} not found`);
    await this.prisma.kcContentMapping.delete({ where: { id } });
    return { deleted: true };
  }

  /** Get bidirectional summary for a course */
  async getSummary(courseId: string) {
    const mappings = await this.prisma.kcContentMapping.findMany({
      where: { courseId },
      include: {
        kc: { select: { id: true, name: true, status: true } },
      },
    });

    // KC -> pages
    const kcToPages = new Map<string, { kcName: string; pages: Array<{ pageId: string; strength: string }> }>();
    // Page -> KCs
    const pageToKcs = new Map<string, Array<{ kcId: string; kcName: string; strength: string }>>();

    for (const m of mappings) {
      // KC side
      if (!kcToPages.has(m.kcId)) {
        kcToPages.set(m.kcId, { kcName: m.kc.name, pages: [] });
      }
      kcToPages.get(m.kcId)!.pages.push({ pageId: m.pageId, strength: m.strength });

      // Page side
      if (!pageToKcs.has(m.pageId)) {
        pageToKcs.set(m.pageId, []);
      }
      pageToKcs.get(m.pageId)!.push({ kcId: m.kcId, kcName: m.kc.name, strength: m.strength });
    }

    return {
      byKc: Object.fromEntries(kcToPages),
      byPage: Object.fromEntries(pageToKcs),
      totalMappings: mappings.length,
    };
  }

  /**
   * Auto-generate mappings from ProposedKC evidence data.
   * Called after KC suggestions are created to populate initial mappings.
   */
  async autoGenerateFromEvidence(courseId: string) {
    const kcs = await this.prisma.proposedKC.findMany({
      where: { courseId, status: { not: 'ARCHIVED' } },
      select: { id: true, pageIds: true, evidence: true, confidenceLevel: true },
    });

    let created = 0;
    for (const kc of kcs) {
      for (const pageId of kc.pageIds) {
        // Map confidence to strength
        const strength =
          kc.confidenceLevel === 'HIGH' ? 'HIGH' :
          kc.confidenceLevel === 'LOW' ? 'LOW' : 'MEDIUM';

        const evidence = kc.evidence as any;
        const blockIds = evidence?.blockIds || [];

        try {
          await this.prisma.kcContentMapping.upsert({
            where: { kcId_pageId: { kcId: kc.id, pageId } },
            update: {}, // Don't overwrite existing human edits
            create: {
              courseId,
              kcId: kc.id,
              pageId,
              strength,
              blockIds,
              createdBy: 'ai',
            },
          });
          created++;
        } catch {
          // Unique constraint or other — skip
        }
      }
    }

    return { mappingsCreated: created };
  }
}
