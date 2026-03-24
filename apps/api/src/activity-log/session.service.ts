import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(private readonly prisma: PrismaService) {}

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
      select: { startedAt: true, userId: true },
    });
    if (!session) return;

    const endedAt = new Date();
    const durationSecs = Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000);

    await this.prisma.studentSession.update({
      where: { id: sessionId },
      data: { endedAt, durationSecs },
    });

    await this.buildSummary(sessionId);
    this.logger.log(`Session closed: ${sessionId} — ${durationSecs}s`);
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
