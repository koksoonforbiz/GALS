import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class LearningVelocityService {
  constructor(private readonly prisma: PrismaService) {}

  async compute(sessionId: string): Promise<{ recordsWritten: number; durationMs: number }> {
    const start = Date.now();

    const session = await this.prisma.studentSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { userId: true, startedAt: true, endedAt: true },
    });

    // Get KC evidence for this session time range via gradingResult -> attempt
    const evidence = await this.prisma.kcEvidence.findMany({
      where: {
        gradingResult: {
          attempt: {
            studentId: session.userId,
            submittedAt: {
              gte: session.startedAt,
              ...(session.endedAt ? { lte: session.endedAt } : {}),
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (evidence.length === 0) {
      return { recordsWritten: 0, durationMs: Date.now() - start };
    }

    // Group by kcId
    const byKc = new Map<string, typeof evidence>();
    for (const e of evidence) {
      const list = byKc.get(e.kcId) ?? [];
      list.push(e);
      byKc.set(e.kcId, list);
    }

    // Get mastery records for this session's KCs
    const masteries = await this.prisma.userMastery.findMany({
      where: {
        userId: session.userId,
        kcId: { in: Array.from(byKc.keys()) },
      },
    });

    const masteryByKc = new Map(masteries.map((m) => [m.kcId, m]));

    let recordsWritten = 0;

    // Delete and re-insert for this session
    await this.prisma.derived_learning_velocity.deleteMany({ where: { sessionId } });

    const records: Array<{
      sessionId: string;
      userId: string;
      kcId: string;
      masteryStart: number;
      masteryEnd: number;
      masteryDelta: number;
      attemptsCount: number;
      durationMs: bigint;
      velocityScore: number;
    }> = [];

    for (const [kcId, evidenceList] of byKc) {
      if (evidenceList.length < 2) continue;

      const mastery = masteryByKc.get(kcId);
      const masteryEnd = mastery?.probabilityKnown ?? 0.5;

      // Estimate mastery start from first evidence
      const attemptsCount = evidenceList.length;
      const firstTime = evidenceList[0]!.createdAt.getTime();
      const lastTime = evidenceList[evidenceList.length - 1]!.createdAt.getTime();
      const durationMs = lastTime - firstTime;

      // Rough estimate: start mastery = end mastery minus accumulated delta
      const masteryStart = Math.max(0, masteryEnd - attemptsCount * 0.05);
      const masteryDelta = masteryEnd - masteryStart;

      const durationMinutes = Math.max(1, durationMs / 60000);
      const velocityScore = masteryDelta / durationMinutes;

      records.push({
        sessionId,
        userId: session.userId,
        kcId,
        masteryStart,
        masteryEnd,
        masteryDelta,
        attemptsCount,
        durationMs: BigInt(durationMs),
        velocityScore,
      });
    }

    if (records.length > 0) {
      await this.prisma.derived_learning_velocity.createMany({ data: records });
      recordsWritten = records.length;
    }

    return { recordsWritten, durationMs: Date.now() - start };
  }
}
