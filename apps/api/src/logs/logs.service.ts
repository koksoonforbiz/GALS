import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateCursorBatchDto } from './dto/create-cursor-batch.dto';
import type { CreateClickBatchDto } from './dto/create-click-batch.dto';
import type { CreateScrollBatchDto } from './dto/create-scroll-batch.dto';
import type { CreateKeystrokeBatchDto } from './dto/create-keystroke-batch.dto';
import type { CreateVisibilityBatchDto } from './dto/create-visibility-batch.dto';
import type { CreateClipboardBatchDto } from './dto/create-clipboard-batch.dto';
import type { CreateViewportLogDto } from './dto/create-viewport-log.dto';
import type { CreatePerformanceLogDto } from './dto/create-performance-log.dto';
import type { CreateErrorLogDto } from './dto/create-error-log.dto';
import type { CreateReplaySnapshotBatchDto } from './dto/create-replay-snapshot-batch.dto';
import type { SyncAnchorDto } from './dto/sync-anchor.dto';

@Injectable()
export class LogsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Batch Inserts ──────────────────────────────────────

  async batchCursor(dto: CreateCursorBatchDto) {
    this.validateBatch(dto.sessionId, dto.userId);
    try {
      const result = await this.prisma.cursor_logs.createMany({
        data: dto.events.map((e) => ({
          sessionId: dto.sessionId,
          userId: dto.userId,
          x: e.x,
          y: e.y,
          pageUrl: e.pageUrl,
          elementTarget: e.elementTarget,
          timestamp: BigInt(e.timestamp),
          batchId: e.batchId,
        })),
        skipDuplicates: true,
      });
      return { success: true, count: result.count };
    } catch (error: unknown) {
      throw new InternalServerErrorException(
        `Failed to insert cursor logs: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async batchClicks(dto: CreateClickBatchDto) {
    this.validateBatch(dto.sessionId, dto.userId);
    try {
      const result = await this.prisma.click_logs.createMany({
        data: dto.events.map((e) => ({
          sessionId: dto.sessionId,
          userId: dto.userId,
          x: e.x,
          y: e.y,
          pageUrl: e.pageUrl,
          elementSelector: e.elementSelector,
          elementText: e.elementText,
          timestamp: BigInt(e.timestamp),
        })),
        skipDuplicates: true,
      });
      return { success: true, count: result.count };
    } catch (error: unknown) {
      throw new InternalServerErrorException(
        `Failed to insert click logs: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async batchScroll(dto: CreateScrollBatchDto) {
    this.validateBatch(dto.sessionId, dto.userId);
    try {
      const result = await this.prisma.scroll_logs.createMany({
        data: dto.events.map((e) => ({
          sessionId: dto.sessionId,
          userId: dto.userId,
          scrollY: e.scrollY,
          scrollPercent: e.scrollPercent,
          pageUrl: e.pageUrl,
          timestamp: BigInt(e.timestamp),
        })),
        skipDuplicates: true,
      });
      return { success: true, count: result.count };
    } catch (error: unknown) {
      throw new InternalServerErrorException(
        `Failed to insert scroll logs: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async batchKeystrokes(dto: CreateKeystrokeBatchDto) {
    this.validateBatch(dto.sessionId, dto.userId);
    try {
      const result = await this.prisma.keystroke_logs.createMany({
        data: dto.events.map((e) => ({
          sessionId: dto.sessionId,
          userId: dto.userId,
          fieldId: e.fieldId,
          keystrokeCount: e.keystrokeCount,
          pauseDurationMs: e.pauseDurationMs,
          typingSpeedWPM: e.typingSpeedWPM,
          timestamp: BigInt(e.timestamp),
        })),
        skipDuplicates: true,
      });
      return { success: true, count: result.count };
    } catch (error: unknown) {
      throw new InternalServerErrorException(
        `Failed to insert keystroke logs: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async batchVisibility(dto: CreateVisibilityBatchDto) {
    this.validateBatch(dto.sessionId, dto.userId);
    try {
      const result = await this.prisma.visibility_logs.createMany({
        data: dto.events.map((e) => ({
          sessionId: dto.sessionId,
          userId: dto.userId,
          visibleState: e.visibleState,
          pageUrl: e.pageUrl,
          timestamp: BigInt(e.timestamp),
          hiddenDurationMs: e.hiddenDurationMs,
        })),
        skipDuplicates: true,
      });
      return { success: true, count: result.count };
    } catch (error: unknown) {
      throw new InternalServerErrorException(
        `Failed to insert visibility logs: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async batchClipboard(dto: CreateClipboardBatchDto) {
    this.validateBatch(dto.sessionId, dto.userId);
    try {
      const result = await this.prisma.clipboard_logs.createMany({
        data: dto.events.map((e) => ({
          sessionId: dto.sessionId,
          userId: dto.userId,
          action: e.action,
          textLength: e.textLength,
          sourceElement: e.sourceElement,
          pageUrl: e.pageUrl,
          timestamp: BigInt(e.timestamp),
        })),
        skipDuplicates: true,
      });
      return { success: true, count: result.count };
    } catch (error: unknown) {
      throw new InternalServerErrorException(
        `Failed to insert clipboard logs: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async batchReplaySnapshots(dto: CreateReplaySnapshotBatchDto) {
    this.validateBatch(dto.sessionId, dto.userId);
    try {
      const result = await this.prisma.sessionReplaySnapshot.createMany({
        data: dto.events.map((event) => ({
          sessionId: dto.sessionId,
          userId: dto.userId,
          pageUrl: event.pageUrl,
          html: event.html,
          screenshotDataUrl: event.screenshotDataUrl ?? null,
          width: event.width,
          height: event.height,
          scrollX: event.scrollX,
          scrollY: event.scrollY,
          capturedAt: BigInt(event.capturedAt),
          trigger: event.trigger,
        })),
      });
      return { success: true, count: result.count };
    } catch (error: unknown) {
      throw new InternalServerErrorException(
        `Failed to insert replay snapshots: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  // ─── Single-Row Inserts ─────────────────────────────────

  async createViewportLog(dto: CreateViewportLogDto) {
    if (!dto.sessionId || !dto.userId) {
      throw new BadRequestException('sessionId and userId are required');
    }
    try {
      const record = await this.prisma.viewport_logs.create({
        data: {
          sessionId: dto.sessionId,
          userId: dto.userId,
          width: dto.width,
          height: dto.height,
          orientation: dto.orientation,
          timestamp: BigInt(dto.timestamp),
        },
      });
      return { success: true, id: record.id };
    } catch (error: unknown) {
      throw new InternalServerErrorException(
        `Failed to insert viewport log: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async createPerformanceLog(dto: CreatePerformanceLogDto) {
    if (!dto.sessionId || !dto.userId) {
      throw new BadRequestException('sessionId and userId are required');
    }
    try {
      const record = await this.prisma.performance_logs.create({
        data: {
          sessionId: dto.sessionId,
          userId: dto.userId,
          pageUrl: dto.pageUrl,
          pageLoadMs: dto.pageLoadMs,
          apiLatencyMs: dto.apiLatencyMs,
          resourceTimingsJson: dto.resourceTimingsJson as object | undefined,
          timestamp: BigInt(dto.timestamp),
        },
      });
      return { success: true, id: record.id };
    } catch (error: unknown) {
      throw new InternalServerErrorException(
        `Failed to insert performance log: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async createErrorLog(dto: CreateErrorLogDto) {
    if (!dto.sessionId || !dto.userId) {
      throw new BadRequestException('sessionId and userId are required');
    }
    try {
      const record = await this.prisma.error_logs.create({
        data: {
          sessionId: dto.sessionId,
          userId: dto.userId,
          errorMessage: dto.errorMessage,
          stack: dto.stack,
          componentName: dto.componentName,
          pageUrl: dto.pageUrl,
          timestamp: BigInt(dto.timestamp),
          errorType: dto.errorType,
        },
      });
      return { success: true, id: record.id };
    } catch (error: unknown) {
      throw new InternalServerErrorException(
        `Failed to insert error log: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  // ─── Sync Anchor ────────────────────────────────────────

  async upsertSyncAnchor(dto: SyncAnchorDto) {
    if (!dto.sessionId || !dto.userId) {
      throw new BadRequestException('sessionId and userId are required');
    }
    const serverReceiveMs = Date.now();
    try {
      await this.prisma.session_sync_anchors.upsert({
        where: { sessionId: dto.sessionId },
        update: {
          userId: dto.userId,
          wallClockMs: BigInt(dto.wallClockMs),
          monotonicMs: BigInt(dto.monotonicMs),
          serverReceiveMs: BigInt(serverReceiveMs),
          timezone: dto.timezone,
          userAgent: dto.userAgent,
        },
        create: {
          sessionId: dto.sessionId,
          userId: dto.userId,
          wallClockMs: BigInt(dto.wallClockMs),
          monotonicMs: BigInt(dto.monotonicMs),
          serverReceiveMs: BigInt(serverReceiveMs),
          timezone: dto.timezone,
          userAgent: dto.userAgent,
        },
      });
      return { success: true, serverReceiveMs };
    } catch (error: unknown) {
      throw new InternalServerErrorException(
        `Failed to upsert sync anchor: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async getSessionReplayData(sessionId: string) {
    const [
      session,
      syncAnchor,
      snapshots,
      clickLogs,
      scrollLogs,
      viewportLogs,
      gazeLogs,
      pupilLogs,
      emotionFrames,
      auResults,
      recordingSegments,
      openface3Jobs,
      pyfeatJobs,
    ] =
      await Promise.all([
        this.prisma.studentSession.findUnique({
          where: { id: sessionId },
          select: {
            id: true,
            userId: true,
            courseId: true,
            startedAt: true,
            endedAt: true,
            durationSecs: true,
          },
        }),
        this.prisma.session_sync_anchors.findUnique({
          where: { sessionId },
        }),
        this.prisma.sessionReplaySnapshot.findMany({
          where: { sessionId },
          orderBy: { capturedAt: 'asc' },
          select: {
            id: true,
            pageUrl: true,
            html: true,
            screenshotDataUrl: true,
            width: true,
            height: true,
            scrollX: true,
            scrollY: true,
            capturedAt: true,
            trigger: true,
          },
        }),
        this.prisma.click_logs.findMany({
          where: { sessionId },
          orderBy: { timestamp: 'asc' },
        }),
        this.prisma.scroll_logs.findMany({
          where: { sessionId },
          orderBy: { timestamp: 'asc' },
        }),
        this.prisma.viewport_logs.findMany({
          where: { sessionId },
          orderBy: { timestamp: 'asc' },
        }),
        this.prisma.webgazerLog.findMany({
          where: { sessionId },
          orderBy: { timestamp: 'asc' },
          select: {
            id: true,
            pageUrl: true,
            timestamp: true,
            gazeX: true,
            gazeY: true,
            confidence: true,
          },
        }),
        this.prisma.pupilSizeLog.findMany({
          where: { sessionId },
          orderBy: { timestamp: 'asc' },
          select: {
            id: true,
            timestamp: true,
            pupilDiameter: true,
          },
        }),
        this.prisma.emotionFrame.findMany({
          where: { sessionId },
          orderBy: { frameWallMs: 'asc' },
          take: 5000,
          select: {
            id: true,
            frameWallMs: true,
            frameIndex: true,
            faceDetected: true,
            dominantEmotion: true,
            dominantProbability: true,
            pHappiness: true,
            pSadness: true,
            pSurprise: true,
            pFear: true,
            pAnger: true,
            pDisgust: true,
            pContempt: true,
            pNeutral: true,
          },
        }),
        this.prisma.pyfeatAuResult.findMany({
          where: { job: { sessionId } },
          orderBy: { wallTime: 'asc' },
          take: 5000,
          select: {
            id: true,
            frameIndex: true,
            timestamp: true,
            wallTime: true,
            faceConf: true,
            au01: true,
            au02: true,
            au04: true,
            au05: true,
            au06: true,
            au07: true,
            au09: true,
            au10: true,
            au12: true,
            au14: true,
            au15: true,
            au17: true,
            au20: true,
            au23: true,
            au24: true,
            au25: true,
            au26: true,
            au28: true,
          },
        }),
        this.prisma.recordingSegment.findMany({
          where: { sessionId },
          orderBy: { startWallTime: 'asc' },
          select: {
            id: true,
            uploadStatus: true,
            pyfeatJobId: true,
            startWallTime: true,
            endWallTime: true,
            durationMs: true,
          },
        }),
        this.prisma.openface3Job.findMany({
          where: { recordingSegment: { sessionId } },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            status: true,
            errorMessage: true,
            createdAt: true,
            completedAt: true,
            recordingSegmentId: true,
          },
        }),
        this.prisma.pyfeatJob.findMany({
          where: { sessionId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            status: true,
            error: true,
            createdAt: true,
            completedAt: true,
            sourceMinioKey: true,
          },
        }),
      ]);

    return {
      session,
      syncAnchor: syncAnchor
        ? {
            ...syncAnchor,
            wallClockMs: Number(syncAnchor.wallClockMs),
            monotonicMs: Number(syncAnchor.monotonicMs),
            serverReceiveMs: Number(syncAnchor.serverReceiveMs),
          }
        : null,
      snapshots: snapshots.map((snapshot) => ({
        ...snapshot,
        capturedAt: Number(snapshot.capturedAt),
      })),
      clickLogs: clickLogs.map((log) => ({
        ...log,
        timestamp: Number(log.timestamp),
      })),
      scrollLogs: scrollLogs.map((log) => ({
        ...log,
        timestamp: Number(log.timestamp),
      })),
      viewportLogs: viewportLogs.map((log) => ({
        ...log,
        timestamp: Number(log.timestamp),
      })),
      gazeLogs: gazeLogs.map((log) => ({
        ...log,
        timestamp: log.timestamp.toISOString(),
      })),
      pupilLogs: pupilLogs.map((log) => ({
        ...log,
        timestamp: log.timestamp.toISOString(),
      })),
      emotionFrames: emotionFrames.map((frame) => ({
        ...frame,
        frameWallMs: Number(frame.frameWallMs),
      })),
      auResults: auResults.map((result) => ({
        ...result,
        wallTime: result.wallTime.toISOString(),
      })),
      diagnostics: {
        recordingSegments: recordingSegments.map((segment) => ({
          ...segment,
          startWallTime: segment.startWallTime.toISOString(),
          endWallTime: segment.endWallTime?.toISOString() ?? null,
        })),
        openface3Jobs,
        pyfeatJobs,
      },
    };
  }

  // ─── Helpers ────────────────────────────────────────────

  private validateBatch(sessionId: string, userId: string) {
    if (!sessionId || !userId) {
      throw new BadRequestException('sessionId and userId are required');
    }
  }
}
