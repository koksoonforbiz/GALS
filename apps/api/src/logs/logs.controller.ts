import { Controller, Post, Body, UseGuards } from '@nestjs/common';
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
import type { SyncAnchorDto } from './dto/sync-anchor.dto';

@Controller('logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('student', 'teacher')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  // ─── Batch Endpoints ──────────────────────────────────

  @Post('cursor')
  batchCursor(@Body() dto: CreateCursorBatchDto) {
    return this.logsService.batchCursor(dto);
  }

  @Post('clicks')
  batchClicks(@Body() dto: CreateClickBatchDto) {
    return this.logsService.batchClicks(dto);
  }

  @Post('scroll')
  batchScroll(@Body() dto: CreateScrollBatchDto) {
    return this.logsService.batchScroll(dto);
  }

  @Post('keystrokes')
  batchKeystrokes(@Body() dto: CreateKeystrokeBatchDto) {
    return this.logsService.batchKeystrokes(dto);
  }

  @Post('visibility')
  batchVisibility(@Body() dto: CreateVisibilityBatchDto) {
    return this.logsService.batchVisibility(dto);
  }

  @Post('clipboard')
  batchClipboard(@Body() dto: CreateClipboardBatchDto) {
    return this.logsService.batchClipboard(dto);
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
