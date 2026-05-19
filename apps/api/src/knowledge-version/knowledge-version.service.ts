import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  KcSnapshot,
  EdgeSnapshot,
  MappingSnapshot,
  KnowledgeChangeType,
  VersionDiff,
  VersionSummary,
} from './knowledge-version.types';

@Injectable()
export class KnowledgeVersionService {
  private readonly logger = new Logger(KnowledgeVersionService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Create Snapshot ──────────────────────────────────────

  /**
   * Captures the current knowledge structure (KCs, edges, mappings) as a version.
   * Called by KC/graph/mapping controllers after mutations.
   */
  async createSnapshot(
    courseId: string,
    changeType: KnowledgeChangeType,
    changeSummary: string,
    source: 'human' | 'ai' | 'restore',
    authorId?: string,
  ): Promise<{ versionId: string; version: number }> {
    try {
      // 1. Capture current state
      const [kcs, edges, maps] = await Promise.all([
        this.captureKcs(courseId),
        this.captureEdges(courseId),
        this.captureMappings(courseId),
      ]);

      // 2. Get next version number
      const latest = await this.prisma.knowledgeVersion.findFirst({
        where: { courseId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const nextVersion = (latest?.version ?? 0) + 1;

      // 3. Store snapshot
      const version = await this.prisma.knowledgeVersion.create({
        data: {
          courseId,
          version: nextVersion,
          changeType,
          changeSummary,
          source,
          authorId: authorId || null,
          snapshotKcs: kcs as unknown as Prisma.InputJsonValue,
          snapshotEdges: edges as unknown as Prisma.InputJsonValue,
          snapshotMaps: maps as unknown as Prisma.InputJsonValue,
        },
      });

      this.logger.log(
        `Created knowledge version ${nextVersion} for course ${courseId}: ${changeType} — ${changeSummary}`,
      );

      return { versionId: version.id, version: nextVersion };
    } catch (err: any) {
      this.logger.error(`Failed to create knowledge version: ${err.message}`, err.stack);
      // Non-blocking: don't fail the parent operation
      return { versionId: '', version: -1 };
    }
  }

  // ─── List Versions ────────────────────────────────────────

  async listVersions(courseId: string, userId: string): Promise<VersionSummary[]> {
    await this.verifyCourseAccess(courseId, userId);

    const versions = await this.prisma.knowledgeVersion.findMany({
      where: { courseId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        changeSummary: true,
        changeType: true,
        source: true,
        authorId: true,
        createdAt: true,
        snapshotKcs: true,
        snapshotEdges: true,
        snapshotMaps: true,
      },
    });

    return versions.map((v) => ({
      id: v.id,
      version: v.version,
      changeSummary: v.changeSummary,
      changeType: v.changeType,
      source: v.source,
      authorId: v.authorId,
      createdAt: v.createdAt.toISOString(),
      stats: {
        kcCount: Array.isArray(v.snapshotKcs) ? (v.snapshotKcs as unknown[]).length : 0,
        edgeCount: Array.isArray(v.snapshotEdges) ? (v.snapshotEdges as unknown[]).length : 0,
        mappingCount: Array.isArray(v.snapshotMaps) ? (v.snapshotMaps as unknown[]).length : 0,
      },
    }));
  }

  // ─── Get Version Detail ───────────────────────────────────

  async getVersion(versionId: string, userId: string) {
    const version = await this.prisma.knowledgeVersion.findUnique({
      where: { id: versionId },
    });
    if (!version) throw new NotFoundException('Version not found');
    await this.verifyCourseAccess(version.courseId, userId);
    return version;
  }

  // ─── Diff Between Versions ────────────────────────────────

  async diffVersions(
    courseId: string,
    userId: string,
    fromVersionId: string,
    toVersionId: string,
  ): Promise<VersionDiff> {
    await this.verifyCourseAccess(courseId, userId);

    const [fromVer, toVer] = await Promise.all([
      this.prisma.knowledgeVersion.findUnique({ where: { id: fromVersionId } }),
      this.prisma.knowledgeVersion.findUnique({ where: { id: toVersionId } }),
    ]);

    if (!fromVer || !toVer) throw new NotFoundException('Version not found');

    return this.computeDiff(
      fromVer.snapshotKcs as unknown as KcSnapshot[],
      fromVer.snapshotEdges as unknown as EdgeSnapshot[],
      fromVer.snapshotMaps as unknown as MappingSnapshot[],
      toVer.snapshotKcs as unknown as KcSnapshot[],
      toVer.snapshotEdges as unknown as EdgeSnapshot[],
      toVer.snapshotMaps as unknown as MappingSnapshot[],
    );
  }

  /**
   * Diff between a specific version and the current live state.
   */
  async diffFromCurrent(
    courseId: string,
    userId: string,
    versionId: string,
  ): Promise<VersionDiff> {
    await this.verifyCourseAccess(courseId, userId);

    const version = await this.prisma.knowledgeVersion.findUnique({
      where: { id: versionId },
    });
    if (!version) throw new NotFoundException('Version not found');

    const [currentKcs, currentEdges, currentMaps] = await Promise.all([
      this.captureKcs(courseId),
      this.captureEdges(courseId),
      this.captureMappings(courseId),
    ]);

    return this.computeDiff(
      currentKcs,
      currentEdges,
      currentMaps,
      version.snapshotKcs as unknown as KcSnapshot[],
      version.snapshotEdges as unknown as EdgeSnapshot[],
      version.snapshotMaps as unknown as MappingSnapshot[],
    );
  }

  // ─── Restore Version ─────────────────────────────────────

  async restoreVersion(
    versionId: string,
    userId: string,
  ): Promise<{ restoredVersion: number; newVersionId: string }> {
    const version = await this.prisma.knowledgeVersion.findUnique({
      where: { id: versionId },
    });
    if (!version) throw new NotFoundException('Version not found');
    await this.verifyCourseAccess(version.courseId, userId);

    const courseId = version.courseId;
    const targetKcs = version.snapshotKcs as unknown as KcSnapshot[];
    const targetEdges = version.snapshotEdges as unknown as EdgeSnapshot[];
    const targetMaps = version.snapshotMaps as unknown as MappingSnapshot[];

    // Execute restore in a transaction
    await this.prisma.$transaction(async (tx) => {
      // 1. Delete all current mappings (depends on KCs, so delete first)
      await tx.kcContentMapping.deleteMany({ where: { courseId } });

      // 2. Delete all current edges
      await tx.kcEdge.deleteMany({ where: { courseId } });

      // 3. Delete all current KCs
      await tx.proposedKC.deleteMany({ where: { courseId } });

      // 4. Recreate KCs from snapshot
      for (const kc of targetKcs) {
        await tx.proposedKC.create({
          data: {
            id: kc.id,
            courseId,
            name: kc.name,
            description: kc.description,
            status: kc.status as any,
            confidenceLevel: kc.confidenceLevel,
            createdBy: kc.createdBy,
            relatedToKCId: null, // Will set in second pass
            evidence: kc.evidence as unknown as Prisma.InputJsonValue,
            pageIds: kc.pageIds,
          },
        });
      }

      // 4b. Set relatedToKCId references (second pass to avoid FK issues)
      const kcIdSet = new Set(targetKcs.map((kc) => kc.id));
      for (const kc of targetKcs) {
        if (kc.relatedToKCId && kcIdSet.has(kc.relatedToKCId)) {
          await tx.proposedKC.update({
            where: { id: kc.id },
            data: { relatedToKCId: kc.relatedToKCId },
          });
        }
      }

      // 5. Recreate edges from snapshot
      for (const edge of targetEdges) {
        // Only restore edges where both KCs exist in the snapshot
        if (kcIdSet.has(edge.fromKcId) && kcIdSet.has(edge.toKcId)) {
          await tx.kcEdge.create({
            data: {
              id: edge.id,
              courseId,
              fromKcId: edge.fromKcId,
              toKcId: edge.toKcId,
              relationship: edge.relationship,
              weight: edge.weight,
              createdBy: edge.createdBy,
            },
          });
        }
      }

      // 6. Recreate mappings from snapshot
      for (const map of targetMaps) {
        if (kcIdSet.has(map.kcId)) {
          await tx.kcContentMapping.create({
            data: {
              id: map.id,
              courseId,
              kcId: map.kcId,
              pageId: map.pageId,
              strength: map.strength,
              blockIds: map.blockIds,
              createdBy: map.createdBy,
            },
          });
        }
      }
    });

    // 7. Create a new version snapshot recording the restore
    const result = await this.createSnapshot(
      courseId,
      'RESTORE',
      `Restored to version ${version.version}`,
      'restore',
      userId,
    );

    this.logger.log(
      `Restored course ${courseId} to version ${version.version}, created new version ${result.version}`,
    );

    return { restoredVersion: version.version, newVersionId: result.versionId };
  }

  // ─── Pure Diff Logic (exported for testing) ───────────────

  computeDiff(
    fromKcs: KcSnapshot[],
    fromEdges: EdgeSnapshot[],
    fromMaps: MappingSnapshot[],
    toKcs: KcSnapshot[],
    toEdges: EdgeSnapshot[],
    toMaps: MappingSnapshot[],
  ): VersionDiff {
    return {
      kcs: this.diffEntities(fromKcs, toKcs, ['name', 'description', 'status', 'confidenceLevel']),
      edges: this.diffEntities(fromEdges, toEdges, ['relationship', 'weight']),
      mappings: this.diffEntities(fromMaps, toMaps, ['strength', 'blockIds']),
    };
  }

  private diffEntities<T extends { id: string }>(
    from: T[],
    to: T[],
    compareFields: string[],
  ): {
    added: T[];
    removed: T[];
    modified: Array<{ id: string; name?: string; changes: Array<{ field: string; from: unknown; to: unknown }> }>;
  } {
    const fromMap = new Map(from.map((e) => [e.id, e]));
    const toMap = new Map(to.map((e) => [e.id, e]));

    const added: T[] = [];
    const removed: T[] = [];
    const modified: Array<{ id: string; name?: string; changes: Array<{ field: string; from: unknown; to: unknown }> }> = [];

    // Find added (in "to" but not in "from")
    for (const [id, entity] of toMap) {
      if (!fromMap.has(id)) added.push(entity);
    }

    // Find removed (in "from" but not in "to")
    for (const [id, entity] of fromMap) {
      if (!toMap.has(id)) removed.push(entity);
    }

    // Find modified (in both, with field changes)
    for (const [id, fromEntity] of fromMap) {
      const toEntity = toMap.get(id);
      if (!toEntity) continue;

      const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
      for (const field of compareFields) {
        const fromVal = (fromEntity as any)[field];
        const toVal = (toEntity as any)[field];
        if (JSON.stringify(fromVal) !== JSON.stringify(toVal)) {
          changes.push({ field, from: fromVal, to: toVal });
        }
      }

      if (changes.length > 0) {
        modified.push({
          id,
          name: (toEntity as any).name,
          changes,
        });
      }
    }

    return { added, removed, modified };
  }

  // ─── Capture Current State ────────────────────────────────

  private async captureKcs(courseId: string): Promise<KcSnapshot[]> {
    const kcs = await this.prisma.proposedKC.findMany({
      where: { courseId },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        confidenceLevel: true,
        createdBy: true,
        relatedToKCId: true,
        evidence: true,
        pageIds: true,
      },
    });
    return kcs.map((kc) => ({
      id: kc.id,
      name: kc.name,
      description: kc.description,
      status: kc.status,
      confidenceLevel: kc.confidenceLevel,
      createdBy: kc.createdBy,
      relatedToKCId: kc.relatedToKCId,
      evidence: kc.evidence,
      pageIds: kc.pageIds,
    }));
  }

  private async captureEdges(courseId: string): Promise<EdgeSnapshot[]> {
    const edges = await this.prisma.kcEdge.findMany({
      where: { courseId },
      select: {
        id: true,
        fromKcId: true,
        toKcId: true,
        relationship: true,
        weight: true,
        createdBy: true,
      },
    });
    return edges;
  }

  private async captureMappings(courseId: string): Promise<MappingSnapshot[]> {
    const maps = await this.prisma.kcContentMapping.findMany({
      where: { courseId },
      select: {
        id: true,
        kcId: true,
        pageId: true,
        strength: true,
        blockIds: true,
        createdBy: true,
      },
    });
    return maps;
  }

  // ─── Access Control ───────────────────────────────────────

  private async verifyCourseAccess(courseId: string, userId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.teacherId !== userId) {
      throw new ForbiddenException('Only the course teacher can access version history');
    }
  }
}
