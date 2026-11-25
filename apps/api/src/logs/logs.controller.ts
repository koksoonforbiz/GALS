import { TelemetryRateGuard } from '../common/telemetry-rate.guard';
import { SkipThrottle } from '@nestjs/throttler';
import { Controller, Post, Body, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { LogsService } from './logs.service';
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

@Controller('logs')
// Learner telemetry: per-user budget instead of the per-IP global limit.
@SkipThrottle()
@UseGuards(JwtAuthGuard, RolesGuard, TelemetryRateGuard)
@Roles('student', 'teacher')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  // ─── Batch Endpoints ──────────────────────────────────

  @Post('cursor')
  async batchCursor(@Body() dto: CreateCursorBatchDto, @Request() req: { user: { id: string } }) {
    await this.logsService.noteOverflow('cursor_logs', own(dto, req));
    return this.logsService.batchCursor(dto);
  }

  @Post('clicks')
  async batchClicks(@Body() dto: CreateClickBatchDto, @Request() req: { user: { id: string } }) {
    await this.logsService.noteOverflow('click_logs', own(dto, req));
    return this.logsService.batchClicks(dto);
  }

  @Post('scroll')
  async batchScroll(@Body() dto: CreateScrollBatchDto, @Request() req: { user: { id: string } }) {
    await this.logsService.noteOverflow('scroll_logs', own(dto, req));
    return this.logsService.batchScroll(dto);
  }

  @Post('keystrokes')
  async batchKeystrokes(
    @Body() dto: CreateKeystrokeBatchDto,
    @Request() req: { user: { id: string } },
  ) {
    await this.logsService.noteOverflow('keystroke_logs', own(dto, req));
    return this.logsService.batchKeystrokes(dto);
  }

  @Post('visibility')
  async batchVisibility(
    @Body() dto: CreateVisibilityBatchDto,
    @Request() req: { user: { id: string } },
  ) {
    await this.logsService.noteOverflow('visibility_logs', own(dto, req));
    return this.logsService.batchVisibility(dto);
  }

  @Post('clipboard')
  async batchClipboard(
    @Body() dto: CreateClipboardBatchDto,
    @Request() req: { user: { id: string } },
  ) {
    await this.logsService.noteOverflow('clipboard_logs', own(dto, req));
    return this.logsService.batchClipboard(dto);
  }

  @Post('replay-snapshots')
  batchReplaySnapshots(@Body() dto: CreateReplaySnapshotBatchDto) {
    return this.logsService.batchReplaySnapshots(dto);
  }

  // ─── Single-Row Endpoints ─────────────────────────────

  @Post('viewport')
  createViewport(@Body() dto: CreateViewportLogDto) {
    return this.logsService.createViewportLog(dto);
  }

  @Post('performance')
  createPerformance(@Body() dto: CreatePerformanceLogDto) {
    return this.logsService.createPerformanceLog(dto);
  }

  @Post('errors')
  createError(@Body() dto: CreateErrorLogDto) {
    return this.logsService.createErrorLog(dto);
  }

  // ─── Sync Anchor ──────────────────────────────────────

  @Post('sync-anchor')
  upsertSyncAnchor(@Body() dto: SyncAnchorDto) {
    return this.logsService.upsertSyncAnchor(dto);
  }
}

/**
 * Stream rows are filed under the userId in the body: it must be the signed-in
 * user. This refuses spoofing, and rows a different login left queued in this
 * browser (the client then drops them rather than mis-attribute them).
 */
function own<T extends { userId: string }>(dto: T, req: { user: { id: string } }): T {
  if (dto.userId !== req.user.id)
    throw new ForbiddenException('userId does not match the signed-in user');
  return dto;
}
