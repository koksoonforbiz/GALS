import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class EmotionService {
  constructor(private readonly prisma: PrismaService) {}

  async compute(sessionId: string): Promise<{ recordsWritten: number; durationMs: number }> {
    const start = Date.now();

    const session = await this.prisma.studentSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { startedAt: true, endedAt: true },
    });

    const sessionStartMs = session.startedAt.getTime();
    const sessionEndMs = session.endedAt?.getTime() ?? Date.now();
    const windowMs = 1_000; // 1-second windows

    const auResults = await this.prisma.pyfeatAuResult.findMany({
      where: { job: { sessionId } },
      orderBy: { frameIndex: 'asc' },
    });

    if (auResults.length === 0) {
      return { recordsWritten: 0, durationMs: Date.now() - start };
    }

    // Track consecutive "bored" windows for the bored rule
    let consecutiveAllLow = 0;
    let recordsWritten = 0;

    // Delete existing records for re-computation
    await this.prisma.derived_emotion_timeline.deleteMany({ where: { sessionId } });

    const records: Array<{
      sessionId: string;
      windowStartMs: bigint;
      emotion: string;
      confidence: number;
      auEvidence: object;
    }> = [];

    for (let wStart = sessionStartMs; wStart < sessionEndMs; wStart += windowMs) {
      const wEnd = wStart + windowMs;

      const windowAUs = auResults.filter((a) => {
        const t = a.wallTime.getTime();
        return t >= wStart && t < wEnd;
      });

      if (windowAUs.length === 0) continue;

      // Average AU values
      const avgAU = {
        au01: avg(windowAUs.map((a) => a.au01 ?? 0)),
        au04: avg(windowAUs.map((a) => a.au04 ?? 0)),
        au07: avg(windowAUs.map((a) => a.au07 ?? 0)),
        au17: avg(windowAUs.map((a) => a.au17 ?? 0)),
        au23: avg(windowAUs.map((a) => a.au23 ?? 0)),
        au25: avg(windowAUs.map((a) => a.au25 ?? 0)),
      };

      // Check all AUs are low for bored detection
      const allLow = Object.values(avgAU).every((v) => v < 0.5);
      if (allLow) {
        consecutiveAllLow++;
      } else {
        consecutiveAllLow = 0;
      }

      // Apply rules in priority order
      let emotion: string;
      let confidence: number;

      if (avgAU.au04 > 2.0 && avgAU.au17 > 1.5 && avgAU.au23 > 1.0) {
        emotion = 'frustrated';
        const supporting = [avgAU.au04 > 2.0, avgAU.au17 > 1.5, avgAU.au23 > 1.0].filter(
          Boolean,
        ).length;
        confidence = supporting / 3;
      } else if (avgAU.au04 > 1.5 && avgAU.au07 > 1.0) {
        emotion = 'confused';
        const supporting = [avgAU.au04 > 1.5, avgAU.au07 > 1.0].filter(Boolean).length;
        confidence = supporting / 2;
      } else if (avgAU.au01 < 0.5 && avgAU.au04 < 1.0 && avgAU.au25 > 1.0) {
        emotion = 'engaged';
        const supporting = [avgAU.au01 < 0.5, avgAU.au04 < 1.0, avgAU.au25 > 1.0].filter(
          Boolean,
        ).length;
        confidence = supporting / 3;
      } else if (consecutiveAllLow >= 5) {
        emotion = 'bored';
        confidence = Math.min(1, consecutiveAllLow / 10);
      } else {
        emotion = 'neutral';
        confidence = 1.0;
      }

      records.push({
        sessionId,
        windowStartMs: BigInt(wStart),
        emotion,
        confidence,
        auEvidence: avgAU,
      });
    }

    // Batch insert
    if (records.length > 0) {
      await this.prisma.derived_emotion_timeline.createMany({ data: records });
      recordsWritten = records.length;
    }

    return { recordsWritten, durationMs: Date.now() - start };
  }
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
