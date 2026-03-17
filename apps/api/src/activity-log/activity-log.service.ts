import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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

  constructor(private readonly prisma: PrismaService) {}

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

  /** Retrieve all sessions for a student (most recent first). */
  async getStudentSessions(userId: string) {
    return this.prisma.studentSession.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      include: { summary: true },
    });
  }
}
