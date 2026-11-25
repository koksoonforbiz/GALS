import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BlobService } from '../blob/blob.service';
import { ActivityAction } from './activity-action.enum';
import { initiatorFromMeta, ledgerFromTrigger, writeLedger } from './intervention-ledger';

export interface RecordEventParams {
  sessionId: string;
  userId: string;
  action: ActivityAction;
  occurredAt?: Date;

  courseId?: string | null;
  moduleId?: string | null;
  moduleItemId?: string | null;
  assessmentId?: string | null;
  attemptId?: string | null;
  questionId?: string | null;
  dialogueSessionId?: string | null;
  interventionId?: string | null;

  metadata?: Record<string, unknown> | null;

  // Envelope (Prompt B, B2)
  clientEventId?: string | null;
  clientSeq?: number | null;
  tabId?: string | null;
  durationMs?: number | null;
  sourceChannel?: string | null;
  appBuild?: string | null;
  consentScope?: string | null;
  slideKey?: string | null;
  objectId?: string | null;
  contentVersion?: string | null;
}

/** Data that reached the API but was not stored (see IngestIssue). */
export interface IngestIssueParams {
  stream: string;
  kind: 'rejected' | 'insert_failed' | 'dropped_escape' | 'client_overflow' | 'duplicate';
  sessionId?: string | null;
  userId?: string | null;
  action?: string | null;
  reason: string;
  eventCount: number;
  rawBytes?: number | null;
  /** The events that were not stored, kept as received. */
  payload?: unknown[];
}

const PAYLOAD_MAX = 1_000_000;

/** The events as JSON text (bigint as number; a TEXT column takes any escape), at most 1 MB. */
export function payloadText(events: unknown[] | undefined): string | null {
  if (!events || events.length === 0) return null;
  try {
    const t = JSON.stringify(events, (_k, v: unknown) => (typeof v === 'bigint' ? Number(v) : v));
    return t.length > PAYLOAD_MAX ? t.slice(0, PAYLOAD_MAX) : t;
  } catch {
    return null;
  }
}

/** The API build (git SHA), set at image build time; stamped on rows the client didn't stamp. */
export const APP_BUILD = process.env.APP_BUILD || null;

/**
 * Every INTERVENTION_TRIGGERED row says who started it (Prompt B, P5;
 * CAP-01): learner-launched strategy or system suggestion.
 */
function withInitiator<
  T extends { action: ActivityAction; metadata?: Record<string, unknown> | null },
>(e: T): T {
  if (e.action !== ActivityAction.INTERVENTION_TRIGGERED) return e;
  const meta = e.metadata ?? {};
  if (meta.initiator === 'learner' || meta.initiator === 'system') return e;
  return { ...e, metadata: { ...meta, initiator: initiatorFromMeta(meta) } };
}

/** Prisma errors that mean "the database is not reachable": retry later. */
const UNAVAILABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);
export function isDbUnavailable(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientRustPanicError) return true;
  return err instanceof Prisma.PrismaClientKnownRequestError && UNAVAILABLE_CODES.has(err.code);
}

/** An error class or code, never the message (Prisma messages can quote values). */
export function errorReason(err: unknown): string {
  if (err instanceof Prisma.PrismaClientKnownRequestError) return `prisma:${err.code}`;
  if (err instanceof Prisma.PrismaClientValidationError) return 'prisma:validation';
  if (err instanceof Prisma.PrismaClientUnknownRequestError) return 'prisma:unknown';
  return `error:${(err as Error)?.constructor?.name ?? 'unknown'}`;
}

