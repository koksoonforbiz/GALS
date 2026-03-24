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

  // ─── Helpers ────────────────────────────────────────────

  private validateBatch(sessionId: string, userId: string) {
    if (!sessionId || !userId) {
      throw new BadRequestException('sessionId and userId are required');
    }
  }
}
