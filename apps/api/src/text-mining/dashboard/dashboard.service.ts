import { Injectable } from '@nestjs/common';
import { Prisma, ActivityAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CONSTRUCTS } from '../detection/constructs';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSessionDashboard(sessionId: string, rollingN: number) {
    const dialogueSessionIds = [sessionId];
    return this.buildDashboardForDialogueSessions(dialogueSessionIds, rollingN);
  }

  async getActivitySessionDashboard(activitySessionId: string, rollingN: number) {
    const dialogueSessionIds = await this.getDialogueSessionIdsForActivitySession(activitySessionId);
    // Include the activitySessionId itself: standard-mode chatbot
    // detections (from learning-interventions chat()) are stored with
    // sessionId = activitySessionId directly, not via a dialogueSession.
    const allIds = [...dialogueSessionIds, activitySessionId];
    return this.buildDashboardForDialogueSessions(allIds, rollingN);
  }

  async getDetections(
    sessionId: string,
    filters: { constructKey?: string; label?: string; cursor?: string; limit: number },
  ) {
    return this.getDetectionsForDialogueSessions([sessionId], filters);
  }

  async getActivitySessionDetections(
    activitySessionId: string,
    filters: { constructKey?: string; label?: string; cursor?: string; limit: number },
  ) {
    const dialogueSessionIds = await this.getDialogueSessionIdsForActivitySession(activitySessionId);
    const allIds = [...dialogueSessionIds, activitySessionId];
    return this.getDetectionsForDialogueSessions(allIds, filters);
  }

  async getStudentDashboard(studentId: string, courseId: string | undefined, rollingN: number) {
    const where: Record<string, unknown> = { studentId };
    if (courseId) where.courseId = courseId;

    const totalDetections = await this.prisma.efDetection.count({ where });
    if (totalDetections === 0) {
      return { rollingN, totalUserMessages: 0, constructs: {} };
    }

    const totalUserMessages = await this.prisma.dialogueMessage.count({
      where: {
        role: 'USER',
        session: { studentId, ...(courseId ? { courseId } : {}) },
      },
    });

    const constructs: Record<string, unknown> = {};

    for (const c of CONSTRUCTS) {
      const allDetections = await this.prisma.efDetection.findMany({
        where: { ...where, constructKey: c.key, label: { notIn: ['error', 'pending'] } },
        orderBy: { createdAt: 'desc' },
      });

      const latest = allDetections[0] ?? null;
      const rollingSlice = allDetections.slice(0, rollingN);

      let rolling: unknown;
      let session: unknown;

      if (c.labelType === 'binary') {
        rolling = { positiveRate: computeRate(rollingSlice, 'positive'), n: rollingSlice.length };
        session = { positiveRate: computeRate(allDetections, 'positive'), n: allDetections.length };
      } else if (c.labelType === 'ordinal') {
        rolling = {
          distribution: computeDistribution(rollingSlice, ['low', 'medium', 'high']),
          n: rollingSlice.length,
        };
        session = {
          distribution: computeDistribution(allDetections, ['low', 'medium', 'high']),
          n: allDetections.length,
        };
      } else {
        rolling = { onTaskRate: computeRate(rollingSlice, 'on-task'), n: rollingSlice.length };
        session = { onTaskRate: computeRate(allDetections, 'on-task'), n: allDetections.length };
      }

      constructs[c.key] = {
        displayName: c.displayName,
        labelType: c.labelType,
        feasibility: c.feasibility,
        warning: c.warning,
        disabled: false,
        latest: latest
          ? {
              messageId: latest.messageId,
              label: latest.label,
              confidence: latest.confidence,
              rationale: latest.rationale,
              createdAt: latest.createdAt,
            }
          : null,
        rolling,
        session,
      };
    }

    return { rollingN, totalUserMessages, constructs };
  }

  async getActivitySessionCsvRows(activitySessionId: string) {
    const dialogueSessionIds = await this.getDialogueSessionIdsForActivitySession(activitySessionId);
    const allIds = [...dialogueSessionIds, activitySessionId];

    return this.prisma.efDetection.findMany({
      where: { sessionId: { in: allIds } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  private async buildDashboardForDialogueSessions(dialogueSessionIds: string[], rollingN: number) {
    // Count user utterances from BOTH sources so the dashboard renders
    // for chatbot-only sessions too. dialogue.service writes a
    // DialogueMessage row per user turn; the floating chatbot only writes
    // an activity_log row (CHATBOT_MESSAGE_SENT) — without summing both
    // the totalUserMessages===0 gate hides the table even when
    // EfDetection rows exist.
    const totalDialogueUserMessages =
      dialogueSessionIds.length === 0
        ? 0
        : await this.prisma.dialogueMessage.count({
            where: { sessionId: { in: dialogueSessionIds }, role: 'USER' },
          });
    const totalChatbotMessages =
      dialogueSessionIds.length === 0
        ? 0
        : await this.prisma.activityLog.count({
            where: {
              sessionId: { in: dialogueSessionIds },
              action: ActivityAction.CHATBOT_MESSAGE_SENT,
            },
          });
    const totalUserMessages = totalDialogueUserMessages + totalChatbotMessages;

    const constructs: Record<string, unknown> = {};
    const sessionWhere =
      dialogueSessionIds.length === 0
        ? ({ sessionId: '__none__' } as Prisma.EfDetectionWhereInput)
        : ({ sessionId: { in: dialogueSessionIds } } as Prisma.EfDetectionWhereInput);

    for (const c of CONSTRUCTS) {
      const allDetections = await this.prisma.efDetection.findMany({
        where: {
          ...sessionWhere,
          constructKey: c.key,
          label: { notIn: ['error', 'pending'] },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });

      const latest = allDetections[0] ?? null;
      const rollingSlice = allDetections.slice(0, rollingN);
      const sessionSlice = allDetections;

      const disabled = allDetections.length === 0 && totalUserMessages > 0;
      const errorCount = await this.prisma.efDetection.count({
        where: { ...sessionWhere, constructKey: c.key, label: 'error' },
      });
      const pendingCount = await this.prisma.efDetection.count({
        where: { ...sessionWhere, constructKey: c.key, label: 'pending' },
      });

      let rolling: unknown;
      let session: unknown;

      if (c.labelType === 'binary') {
        rolling = {
          positiveRate: computeRate(rollingSlice, 'positive'),
          n: rollingSlice.length,
        };
        session = {
          positiveRate: computeRate(sessionSlice, 'positive'),
          n: sessionSlice.length,
        };
      } else if (c.labelType === 'ordinal') {
        rolling = {
          distribution: computeDistribution(rollingSlice, ['low', 'medium', 'high']),
          n: rollingSlice.length,
        };
        session = {
          distribution: computeDistribution(sessionSlice, ['low', 'medium', 'high']),
          n: sessionSlice.length,
        };
      } else {
        rolling = {
          onTaskRate: computeRate(rollingSlice, 'on-task'),
          n: rollingSlice.length,
        };
        session = {
          onTaskRate: computeRate(sessionSlice, 'on-task'),
          n: sessionSlice.length,
        };
      }

      constructs[c.key] = {
        displayName: c.displayName,
        labelType: c.labelType,
        feasibility: c.feasibility,
        warning: c.warning,
        disabled,
        latest: latest
          ? {
              messageId: latest.messageId,
              label: latest.label,
              confidence: latest.confidence,
              rationale: latest.rationale,
              createdAt: latest.createdAt,
            }
          : null,
        rolling,
        session,
        errorCount,
        pendingCount,
      };
    }

    return { rollingN, totalUserMessages, constructs };
  }

  private async getDetectionsForDialogueSessions(
    dialogueSessionIds: string[],
    filters: { constructKey?: string; label?: string; cursor?: string; limit: number },
  ) {
    if (dialogueSessionIds.length === 0) {
      return { items: [], nextCursor: null };
    }

    const where: Prisma.EfDetectionWhereInput = { sessionId: { in: dialogueSessionIds } };
    if (filters.constructKey) where.constructKey = filters.constructKey;
    if (filters.label) where.label = filters.label;
    if (filters.cursor) where.id = { lt: filters.cursor };

    const items = await this.prisma.efDetection.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filters.limit + 1,
    });

    const hasMore = items.length > filters.limit;
    if (hasMore) items.pop();

    const messageIds = [...new Set(items.map((i) => i.messageId))];
    const messages = await this.prisma.dialogueMessage.findMany({
      where: { id: { in: messageIds } },
      select: { id: true, content: true },
    });
    const messageMap = new Map(messages.map((m) => [m.id, m.content]));

    return {
      items: items.map((i) => ({
        id: i.id,
        messageId: i.messageId,
        messageContent: (messageMap.get(i.messageId) ?? '').slice(0, 280),
        constructKey: i.constructKey,
        label: i.label,
        confidence: i.confidence,
        severity: i.severity,
        rationale: i.rationale,
        warning: i.warning,
        createdAt: i.createdAt,
        model: i.model,
        promptVersion: i.promptVersion,
      })),
      nextCursor: hasMore ? items[items.length - 1]?.id : null,
    };
  }

  private async getDialogueSessionIdsForActivitySession(activitySessionId: string) {
    const logs = await this.prisma.activityLog.findMany({
      where: { sessionId: activitySessionId, dialogueSessionId: { not: null } },
      select: { dialogueSessionId: true },
      distinct: ['dialogueSessionId'],
    });

    return logs
      .map((log) => log.dialogueSessionId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  }
}

function computeRate(detections: Array<{ label: string }>, positiveLabel: string): number {
  if (detections.length === 0) return 0;
  const count = detections.filter((d) => d.label === positiveLabel).length;
  return Math.round((count / detections.length) * 100) / 100;
}

function computeDistribution(
  detections: Array<{ label: string }>,
  labels: string[],
): Record<string, number> {
  const total = detections.length || 1;
  const dist: Record<string, number> = {};
  for (const l of labels) {
    dist[l] = Math.round((detections.filter((d) => d.label === l).length / total) * 100) / 100;
  }
  return dist;
}