@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blob: BlobService,
  ) {}

  /**
   * Record a single activity event. Safe to call fire-and-forget.
   * Errors are caught and logged — they must never break the calling flow.
   */
  async record(params: RecordEventParams): Promise<void> {
    params = withInitiator(params);
    try {
      await this.prisma.activityLog.create({
        data: {
          sessionId: params.sessionId,
          userId: params.userId,
          action: params.action as any,
          occurredAt: params.occurredAt ?? new Date(),
          courseId: params.courseId ?? null,
          moduleId: params.moduleId ?? null,
          moduleItemId: params.moduleItemId ?? null,
          assessmentId: params.assessmentId ?? null,
          attemptId: params.attemptId ?? null,
          questionId: params.questionId ?? null,
          dialogueSessionId: params.dialogueSessionId ?? null,
          interventionId: params.interventionId ?? null,
          metadata: (params.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
      });
      if (params.action === ActivityAction.INTERVENTION_TRIGGERED) {
        await writeLedger(this.prisma, [ledgerFromTrigger(params)]);
      }
    } catch (err: unknown) {
      const error = err as Error;
      this.logger.error(`Failed to record activity log: ${error.message}`, error.stack);
    }
  }

  /**
   * Batch insert a list of events (used by the frontend batch endpoint).
   *
   * No silent loss (CAP-40): when the database is unreachable this throws
   * 503, so the client keeps the batch and retries. When a row is refused
   * (one bad row fails the whole createMany), the rows are inserted one by
   * one and every refused row is recorded in `ingest_issues`.
   *
   * Idempotent (B3): a row whose (sessionId, clientEventId) is already stored
   * is skipped and counted as a duplicate, so retries never double a row.
   */
  async recordBatch(
    events: Array<RecordEventParams>,
  ): Promise<{ inserted: number; failed: number; duplicates: number }> {
    if (events.length === 0) return { inserted: 0, failed: 0, duplicates: 0 };
    events = events.map(withInitiator);
    const rows = events.map((e) => ({
      sessionId: e.sessionId,
      userId: e.userId,
      action: e.action as any,
      occurredAt: e.occurredAt ?? new Date(),
      courseId: e.courseId ?? null,
      moduleId: e.moduleId ?? null,
      moduleItemId: e.moduleItemId ?? null,
      assessmentId: e.assessmentId ?? null,
      attemptId: e.attemptId ?? null,
      questionId: e.questionId ?? null,
      dialogueSessionId: e.dialogueSessionId ?? null,
      interventionId: e.interventionId ?? null,
      metadata: (e.metadata as Prisma.InputJsonValue) ?? Prisma.DbNull,
      clientEventId: e.clientEventId ?? null,
      clientSeq: e.clientSeq ?? null,
      tabId: e.tabId ?? null,
      durationMs: e.durationMs ?? null,
      sourceChannel: e.sourceChannel ?? null,
      appBuild: e.appBuild ?? APP_BUILD,
      consentScope: e.consentScope ?? null,
      slideKey: e.slideKey ?? null,
      objectId: e.objectId ?? null,
      contentVersion: e.contentVersion ?? null,
    }));
    try {
      const r = await this.prisma.activityLog.createMany({ data: rows, skipDuplicates: true });
      return { inserted: r.count, failed: 0, duplicates: rows.length - r.count };
    } catch (err: unknown) {
      if (isDbUnavailable(err)) {
        this.logger.error(`Activity log store unavailable: ${errorReason(err)}`);
        throw new ServiceUnavailableException('Activity log store unavailable, retry later');
      }
      this.logger.warn(`Batch insert refused (${errorReason(err)}), inserting rows one by one`);
    }
    let inserted = 0;
    let duplicates = 0;
    const failures = new Map<string, IngestIssueParams>();
    for (const row of rows) {
      try {
        await this.prisma.activityLog.create({ data: row });
        inserted++;
      } catch (err: unknown) {
        // Already stored (same session + clientEventId): a retry, not a loss.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          duplicates++;
          continue;
        }
        // Unreachable before anything was stored: let the client retry all.
        if (isDbUnavailable(err) && inserted === 0) {
          throw new ServiceUnavailableException('Activity log store unavailable, retry later');
        }
        const reason = errorReason(err);
        const key = `${String(row.action)}|${reason}`;
        const f = failures.get(key);
        const kept = {
          ...row,
          metadata: (row.metadata as unknown) === Prisma.DbNull ? null : row.metadata,
        };
        if (f) {
          f.eventCount++;
          f.payload!.push(kept);
        } else
          failures.set(key, {
            stream: 'activity_log',
            kind: 'insert_failed',
            sessionId: row.sessionId,
            userId: row.userId,
            action: String(row.action),
            reason,
            eventCount: 1,
            payload: [kept],
          });
      }
    }
    if (failures.size) {
      this.logger.error(
        `Activity log: ${rows.length - inserted}/${rows.length} rows refused for session ${rows[0]!.sessionId}`,
      );
      await this.recordIngestIssues([...failures.values()]);
    }
    return { inserted, failed: rows.length - inserted - duplicates, duplicates };
  }

  /** Record data that was not stored. Never throws (it is the last resort). */
  async recordIngestIssues(issues: IngestIssueParams[]): Promise<void> {
    if (issues.length === 0) return;
    try {
      await this.prisma.ingestIssue.createMany({
        data: issues.map((i) => ({
          stream: i.stream,
          kind: i.kind,
          sessionId: i.sessionId ?? null,
          userId: i.userId ?? null,
          action: i.action ?? null,
          reason: i.reason.slice(0, 500),
          eventCount: i.eventCount,
          rawBytes: i.rawBytes ?? null,
          payload: payloadText(i.payload),
        })),
      });
    } catch (err: unknown) {
      this.logger.error(
        `Failed to record ${issues.length} ingest issue(s): ${errorReason(err)} ${JSON.stringify(
          issues.map((i) => [i.stream, i.kind, i.action, i.reason, i.eventCount]),
        )}`,
      );
    }
  }

  /** Retrieve all events for a given session, ordered by time. */
  async getSessionLogs(sessionId: string) {
    return this.prisma.activityLog.findMany({
      where: { sessionId },
      orderBy: { occurredAt: 'asc' },
    });
  }

  /** Retrieve all sessions for a student (most recent first), with live event counts. */
  async getStudentSessions(userId: string) {
    const sessions = await this.prisma.studentSession.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      include: {
        summary: true,
        _count: { select: { activityLogs: true } },
      },
    });
    const recordingStats = await this.prisma.recordingSegment.groupBy({
      by: ['sessionId'],
      where: {
        studentId: userId,
        sessionId: { in: sessions.map((session) => session.id) },
      },
      _count: { _all: true },
      _sum: { fileSizeBytes: true },
    });
    const recordingStatsBySession = new Map(
      recordingStats.map((stats) => [
        stats.sessionId,
        {
          recordingSegmentCount: stats._count._all,
          recordingBytes: stats._sum.fileSizeBytes ?? 0,
        },
      ]),
    );

    return sessions.map((s) => ({
      ...s,
      // Provide a live event count so the session list always shows the real number
      liveEventCount: s._count.activityLogs,
      recordingSegmentCount: recordingStatsBySession.get(s.id)?.recordingSegmentCount ?? 0,
      recordingBytes: recordingStatsBySession.get(s.id)?.recordingBytes ?? 0,
      _count: undefined,
    }));
  }

  /** Delete a student session and related logs/derived telemetry. */
  async deleteSession(sessionId: string) {
    const session = await this.prisma.studentSession.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
    if (!session) throw new NotFoundException('Session not found');

    const recordingSegments = await this.prisma.recordingSegment.findMany({
      where: { sessionId },
      select: { minioKey: true },
    });
    const pyfeatJobs = await this.prisma.pyfeatJob.findMany({
      where: { sessionId },
      select: { sourceMinioKey: true, resultMinioKey: true },
    });

    const blobKeys = new Set<string>();
    recordingSegments.forEach((segment) => blobKeys.add(segment.minioKey));
    pyfeatJobs.forEach((job) => {
      blobKeys.add(job.sourceMinioKey);
      if (job.resultMinioKey) blobKeys.add(job.resultMinioKey);
    });

    // Postgres is the source of truth: run the transaction first. If any
    // part of it fails, the transaction rolls back as a whole and NO blobs
    // have been touched yet — a consistent state. Deleting blobs first (the
    // old order) risked the opposite: a partially-deleted MinIO set with
    // the DB transaction never even attempted, or blobs gone while some DB
    // rows survive because one MinIO delete in the batch rejected first.
    const result = await this.prisma.$transaction(async (tx) => {
      const [
        chatbotMessages,
        cursorLogs,
        clickLogs,
        scrollLogs,
        keystrokeLogs,
        visibilityLogs,
        clipboardLogs,
        viewportLogs,
        performanceLogs,
        errorLogs,
        sessionSyncAnchors,
        modalityOffsets,
        derivedEngagement,
        derivedCognitiveLoad,
        derivedEmotionTimeline,
        derivedLearningVelocity,
        derivedAtRiskFlags,
        alignedFrames,
        efDetections,
        emotionFrames,
        affectiveStateWindows,
        replaySnapshots,
        sessionSummaries,
      ] = await Promise.all([
        tx.chatbotMessage.deleteMany({ where: { studentSessionId: sessionId } }),
        tx.cursor_logs.deleteMany({ where: { sessionId } }),
        tx.click_logs.deleteMany({ where: { sessionId } }),
        tx.scroll_logs.deleteMany({ where: { sessionId } }),
        tx.keystroke_logs.deleteMany({ where: { sessionId } }),
        tx.visibility_logs.deleteMany({ where: { sessionId } }),
        tx.clipboard_logs.deleteMany({ where: { sessionId } }),
        tx.viewport_logs.deleteMany({ where: { sessionId } }),
        tx.performance_logs.deleteMany({ where: { sessionId } }),
        tx.error_logs.deleteMany({ where: { sessionId } }),
        tx.session_sync_anchors.deleteMany({ where: { sessionId } }),
        tx.modality_offsets.deleteMany({ where: { sessionId } }),
        tx.derived_engagement.deleteMany({ where: { sessionId } }),
        tx.derived_cognitive_load.deleteMany({ where: { sessionId } }),
        tx.derived_emotion_timeline.deleteMany({ where: { sessionId } }),
        tx.derived_learning_velocity.deleteMany({ where: { sessionId } }),
        tx.derived_at_risk_flags.deleteMany({ where: { sessionId } }),
        tx.aligned_frames.deleteMany({ where: { sessionId } }),
        tx.efDetection.deleteMany({ where: { sessionId } }),
        tx.emotionFrame.deleteMany({ where: { sessionId } }),
        tx.affectiveStateWindow.deleteMany({ where: { sessionId } }),
        tx.sessionReplaySnapshot.deleteMany({ where: { sessionId } }),
        tx.sessionSummary.deleteMany({ where: { sessionId } }),
      ]);

      // Prompting course (Phase 6, decision #9): Prompt Lab runs and nudge
      // decisions logged in this session go with it, like chatbot messages.
      // (learning_events cascade via FK; lesson state and saved versions are
      // the learner's cross-session work and stay with the student.)
      const promptLabRuns = await tx.promptLabRun.deleteMany({
        where: { studentSessionId: sessionId },
      });
      const ruleNudges = await tx.ruleNudge.deleteMany({ where: { sessionId } });

      await tx.studentSession.delete({ where: { id: sessionId } });

      return {
        deleted: true,
        sessionId,
        recordingVideosDeleted: recordingSegments.length,
        blobObjectsDeleted: blobKeys.size,
        counts: {
          chatbotMessages: chatbotMessages.count,
          promptLabRuns: promptLabRuns.count,
          ruleNudges: ruleNudges.count,
          cursorLogs: cursorLogs.count,
          clickLogs: clickLogs.count,
          scrollLogs: scrollLogs.count,
          keystrokeLogs: keystrokeLogs.count,
          visibilityLogs: visibilityLogs.count,
          clipboardLogs: clipboardLogs.count,
          viewportLogs: viewportLogs.count,
          performanceLogs: performanceLogs.count,
          errorLogs: errorLogs.count,
          sessionSyncAnchors: sessionSyncAnchors.count,
          modalityOffsets: modalityOffsets.count,
          derivedEngagement: derivedEngagement.count,
          derivedCognitiveLoad: derivedCognitiveLoad.count,
          derivedEmotionTimeline: derivedEmotionTimeline.count,
          derivedLearningVelocity: derivedLearningVelocity.count,
          derivedAtRiskFlags: derivedAtRiskFlags.count,
          alignedFrames: alignedFrames.count,
          efDetections: efDetections.count,
          emotionFrames: emotionFrames.count,
          affectiveStateWindows: affectiveStateWindows.count,
          replaySnapshots: replaySnapshots.count,
          sessionSummaries: sessionSummaries.count,
        },
      };
    });

    // DB rows are already gone at this point — remaining MinIO cleanup is
    // best-effort. A leftover orphaned blob is a minor, recoverable cost;
    // it must never surface as a failure of the delete the caller already
    // got committed.
    await Promise.all(
      [...blobKeys].map((key) =>
        this.blob.delete(key).catch((err: unknown) => {
          this.logger.warn(
            `Failed to delete blob ${key} for deleted session ${sessionId}: ${(err as Error).message}`,
          );
        }),
      ),
    );

    this.logger.log(`Deleted student session ${sessionId}`);
    return result;
  }

  /** Compute a summary on the fly from raw logs (for in-progress sessions). */
  async computeLiveSummary(sessionId: string) {
    const logs = await this.prisma.activityLog.findMany({
      where: { sessionId },
      orderBy: { occurredAt: 'asc' },
    });

    if (logs.length === 0) {
      return {
        totalEvents: 0,
        totalActiveTimeSecs: 0,
        assessmentsStarted: 0,
        assessmentsSubmitted: 0,
        questionsAnswered: 0,
        questionsCorrect: 0,
        interventionsTriggered: 0,
        interventionsCompleted: 0,
        interventionBreakdown: null,
        dialogueSessionsStarted: 0,
        studentMessagesSent: 0,
        flashcardsReviewed: 0,
        moduleItemsViewed: 0,
      };
    }

    const count = (action: string) => logs.filter((l) => l.action === action).length;

    const interventionBreakdown: Record<string, number> = {};
    logs
      .filter((l) => l.action === 'INTERVENTION_TRIGGERED')
      .forEach((l) => {
        const meta = l.metadata as Record<string, string> | null;
        const type = meta?.interventionType ?? 'unknown';
        interventionBreakdown[type] = (interventionBreakdown[type] ?? 0) + 1;
      });

    let totalActiveTimeSecs = 0;
    for (let i = 1; i < logs.length; i++) {
      const gap = (logs[i]!.occurredAt.getTime() - logs[i - 1]!.occurredAt.getTime()) / 1000;
      if (gap <= 300) totalActiveTimeSecs += gap;
    }

    const questionsCorrect = logs
      .filter((l) => l.action === 'QUESTION_ANSWERED')
      .filter((l) => (l.metadata as Record<string, unknown> | null)?.isCorrect === true).length;

    return {
      totalEvents: logs.length,
      totalActiveTimeSecs: Math.round(totalActiveTimeSecs),
      assessmentsStarted: count('ASSESSMENT_STARTED'),
      assessmentsSubmitted: count('ASSESSMENT_SUBMITTED'),
      questionsAnswered: count('QUESTION_ANSWERED'),
      questionsCorrect,
      interventionsTriggered: count('INTERVENTION_TRIGGERED'),
      interventionsCompleted: count('INTERVENTION_COMPLETED'),
      interventionBreakdown:
        Object.keys(interventionBreakdown).length > 0 ? interventionBreakdown : null,
      dialogueSessionsStarted: count('DIALOGUE_SESSION_STARTED'),
      studentMessagesSent: count('DIALOGUE_MESSAGE_SENT'),
      flashcardsReviewed: count('SPACED_REP_CARD_RATED'),
      moduleItemsViewed: count('MODULE_ITEM_VIEWED'),
    };
  }
}
