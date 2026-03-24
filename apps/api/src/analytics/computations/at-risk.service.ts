import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AtRiskService {
  constructor(private readonly prisma: PrismaService) {}

  async compute(sessionId: string): Promise<{ recordsWritten: number; durationMs: number }> {
    const start = Date.now();

    const session = await this.prisma.studentSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { userId: true, startedAt: true, endedAt: true },
    });

    const now = Date.now();

    // Check conditions
    const conditions: string[] = [];

    // 1. Low engagement: engagementScore < 0.3 in 2+ consecutive windows
    const engagementWindows = await this.prisma.derived_engagement.findMany({
      where: { sessionId },
      orderBy: { windowStartMs: 'desc' },
      take: 5,
    });
    if (engagementWindows.length >= 2) {
      let consecutiveLow = 0;
      for (const w of engagementWindows) {
        if (w.engagementScore < 0.3) {
          consecutiveLow++;
        } else {
          break;
        }
      }
      if (consecutiveLow >= 2) conditions.push('low_engagement');
    }

    // 2. Cognitive overload: cognitiveLoadIndex > 0.8 in 2+ consecutive windows
    const cognitiveWindows = await this.prisma.derived_cognitive_load.findMany({
      where: { sessionId },
      orderBy: { windowStartMs: 'desc' },
      take: 5,
    });
    if (cognitiveWindows.length >= 2) {
      let consecutiveHigh = 0;
      for (const w of cognitiveWindows) {
        if (w.cognitiveLoadIndex > 0.8) {
          consecutiveHigh++;
        } else {
          break;
        }
      }
      if (consecutiveHigh >= 2) conditions.push('cognitive_overload');
    }

    // 3. Sustained frustration: emotion = frustrated in > 60% of recent 5-minute window
    const fiveMinAgo = BigInt(now - 5 * 60_000);
    const recentEmotions = await this.prisma.derived_emotion_timeline.findMany({
      where: { sessionId, windowStartMs: { gte: fiveMinAgo } },
    });
    if (recentEmotions.length > 0) {
      const frustratedCount = recentEmotions.filter((e) => e.emotion === 'frustrated').length;
      if (frustratedCount / recentEmotions.length > 0.6) {
        conditions.push('sustained_frustration');
      }
    }

    // 4. Inactive: no activity_logs in past 3 minutes
    const threeMinAgo = new Date(now - 3 * 60_000);
    const recentActivity = await this.prisma.activityLog.count({
      where: { sessionId, occurredAt: { gte: threeMinAgo } },
    });
    if (recentActivity === 0) {
      conditions.push('inactive');
    }

    // 5. Repeated failure: last 2 consecutive attempts currentScore < 0.4
    const recentAttempts = await this.prisma.attempt.findMany({
      where: {
        studentId: session.userId,
        status: 'graded',
        submittedAt: { gte: session.startedAt },
      },
      orderBy: { submittedAt: 'desc' },
      take: 2,
      select: { currentScore: true },
    });
    if (
      recentAttempts.length >= 2 &&
      recentAttempts.every((a) => a.currentScore !== null && a.currentScore < 0.4)
    ) {
      conditions.push('repeated_failure');
    }

    // Determine risk level
    if (conditions.length === 0) {
      return { recordsWritten: 0, durationMs: Date.now() - start };
    }

    const riskLevel = conditions.length >= 3 ? 'high' : conditions.length >= 2 ? 'medium' : 'low';

    // Only write if risk level changed from most recent
    const lastFlag = await this.prisma.derived_at_risk_flags.findFirst({
      where: { sessionId },
      orderBy: { flaggedAt: 'desc' },
    });

    if (lastFlag && lastFlag.riskLevel === riskLevel) {
      return { recordsWritten: 0, durationMs: Date.now() - start };
    }

    await this.prisma.derived_at_risk_flags.create({
      data: {
        sessionId,
        userId: session.userId,
        flaggedAt: BigInt(now),
        riskLevel,
        reasons: conditions,
      },
    });

    return { recordsWritten: 1, durationMs: Date.now() - start };
  }
}
