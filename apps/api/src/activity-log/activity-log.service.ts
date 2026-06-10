import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BlobService } from '../blob/blob.service';
import { ActivityAction } from './activity-action.enum';

export interface RecordEventParams {
  sessionId: string;
  userId: string;
  action: ActivityAction;
  occurredAt?: Date;

  courseId?: string;
  moduleId?: string;
  moduleItemId?: string;
  assessmentId?: string;
  attemptId?: string;
  questionId?: string;
  dialogueSessionId?: string;
  interventionId?: string;
  kcId?: string;

  metadata?: Record<string, unknown>;
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
          kcId: params.kcId ?? null,
          metadata: (params.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
      });
    } catch (err: unknown) {
      const error = err as Error;
      this.logger.error(`Failed to record activity log: ${error.message}`, error.stack);
    }
  }

  /**
   * Batch insert a list of events (used by the frontend batch endpoint).
   * Uses createMany for efficiency.
   */
  async recordBatch(events: Array<RecordEventParams>): Promise<void> {
    if (events.length === 0) return;
    try {
      await this.prisma.activityLog.createMany({
        data: events.map((e) => ({
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
          kcId: e.kcId ?? null,
          metadata: (e.metadata as Prisma.InputJsonValue) ?? Prisma.DbNull,
        })),
        skipDuplicates: true,
      });
    } catch (err: unknown) {
      const error = err as Error;
      this.logger.error(`Failed to record batch activity logs: ${error.message}`, error.stack);
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

    await Promise.all([...blobKeys].map((key) => this.blob.delete(key)));

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

      await tx.studentSession.delete({ where: { id: sessionId } });

      return {
        deleted: true,
        sessionId,
        recordingVideosDeleted: recordingSegments.length,
        blobObjectsDeleted: blobKeys.size,
        counts: {
          chatbotMessages: chatbotMessages.count,
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
        masteryDeltas: null,
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
      masteryDeltas: logs
        .filter((l) => l.action === 'MASTERY_UPDATED')
        .map((l) => l.metadata) as any,
    };
  }
}
