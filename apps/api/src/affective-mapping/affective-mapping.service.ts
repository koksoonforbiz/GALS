import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MappingEngineService } from './mapping-engine.service';
import { DEFAULT_MAPPING } from '@ats/shared';
import type { MappingRuleSet } from '@ats/shared';

@Injectable()
export class AffectiveMappingService {
  private readonly logger = new Logger(AffectiveMappingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: MappingEngineService,
  ) {}

  async getConfig(courseId: string) {
    let config = await this.prisma.affectiveMappingConfig.findUnique({
      where: { courseId },
    });
    if (!config) {
      config = await this.prisma.affectiveMappingConfig.create({
        data: {
          courseId,
          rules: DEFAULT_MAPPING as any,
        },
      });
    }
    return config;
  }

  async updateConfig(
    courseId: string,
    data: {
      windowSeconds?: number;
      strideSeconds?: number;
      minFramesPerWindow?: number;
      rules?: MappingRuleSet;
    },
    updatedById: string,
  ) {
    const existing = await this.getConfig(courseId);

    await this.prisma.affectiveMappingConfigHistory.create({
      data: {
        configId: existing.id,
        version: existing.version,
        windowSeconds: existing.windowSeconds,
        strideSeconds: existing.strideSeconds,
        minFramesPerWindow: existing.minFramesPerWindow,
        rules: existing.rules as any,
        changedById: updatedById,
      },
    });

    return this.prisma.affectiveMappingConfig.update({
      where: { courseId },
      data: {
        windowSeconds: data.windowSeconds ?? existing.windowSeconds,
        strideSeconds: data.strideSeconds ?? existing.strideSeconds,
        minFramesPerWindow: data.minFramesPerWindow ?? existing.minFramesPerWindow,
        rules: data.rules ? (data.rules as any) : (existing.rules as any),
        version: existing.version + 1,
        updatedById,
      },
    });
  }

  async resetToDefaults(courseId: string, updatedById: string) {
    return this.updateConfig(
      courseId,
      {
        windowSeconds: 30,
        strideSeconds: 10,
        minFramesPerWindow: 5,
        rules: DEFAULT_MAPPING,
      },
      updatedById,
    );
  }

  async getConfigHistory(courseId: string) {
    const config = await this.getConfig(courseId);
    return this.prisma.affectiveMappingConfigHistory.findMany({
      where: { configId: config.id },
      orderBy: { version: 'desc' },
    });
  }

  async getWindows(filters: {
    sessionId?: string;
    courseId?: string;
    from?: string;
    to?: string;
    configVersion?: number;
    limit?: number;
  }) {
    const where: Record<string, unknown> = {};
    if (filters.sessionId) where.sessionId = filters.sessionId;
    if (filters.courseId) where.courseId = filters.courseId;
    if (filters.configVersion) where.configVersion = filters.configVersion;
    if (filters.from || filters.to) {
      where.windowStartWallMs = {};
      if (filters.from) (where.windowStartWallMs as any).gte = BigInt(filters.from);
      if (filters.to) (where.windowStartWallMs as any).lte = BigInt(filters.to);
    }

    return this.prisma.affectiveStateWindow.findMany({
      where,
      orderBy: { windowStartWallMs: 'asc' },
      take: Math.min(filters.limit ?? 1000, 5000),
    });
  }

  async getSessionSummary(sessionId: string) {
    const windows = await this.prisma.affectiveStateWindow.findMany({
      where: { sessionId },
      orderBy: { windowStartWallMs: 'asc' },
    });

    if (windows.length === 0) return { totalWindows: 0, states: {} };

    const n = windows.length;
    const meanEngagement = windows.reduce((s, w) => s + w.engagement, 0) / n;
    const meanBoredom = windows.reduce((s, w) => s + w.boredom, 0) / n;
    const meanConfusion = windows.reduce((s, w) => s + w.confusion, 0) / n;
    const meanFrustration = windows.reduce((s, w) => s + w.frustration, 0) / n;

    const dominantCounts: Record<string, number> = {};
    for (const w of windows) {
      dominantCounts[w.dominantState] = (dominantCounts[w.dominantState] ?? 0) + 1;
    }

    return {
      totalWindows: n,
      means: {
        engagement: Math.round(meanEngagement * 1000) / 1000,
        boredom: Math.round(meanBoredom * 1000) / 1000,
        confusion: Math.round(meanConfusion * 1000) / 1000,
        frustration: Math.round(meanFrustration * 1000) / 1000,
      },
      dominantCounts,
      timeInState: Object.fromEntries(
        Object.entries(dominantCounts).map(([k, v]) => [k, Math.round((v / n) * 100)]),
      ),
    };
  }

  async getCourseOverview(courseId: string) {
    const students = await this.prisma.user.findMany({
      where: {
        enrollments: { some: { courseId, status: 'ACTIVE' } },
      },
      select: { id: true, name: true },
    });

    const results = await Promise.all(
      students.map(async (student) => {
        const windows = await this.prisma.affectiveStateWindow.findMany({
          where: { userId: student.id, courseId },
        });

        const n = windows.length || 1;
        const dominantCounts: Record<string, number> = {};
        for (const w of windows) {
          dominantCounts[w.dominantState] = (dominantCounts[w.dominantState] ?? 0) + 1;
        }

        return {
          studentId: student.id,
          studentName: student.name,
          totalWindows: windows.length,
          pctEngagement: Math.round(((dominantCounts['engagement'] ?? 0) / n) * 100),
          pctBoredom: Math.round(((dominantCounts['boredom'] ?? 0) / n) * 100),
          pctConfusion: Math.round(((dominantCounts['confusion'] ?? 0) / n) * 100),
          pctFrustration: Math.round(((dominantCounts['frustration'] ?? 0) / n) * 100),
        };
      }),
    );

    return results;
  }

  async preview(
    courseId: string,
    sessionId: string,
    rules: MappingRuleSet,
    windowSeconds: number,
    strideSeconds: number,
    minFramesPerWindow: number,
  ) {
    const frames = await this.prisma.emotionFrame.findMany({
      where: { sessionId, courseId },
      orderBy: { frameWallMs: 'asc' },
    });

    if (frames.length === 0) return [];

    const startMs = Number(frames[0]!.frameWallMs);
    const endMs = Number(frames[frames.length - 1]!.frameWallMs);
    const windowMs = windowSeconds * 1000;
    const strideMs = strideSeconds * 1000;

    const results: Array<{
      windowStartWallMs: number;
      windowEndWallMs: number;
      engagement: number;
      boredom: number;
      confusion: number;
      frustration: number;
      dominantState: string;
    }> = [];

    for (let wStart = startMs; wStart + windowMs <= endMs + strideMs; wStart += strideMs) {
      const wEnd = wStart + windowMs;
      const windowFrames = frames.filter((f) => {
        const t = Number(f.frameWallMs);
        return t >= wStart && t < wEnd;
      });

      const result = this.engine.computeWindow(windowFrames, rules, minFramesPerWindow);
      if (result) {
        results.push({
          windowStartWallMs: wStart,
          windowEndWallMs: wEnd,
          engagement: result.engagement,
          boredom: result.boredom,
          confusion: result.confusion,
          frustration: result.frustration,
          dominantState: result.dominantState,
        });
      }
    }

    return results;
  }
}
