import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Strip / escape backslash-x sequences that aren't valid 2-digit hex,
 * which Postgres' JSON/JSONB lexer parses as broken byte escapes and
 * rejects with "unexpected end of hex escape". The browser side can
 * accidentally produce these in element selectors / page URLs / element
 * text (e.g. TipTap ProseMirror serializes some attrs with literal \x
 * fragments). Replaces the leading backslash with a doubled backslash
 * so the literal text survives, no data is lost.
 */
function sanitizeForPostgresJson(value: string | null | undefined): string | null {
  if (value == null) return null;
  // Match \x NOT followed by exactly 2 hex digits.
  return value.replace(/\\x(?![0-9a-fA-F]{2})/g, '\\\\x');
}

function isPostgresHexEscapeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /unexpected end of hex escape/i.test(msg);
}
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
  private readonly logger = new Logger(LogsService.name);
  constructor(private readonly prisma: PrismaService) {}
  private static readonly MAX_REPLAY_BIOMETRIC_FRAMES = 50000;

  // ─── Batch Inserts ──────────────────────────────────────

  async batchCursor(dto: CreateCursorBatchDto) {
    this.validateBatch(dto.sessionId, dto.userId);
    const data = dto.events.map((e) => ({
      sessionId: dto.sessionId,
      userId: dto.userId,
      x: e.x,
      y: e.y,
      pageUrl: sanitizeForPostgresJson(e.pageUrl) ?? '',
      elementTarget: sanitizeForPostgresJson(e.elementTarget),
      timestamp: BigInt(e.timestamp),
      batchId: e.batchId,
    }));
    try {
      const result = await this.prisma.cursor_logs.createMany({
        data,
        skipDuplicates: true,
      });
      return { success: true, count: result.count };
    } catch (error: unknown) {
      if (isPostgresHexEscapeError(error)) {
        this.logger.warn(
          `Dropped ${data.length} cursor logs for session ${dto.sessionId} — payload contained an invalid byte escape`,
        );
        return { success: true, count: 0, dropped: data.length };
      }
      throw new InternalServerErrorException(
        `Failed to insert cursor logs: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async batchClicks(dto: CreateClickBatchDto) {
    this.validateBatch(dto.sessionId, dto.userId);
    // Pre-sanitize string fields. The browser occasionally produces
    // literal "\x" fragments inside element selectors / page URLs
    // (e.g. from TipTap's ProseMirror DOM serialization) which
    // Postgres' JSON lexer rejects as a malformed byte escape.
    const data = dto.events.map((e) => ({
      sessionId: dto.sessionId,
      userId: dto.userId,
      x: e.x,
      y: e.y,
      pageUrl: sanitizeForPostgresJson(e.pageUrl) ?? '',
      elementSelector: sanitizeForPostgresJson(e.elementSelector) ?? '',
      elementText: sanitizeForPostgresJson(e.elementText),
      timestamp: BigInt(e.timestamp),
    }));
    try {
      const result = await this.prisma.click_logs.createMany({
        data,
        skipDuplicates: true,
      });
      return { success: true, count: result.count };
    } catch (error: unknown) {
      // If Postgres STILL rejects the payload with the hex-escape
      // parser error (something else in the data slipped past the
      // sanitizer, or we hit a different malformed byte), drop the
      // batch and return success so the client buffer doesn't get
      // permanently stuck retrying the same poisoned payload every
      // 30 seconds forever. We log the count + first selector so
      // we can investigate without the storm of 500s.
      if (isPostgresHexEscapeError(error)) {
        this.logger.warn(
          `Dropped ${data.length} click logs for session ${dto.sessionId} — payload contained an invalid byte escape Postgres couldn't parse (preview: "${data[0]?.elementSelector?.slice(0, 80) ?? ''}")`,
        );
        return { success: true, count: 0, dropped: data.length };
      }
      throw new InternalServerErrorException(
        `Failed to insert click logs: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async batchScroll(dto: CreateScrollBatchDto) {
    this.validateBatch(dto.sessionId, dto.userId);
    const data = dto.events.map((e) => ({
      sessionId: dto.sessionId,
      userId: dto.userId,
      scrollY: e.scrollY,
      scrollPercent: e.scrollPercent,
      pageUrl: sanitizeForPostgresJson(e.pageUrl) ?? '',
      timestamp: BigInt(e.timestamp),
    }));
    try {
      const result = await this.prisma.scroll_logs.createMany({
        data,
        skipDuplicates: true,
      });
      return { success: true, count: result.count };
    } catch (error: unknown) {
      if (isPostgresHexEscapeError(error)) {
        this.logger.warn(
          `Dropped ${data.length} scroll logs for session ${dto.sessionId} — invalid byte escape in payload`,
        );
        return { success: true, count: 0, dropped: data.length };
      }
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
    const data = dto.events.map((e) => ({
      sessionId: dto.sessionId,
      userId: dto.userId,
      visibleState: e.visibleState,
      pageUrl: sanitizeForPostgresJson(e.pageUrl) ?? '',
      timestamp: BigInt(e.timestamp),
      hiddenDurationMs: e.hiddenDurationMs,
    }));
    try {
      const result = await this.prisma.visibility_logs.createMany({
        data,
        skipDuplicates: true,
      });
      return { success: true, count: result.count };
    } catch (error: unknown) {
      if (isPostgresHexEscapeError(error)) {
        this.logger.warn(
          `Dropped ${data.length} visibility logs for session ${dto.sessionId} — invalid byte escape in payload`,
        );
        return { success: true, count: 0, dropped: data.length };
      }
      throw new InternalServerErrorException(
        `Failed to insert visibility logs: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async batchClipboard(dto: CreateClipboardBatchDto) {
    this.validateBatch(dto.sessionId, dto.userId);
    const data = dto.events.map((e) => ({
      sessionId: dto.sessionId,
      userId: dto.userId,
      action: e.action,
      textLength: e.textLength,
      sourceElement: sanitizeForPostgresJson(e.sourceElement),
      pageUrl: sanitizeForPostgresJson(e.pageUrl) ?? '',
      timestamp: BigInt(e.timestamp),
    }));
    try {
      const result = await this.prisma.clipboard_logs.createMany({
        data,
        skipDuplicates: true,
      });
      return { success: true, count: result.count };
    } catch (error: unknown) {
      if (isPostgresHexEscapeError(error)) {
        this.logger.warn(
          `Dropped ${data.length} clipboard logs for session ${dto.sessionId} — invalid byte escape in payload`,
        );
        return { success: true, count: 0, dropped: data.length };
      }
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
          html: event.html ?? null,
          screenshotDataUrl: event.screenshotDataUrl ?? null,
          width: event.width,
          height: event.height,
          scrollX: event.scrollX,
          scrollY: event.scrollY,
          capturedAt: BigInt(event.capturedAt),
          trigger: event.trigger,
          // Defensive: only persist a well-formed array. Anything else
          // (string, object, undefined) becomes DB NULL via the Prisma
          // sentinel so a malformed client payload can never block a
          // snapshot insert.
          aois: Array.isArray(event.aois)
            ? (event.aois as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          // Same JsonNull coercion as `aois`: only a well-formed array
          // is persisted; anything else (legacy client missing the
          // capture, malformed payload) lands as DB NULL.
          scrollHosts: Array.isArray(event.scrollHosts)
            ? (event.scrollHosts as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          // PDF semantic anchors. Optional everywhere — pages without
          // a PdfReader mounted simply omit these.
          pdfCurrentPage:
            typeof event.pdfCurrentPage === 'number' && Number.isFinite(event.pdfCurrentPage)
              ? Math.max(0, Math.floor(event.pdfCurrentPage))
              : null,
          pdfTotalPages:
            typeof event.pdfTotalPages === 'number' && Number.isFinite(event.pdfTotalPages)
              ? Math.max(0, Math.floor(event.pdfTotalPages))
              : null,
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

  async getSessionReplayData(sessionId: string, options?: { includeSnapshots?: boolean }) {
    const includeSnapshots = options?.includeSnapshots ?? true;
    const snapshotCountPromise = this.prisma.sessionReplaySnapshot.count({
      where: { sessionId },
    });
    const snapshotsPromise = includeSnapshots
      ? this.prisma.sessionReplaySnapshot.findMany({
          where: { sessionId },
          orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
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
            aois: true,
            scrollHosts: true,
            pdfCurrentPage: true,
            pdfTotalPages: true,
          },
        })
      : Promise.resolve([]);
    // Need session for the dialogue_message time-window join — fetch
    // it first so we have userId + start/end. The other queries
    // still run in parallel below.
    const session = await this.prisma.studentSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        courseId: true,
        startedAt: true,
        endedAt: true,
        durationSecs: true,
      },
    });

    // Padded time window used by both the dialogue and chatbot
    // message queries. The unpadded `[startedAt, endedAt]` bound
    // drops turns that happen in the moments immediately before the
    // first captured sample (e.g. the student opens the chatbot, the
    // session row isn't written until the first activity event a
    // second later) or after the session is flagged ended (the close
    // handler runs before the very last assistant reply lands). 5 min
    // either side is generous enough to catch real edges without
    // pulling in a neighbouring session.
    //
    // For sessions still in progress (`endedAt = null`) we use NOW as
    // the right edge — without this, in-progress sessions would lose
    // every dialogue turn.
    const MESSAGE_WINDOW_PAD_MS = 5 * 60 * 1000;
    const paddedWindowStart = session
      ? new Date(session.startedAt.getTime() - MESSAGE_WINDOW_PAD_MS)
      : null;
    const paddedWindowEnd = session
      ? new Date((session.endedAt ?? new Date()).getTime() + MESSAGE_WINDOW_PAD_MS)
      : null;

    const [
      syncAnchor,
      snapshotCount,
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
      // New for intervention + chat post-analysis:
      activityLogs,
      efDetections,
      dialogueMessages,
      chatbotMessages,
      // Lightweight interaction logs surfaced for CSV export. The
      // Replay tab itself doesn't render these yet — exporter only.
      keystrokeLogs,
      cursorLogs,
      clipboardLogs,
      visibilityLogs,
    ] = await Promise.all([
      this.prisma.session_sync_anchors.findUnique({
        where: { sessionId },
      }),
      snapshotCountPromise,
      snapshotsPromise,
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
        take: LogsService.MAX_REPLAY_BIOMETRIC_FRAMES,
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
        take: LogsService.MAX_REPLAY_BIOMETRIC_FRAMES,
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
      // All activity_log rows for this session — drives the new
      // unified timeline track in the Replay tab (intervention
      // start/view/complete, module navigation, chatbot turn
      // markers, etc.). Includes metadata so per-event detail
      // (latencyMs, score, stepNumber...) can be rendered in
      // tooltips.
      this.prisma.activityLog.findMany({
        where: { sessionId },
        orderBy: { occurredAt: 'asc' },
        select: {
          id: true,
          action: true,
          occurredAt: true,
          courseId: true,
          moduleId: true,
          moduleItemId: true,
          interventionId: true,
          attemptId: true,
          dialogueSessionId: true,
          metadata: true,
        },
      }),
      // EF text-mining detections for this session — overlays
      // construct labels (procrastination / metacognition /
      // off-task / etc.) on the replay timeline.
      this.prisma.efDetection.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          messageId: true,
          constructKey: true,
          label: true,
          confidence: true,
          severity: true,
          rationale: true,
          createdAt: true,
        },
      }),
      // Dialogue messages — time-window join by student id.
      // Dialogue sessions persist across login boundaries (one
      // DialogueSession can span many StudentSessions), so a join
      // on session.id isn't enough. The padded window catches edge
      // turns that arrive seconds before the first sample or after
      // the session is flagged ended.
      // Stable secondary sort (id) so same-ms turns keep a
      // deterministic order across reloads.
      session && paddedWindowStart && paddedWindowEnd
        ? this.prisma.dialogueMessage.findMany({
            where: {
              createdAt: { gte: paddedWindowStart, lte: paddedWindowEnd },
              session: { studentId: session.userId },
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              sessionId: true,
              role: true,
              content: true,
              tokenUsage: true,
              createdAt: true,
            },
          })
        : Promise.resolve([] as never[]),
      // Floating/docked chatbot history. The primary anchor is
      // `studentSessionId === sessionId`, but turns can carry a
      // missing/mismatched session id when the chatbot was opened
      // before the session row was written, or after a tab
      // re-init that picked a new session. So we union with a
      // student+time-window fallback (same window the dialogue
      // query uses). The OR'd query naturally de-duplicates: if a
      // row matches both clauses it appears once. Stable secondary
      // sort matches the dialogue query so same-ms turns are
      // deterministic.
      this.prisma.chatbotMessage.findMany({
        where:
          session && paddedWindowStart && paddedWindowEnd
            ? {
                OR: [
                  { studentSessionId: sessionId },
                  {
                    studentSession: { userId: session.userId },
                    createdAt: { gte: paddedWindowStart, lte: paddedWindowEnd },
                  },
                ],
              }
            : { studentSessionId: sessionId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          studentSessionId: true,
          role: true,
          content: true,
          contextSource: true,
          selectedText: true,
          suggestedStrategy: true,
          promptTokens: true,
          completionTokens: true,
          model: true,
          moduleItemId: true,
          createdAt: true,
        },
      }),
      // Keystroke aggregates per field (count, pause, WPM). Note:
      // these are summary rows, not raw key events — the platform
      // does not store individual key presses by design.
      this.prisma.keystroke_logs.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'asc' },
      }),
      // Mouse-move trajectories. Can be large on long sessions; the
      // payload is still bounded by the buffered batch size on the
      // client, so we don't impose an extra cap here.
      this.prisma.cursor_logs.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'asc' },
      }),
      // Copy/paste/cut events.
      this.prisma.clipboard_logs.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'asc' },
      }),
      // Tab visibility transitions — visible/hidden with optional
      // duration spent in the previous state.
      this.prisma.visibility_logs.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'asc' },
      }),
    ]);

    // Intervention review payload. The per-intervention details
    // (LLM-generated questions, student answers, graded results,
    // score) live on `LearningIntervention.sessionData` — but
    // `LearningIntervention` isn't anchored to a student session row
    // by FK, only via the activity_log `interventionId` column. So
    // first collect the unique intervention ids referenced by this
    // session's activity logs, then hydrate them in one query.
    const interventionIds = Array.from(
      new Set(
        activityLogs.map((log) => log.interventionId).filter((id): id is string => Boolean(id)),
      ),
    );
    const interventions = interventionIds.length
      ? await this.prisma.learningIntervention.findMany({
          where: { id: { in: interventionIds } },
          select: {
            id: true,
            type: true,
            status: true,
            selectedText: true,
            sessionData: true,
            completedAt: true,
            createdAt: true,
            updatedAt: true,
            contentId: true,
            courseId: true,
            pageType: true,
          },
        })
      : [];

    // Hydrate assessment attempt records so the replay panel and CSV
    // exporter can show question text, selected answers, and scores.
    const attemptIds = Array.from(
      new Set(activityLogs.map((log) => log.attemptId).filter((id): id is string => Boolean(id))),
    );
    const assessmentAttempts = attemptIds.length
      ? await this.prisma.attempt.findMany({
          where: { id: { in: attemptIds } },
          select: {
            id: true,
            assessmentId: true,
            questionId: true,
            status: true,
            selectedOptionIds: true,
            submittedAt: true,
            currentScore: true,
            autoFeedback: true,
            question: {
              select: {
                id: true,
                prompt: true,
                type: true,
                maxScore: true,
                options: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' as const },
        })
      : [];

    return {
      session,
      snapshotCount,
      snapshotsSampled: false,
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
        // Per-source message counts so the Replay tab's Coverage
        // panel can flag missing turns. `chatbotSessionAnchored` is
        // the count that would have been returned by the old
        // session_id-only query; `chatbotFromFallback` is the extra
        // rows recovered by the student+time-window union (these are
        // messages whose session_id didn't match but belonged to the
        // same student within the padded window). A non-zero fallback
        // count is a signal that the chatbot's session-id wiring
        // dropped turns and is worth investigating.
        messageCounts: {
          dialogueFetched: dialogueMessages.length,
          chatbotFetched: chatbotMessages.length,
          chatbotSessionAnchored: chatbotMessages.filter((m) => m.studentSessionId === sessionId)
            .length,
          chatbotFromFallback: chatbotMessages.filter((m) => m.studentSessionId !== sessionId)
            .length,
          messageWindowStartIso: paddedWindowStart?.toISOString() ?? null,
          messageWindowEndIso: paddedWindowEnd?.toISOString() ?? null,
        },
      },
      // New timeline tracks for the Replay tab — intervention activity,
      // text-mining detections, dialogue + chatbot turns.
      activityLogs: activityLogs.map((log) => ({
        ...log,
        occurredAt: log.occurredAt.toISOString(),
      })),
      efDetections: efDetections.map((d) => ({
        ...d,
        createdAt: d.createdAt.toISOString(),
      })),
      dialogueMessages: dialogueMessages.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
      })),
      chatbotMessages: chatbotMessages.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
      })),
      keystrokeLogs: keystrokeLogs.map((log) => ({
        ...log,
        timestamp: Number(log.timestamp),
      })),
      cursorLogs: cursorLogs.map((log) => ({
        ...log,
        timestamp: Number(log.timestamp),
      })),
      clipboardLogs: clipboardLogs.map((log) => ({
        ...log,
        timestamp: Number(log.timestamp),
      })),
      visibilityLogs: visibilityLogs.map((log) => ({
        ...log,
        timestamp: Number(log.timestamp),
      })),
      // Per-intervention review payload. Frontend renders an
      // expandable section per intervention showing the LLM
      // questions, the student's answers, and the score (all stored
      // on sessionData). Time-ordered so the section matches the
      // chronological intervention column in the activity timeline.
      interventions: interventions
        .map((iv) => ({
          ...iv,
          createdAt: iv.createdAt.toISOString(),
          updatedAt: iv.updatedAt.toISOString(),
          completedAt: iv.completedAt?.toISOString() ?? null,
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      assessmentAttempts: assessmentAttempts.map((a) => ({
        attemptId: a.id,
        assessmentId: a.assessmentId,
        questionId: a.questionId,
        status: a.status,
        selectedOptionIds: a.selectedOptionIds,
        submittedAt: a.submittedAt?.toISOString() ?? null,
        question: {
          prompt: a.question.prompt,
          type: a.question.type,
          maxScore: a.question.maxScore,
          options: a.question.options,
        },
        score: a.currentScore ?? null,
        maxScore: a.question.maxScore,
        autoFeedback: a.autoFeedback ?? null,
      })),
    };
  }

  async getSessionReplaySnapshots(
    sessionId: string,
    options?: { cursor?: string; limit?: number; includeContent?: boolean },
  ) {
    const safeLimit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
    const includeContent = options?.includeContent ?? false;
    const rows = await this.prisma.sessionReplaySnapshot.findMany({
      where: { sessionId },
      orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
      take: safeLimit + 1,
      ...(options?.cursor
        ? {
            cursor: { id: options.cursor },
            skip: 1,
          }
        : {}),
      select: {
        id: true,
        pageUrl: true,
        ...(includeContent ? { html: true, screenshotDataUrl: true } : {}),
        width: true,
        height: true,
        scrollX: true,
        scrollY: true,
        capturedAt: true,
        trigger: true,
        aois: true,
        scrollHosts: true,
        pdfCurrentPage: true,
        pdfTotalPages: true,
      },
    });

    const hasMore = rows.length > safeLimit;
    const page = hasMore ? rows.slice(0, safeLimit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    return {
      snapshots: page.map((snapshot) => ({
        ...snapshot,
        capturedAt: Number(snapshot.capturedAt),
      })),
      nextCursor,
      hasMore,
      limit: safeLimit,
    };
  }

  async getSessionReplaySnapshotById(
    sessionId: string,
    snapshotId: string,
    options?: { includeScreenshot?: boolean },
  ) {
    const includeScreenshot = options?.includeScreenshot ?? false;
    const snapshot = await this.prisma.sessionReplaySnapshot.findFirst({
      where: { sessionId, id: snapshotId },
      select: {
        id: true,
        pageUrl: true,
        html: true,
        ...(includeScreenshot ? { screenshotDataUrl: true } : {}),
        width: true,
        height: true,
        scrollX: true,
        scrollY: true,
        capturedAt: true,
        trigger: true,
        aois: true,
        scrollHosts: true,
        pdfCurrentPage: true,
        pdfTotalPages: true,
      },
    });

    if (!snapshot) return null;

    return {
      ...snapshot,
      capturedAt: Number(snapshot.capturedAt),
    };
  }

  // ─── Helpers ────────────────────────────────────────────

  private validateBatch(sessionId: string, userId: string) {
    if (!sessionId || !userId) {
      throw new BadRequestException('sessionId and userId are required');
    }
  }
}
