import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CognitiveLoadService {
  constructor(private readonly prisma: PrismaService) {}

  async compute(sessionId: string): Promise<{ recordsWritten: number; durationMs: number }> {
    const start = Date.now();

    const session = await this.prisma.studentSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { userId: true, startedAt: true, endedAt: true },
    });

    const sessionStartMs = session.startedAt.getTime();
    const sessionEndMs = session.endedAt?.getTime() ?? Date.now();
    const windowMs = 60_000;

    const [pupils, gazes, auResults] = await Promise.all([
      this.prisma.pupilSizeLog.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.webgazerLog.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.pyfeatAuResult.findMany({
        where: { job: { sessionId } },
        orderBy: { frameIndex: 'asc' },
      }),
    ]);

    // Baseline pupil: first 30s
    const baselineCutoff = sessionStartMs + 30_000;
    const baselinePupils = pupils.filter((p) => p.timestamp.getTime() <= baselineCutoff);
    const baseline =
      baselinePupils.length > 0
        ? baselinePupils.reduce((sum, p) => sum + p.pupilDiameter, 0) / baselinePupils.length
        : 0;

    const windows: Array<{
      windowStartMs: bigint;
      windowEndMs: bigint;
      avgPupilDiameter: number;
      pupilDilation: number;
      avgGazeEntropy: number;
      avgAU04: number;
      avgAU07: number;
    }> = [];

    for (let wStart = sessionStartMs; wStart < sessionEndMs; wStart += windowMs) {
      const wEnd = Math.min(wStart + windowMs, sessionEndMs);

      const windowPupils = pupils.filter(
        (p) => p.timestamp.getTime() >= wStart && p.timestamp.getTime() < wEnd,
      );
      const windowGazes = gazes.filter(
        (g) => g.timestamp.getTime() >= wStart && g.timestamp.getTime() < wEnd,
      );

      // Skip window if insufficient data
      if (windowPupils.length < 5 || windowGazes.length < 5) continue;

      const avgPupilDiameter =
        windowPupils.reduce((s, p) => s + p.pupilDiameter, 0) / windowPupils.length;
      const pupilDilation = avgPupilDiameter - baseline;

      // Gaze entropy: 5x5 grid
      const gridSize = 5;
      const cellCounts = new Array(gridSize * gridSize).fill(0);
      for (const g of windowGazes) {
        const gx = Math.min(gridSize - 1, Math.max(0, Math.floor((g.gazeX / 1920) * gridSize)));
        const gy = Math.min(gridSize - 1, Math.max(0, Math.floor((g.gazeY / 1080) * gridSize)));
        cellCounts[gy * gridSize + gx]++;
      }
      const total = windowGazes.length;
      let entropy = 0;
      for (const count of cellCounts) {
        const p = count / total;
        if (p > 0) entropy -= p * Math.log2(p + 1e-10);
      }

      // AU data — use timestamp approximation
      const windowAUs = auResults.filter((a) => {
        const auTime = a.wallTime.getTime();
        return auTime >= wStart && auTime < wEnd;
      });

      const avgAU04 =
        windowAUs.length > 0
          ? windowAUs.reduce((s, a) => s + (a.au04 ?? 0), 0) / windowAUs.length
          : 0;
      const avgAU07 =
        windowAUs.length > 0
          ? windowAUs.reduce((s, a) => s + (a.au07 ?? 0), 0) / windowAUs.length
          : 0;

      windows.push({
        windowStartMs: BigInt(wStart),
        windowEndMs: BigInt(wEnd),
        avgPupilDiameter,
        pupilDilation,
        avgGazeEntropy: entropy,
        avgAU04,
        avgAU07,
      });
    }

    // Normalise
    const maxDilation = Math.max(...windows.map((w) => Math.abs(w.pupilDilation)), 1);
    const maxEntropy = Math.max(...windows.map((w) => w.avgGazeEntropy), 1);
    const maxAU = Math.max(...windows.map((w) => (w.avgAU04 + w.avgAU07) / 2), 1);

    let recordsWritten = 0;
    for (const w of windows) {
      const dilationNorm = Math.abs(w.pupilDilation) / maxDilation;
      const entropyNorm = w.avgGazeEntropy / maxEntropy;
      const auNorm = (w.avgAU04 + w.avgAU07) / 2 / maxAU;

      const cognitiveLoadIndex = 0.4 * dilationNorm + 0.3 * entropyNorm + 0.3 * auNorm;

      await this.prisma.derived_cognitive_load.upsert({
        where: {
          sessionId_windowStartMs: { sessionId, windowStartMs: w.windowStartMs },
        },
        update: {
          avgPupilDiameter: w.avgPupilDiameter,
          pupilDilation: w.pupilDilation,
          avgGazeEntropy: w.avgGazeEntropy,
          avgAU04: w.avgAU04,
          avgAU07: w.avgAU07,
          cognitiveLoadIndex,
          computedAt: new Date(),
        },
        create: {
          sessionId,
          userId: session.userId,
          windowStartMs: w.windowStartMs,
          windowEndMs: w.windowEndMs,
          avgPupilDiameter: w.avgPupilDiameter,
          pupilDilation: w.pupilDilation,
          avgGazeEntropy: w.avgGazeEntropy,
          avgAU04: w.avgAU04,
          avgAU07: w.avgAU07,
          cognitiveLoadIndex,
        },
      });
      recordsWritten++;
    }

    return { recordsWritten, durationMs: Date.now() - start };
  }
}
