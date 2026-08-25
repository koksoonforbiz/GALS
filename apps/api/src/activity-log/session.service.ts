import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogService } from './activity-log.service';
import { ActivityAction } from './activity-action.enum';

function convertBigInts<T>(value: T): T {
  if (typeof value === 'bigint') {
    return Number(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => convertBigInts(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, convertBigInts(nested)]),
    ) as T;
  }
  return value;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /** Throws ForbiddenException unless `teacherId` teaches the course this session belongs to. */
  async assertTeacherOwnsSession(sessionId: string, teacherId: string): Promise<void> {
    const session = await this.prisma.studentSession.findUnique({
      where: { id: sessionId },
      select: { courseId: true },
    });
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    if (!session.courseId) {
      throw new ForbiddenException('This session is not associated with a course you teach');
    }
    const course = await this.prisma.course.findUnique({
      where: { id: session.courseId },
      select: { teacherId: true },
    });
    if (!course || course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only view sessions for your own courses');
    }
  }

  /** Throws ForbiddenException unless `teacherId` teaches a course `studentId` is enrolled in. */
  async assertTeacherOwnsStudent(studentId: string, teacherId: string): Promise<void> {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId, course: { teacherId } },
      select: { id: true },
    });
    if (!enrollment) {
      throw new ForbiddenException('You can only view students enrolled in your own courses');
    }
  }

  /**
   * Throws ForbiddenException unless `userId` owns this session. Used for
   * self-service session writes (batch telemetry, course tagging, close) —
   * the session ID for these comes from a client-supplied header/body value,
   * not something the server derived, so it must be checked before use.
   */
  async assertOwnsSession(sessionId: string, userId: string): Promise<void> {
    const session = await this.prisma.studentSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    if (session.userId !== userId) {
      throw new ForbiddenException('You can only act on your own session');
    }
  }

  /** Called when a student authenticates (login or token refresh). */
  async openSession(params: {
    userId: string;
    courseId?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<string> {
    const session = await this.prisma.studentSession.create({
      data: {
        userId: params.userId,
        courseId: params.courseId ?? null,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      },
    });
    this.logger.log(`Session opened: ${session.id} for user ${params.userId}`);
    // Emit the dormant SESSION_START event so the replay timeline and
    // session summary have a server-authoritative anchor (frontend
    // can't reliably emit this on first paint due to provider mount
    // ordering). record() is fire-and-forget — errors are logged, not
    // thrown.
    void this.activityLog.record({
      sessionId: session.id,
      userId: params.userId,
      action: ActivityAction.SESSION_START,
      occurredAt: session.startedAt,
      courseId: params.courseId,
      metadata: {
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      },
    });
    return session.id;
  }

  /** Associate a courseId with an existing session (idempotent). */
  async setCourseId(sessionId: string, courseId: string): Promise<void> {
    await this.prisma.studentSession.update({
      where: { id: sessionId },
      data: { courseId },
    });
    this.logger.log(`Session ${sessionId} linked to course ${courseId}`);
  }

  /**
   * Called when a student logs out or a session timeout is detected.
   * Computes duration and triggers summary generation.
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = await this.prisma.studentSession.findUnique({
      where: { id: sessionId },
      select: { startedAt: true, userId: true, courseId: true },
    });
    if (!session) return;

    const endedAt = new Date();
    const durationSecs = Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000);

    await this.prisma.studentSession.update({
      where: { id: sessionId },
      data: { endedAt, durationSecs },
    });

    // Emit SESSION_END BEFORE buildSummary so it's included in the
    // summary's event counts and timeline.
    await this.activityLog.record({
      sessionId,
      userId: session.userId,
      action: ActivityAction.SESSION_END,
      occurredAt: endedAt,
      courseId: session.courseId ?? undefined,
      metadata: { durationSecs },
    });

    await this.buildSummary(sessionId);
    this.logger.log(`Session closed: ${sessionId} — ${durationSecs}s`);

    // Fire-and-forget export trigger
    this.triggerExport(sessionId);
  }

  private triggerExport(sessionId: string): void {
    if (process.env.ENABLE_SESSION_AUTO_EXPORT !== 'true') {
      return;
    }

    import('child_process')
      .then(({ exec }) => {
        exec(`python ../../analysis/export_logs.py ${sessionId} --upload`, (error) => {
          if (error) this.logger.error(`Auto-export failed for ${sessionId}: ${error.message}`);
          else this.logger.log(`Auto-export completed for ${sessionId}`);
        });
      })
      .catch((e) => {
        this.logger.error(`Export trigger failed for ${sessionId}`, e);
      });
  }

  /** Returns all data needed for the session timeline visualisation. */
  async getTimelineData(sessionId: string) {
    // Get session for userId and time bounds
    const session = await this.prisma.studentSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { userId: true, startedAt: true, endedAt: true },
    });

    const [
      recordingSegments,
      interventions,
      visibilityLogs,
      keyActivityLogs,
      attempts,
      sessionSummary,
      syncAnchor,
    ] = await Promise.all([
      this.prisma.recordingSegment.findMany({
        where: { sessionId },
        orderBy: { startWallTime: 'asc' },
      }),
      this.prisma.learningIntervention.findMany({
        where: {
          userId: session.userId,
          createdAt: {
            gte: session.startedAt,
            ...(session.endedAt ? { lte: session.endedAt } : {}),
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.visibility_logs.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.activityLog.findMany({
        where: {
          sessionId,
          action: {
            in: [
              'MODULE_OPENED',
              'ASSESSMENT_SUBMITTED',
              'DIALOGUE_SESSION_STARTED',
              'STUDY_MATERIAL_UPLOADED',
              'INTERVENTION_TRIGGERED',
            ],
          },
        },
        orderBy: { occurredAt: 'asc' },
      }),
      this.prisma.attempt.findMany({
        where: {
          studentId: session.userId,
          submittedAt: {
            gte: session.startedAt,
            ...(session.endedAt ? { lte: session.endedAt } : {}),
          },
        },
        select: { id: true, currentScore: true, submittedAt: true, status: true },
        orderBy: { submittedAt: 'asc' },
      }),
      this.prisma.sessionSummary.findUnique({ where: { sessionId } }),
      this.prisma.session_sync_anchors.findUnique({ where: { sessionId } }),
    ]);

    return convertBigInts({
      recordingSegments,
      interventions,
      visibilityLogs,
      keyActivityLogs,
      attempts,
      sessionSummary,
      syncAnchor,
    });
  }

  /** Compute and upsert a SessionSummary from all ActivityLog rows for this session. */
  async buildSummary(sessionId: string): Promise<void> {
    const logs = await this.prisma.activityLog.findMany({
      where: { sessionId },
      orderBy: { occurredAt: 'asc' },
    });

    if (logs.length === 0) return;

    const firstLog = logs[0]!;
    const userId = firstLog.userId;

    const count = (action: string) => logs.filter((l) => l.action === action).length;

    const interventionBreakdown: Record<string, number> = {};
    logs
      .filter((l) => l.action === 'INTERVENTION_TRIGGERED')
      .forEach((l) => {
        const meta = l.metadata as Record<string, string> | null;
        const type = meta?.interventionType ?? 'unknown';
        interventionBreakdown[type] = (interventionBreakdown[type] ?? 0) + 1;
      });

    const masteryDeltas = logs.filter((l) => l.action === 'MASTERY_UPDATED').map((l) => l.metadata);

    const eventTimeline = logs.map((l) => ({
      action: l.action,
      occurredAt: l.occurredAt.toISOString(),
      summary: (l.metadata as Record<string, unknown> | null)?.summary ?? null,
    }));

    // Approximate active time: sum gaps ≤ 5 min between consecutive events
    let totalActiveTimeSecs = 0;
    for (let i = 1; i < logs.length; i++) {
      const gap = (logs[i]!.occurredAt.getTime() - logs[i - 1]!.occurredAt.getTime()) / 1000;
      if (gap <= 300) totalActiveTimeSecs += gap;
    }

    const questionsCorrect = logs
      .filter((l) => l.action === 'QUESTION_ANSWERED')
      .filter((l) => (l.metadata as Record<string, unknown> | null)?.isCorrect === true).length;

    const summaryData = {
      totalEvents: logs.length,
      totalActiveTimeSecs: Math.round(totalActiveTimeSecs),
      assessmentsStarted: count('ASSESSMENT_STARTED'),
      assessmentsSubmitted: count('ASSESSMENT_SUBMITTED'),
      questionsAnswered: count('QUESTION_ANSWERED'),
      questionsCorrect,
      interventionsTriggered: count('INTERVENTION_TRIGGERED'),
      interventionsCompleted: count('INTERVENTION_COMPLETED'),
      interventionBreakdown,
      dialogueSessionsStarted: count('DIALOGUE_SESSION_STARTED'),
      studentMessagesSent: count('DIALOGUE_MESSAGE_SENT'),
      flashcardsReviewed: count('SPACED_REP_CARD_RATED'),
      moduleItemsViewed: count('MODULE_ITEM_VIEWED'),
      studyMaterialsUploaded: count('STUDY_MATERIAL_UPLOADED'),
      masteryDeltas,
      eventTimeline,
    };

    await this.prisma.sessionSummary.upsert({
      where: { sessionId },
      create: {
        sessionId,
        userId,
        ...summaryData,
      },
      update: {
        ...summaryData,
        computedAt: new Date(),
      },
    });
  }
}
