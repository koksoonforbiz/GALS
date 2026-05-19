import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class EngagementService {
  constructor(private readonly prisma: PrismaService) {}

  async compute(sessionId: string): Promise<{ recordsWritten: number; durationMs: number }> {
    const start = Date.now();

    // Get session info for userId
    const session = await this.prisma.studentSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { userId: true, startedAt: true, endedAt: true },
    });

    const sessionStartMs = session.startedAt.getTime();
    const sessionEndMs = session.endedAt?.getTime() ?? Date.now();
    const windowMs = 60_000;

    // Load raw data
    const [clicks, scrolls, cursors, visibility] = await Promise.all([
      this.prisma.click_logs.findMany({ where: { sessionId }, orderBy: { timestamp: 'asc' } }),
      this.prisma.scroll_logs.findMany({ where: { sessionId }, orderBy: { timestamp: 'asc' } }),
      this.prisma.cursor_logs.findMany({ where: { sessionId }, orderBy: { timestamp: 'asc' } }),
      this.prisma.visibility_logs.findMany({ where: { sessionId }, orderBy: { timestamp: 'asc' } }),
    ]);

    // Compute per-window metrics
    const windows: Array<{
      windowStartMs: bigint;
      windowEndMs: bigint;
      clickRate: number;
      scrollActivity: number;
      cursorMovement: number;
      tabVisibleFraction: number;
    }> = [];

    for (let wStart = sessionStartMs; wStart < sessionEndMs; wStart += windowMs) {
      const wEnd = Math.min(wStart + windowMs, sessionEndMs);
      const wStartBi = BigInt(wStart);
      const wEndBi = BigInt(wEnd);

      const windowClicks = clicks.filter((c) => c.timestamp >= wStartBi && c.timestamp < wEndBi);
      const clickRate = windowClicks.length / 60;

      const windowScrolls = scrolls.filter((s) => s.timestamp >= wStartBi && s.timestamp < wEndBi);
      let scrollActivity = 0;
      for (let i = 1; i < windowScrolls.length; i++) {
        if (Math.abs(windowScrolls[i]!.scrollPercent - windowScrolls[i - 1]!.scrollPercent) > 5) {
          scrollActivity++;
        }
      }

      const windowCursors = cursors.filter((c) => c.timestamp >= wStartBi && c.timestamp < wEndBi);
      let cursorMovement = 0;
      for (let i = 1; i < windowCursors.length; i++) {
        const dx = windowCursors[i]!.x - windowCursors[i - 1]!.x;
        const dy = windowCursors[i]!.y - windowCursors[i - 1]!.y;
        cursorMovement += Math.sqrt(dx * dx + dy * dy);
      }

      // Tab visible fraction — forward-fill from visibility logs
      const visBeforeWindow = visibility.filter((v) => v.timestamp <= wEndBi);
      let lastState = 'visible';
      if (visBeforeWindow.length > 0) {
        lastState = visBeforeWindow[visBeforeWindow.length - 1]!.visibleState;
      }
      const windowVis = visibility.filter((v) => v.timestamp >= wStartBi && v.timestamp < wEndBi);
      let visibleMs = 0;
      let prevTime = wStart;
      let currentState = lastState;
      for (const v of windowVis) {
        const vTime = Number(v.timestamp);
        if (currentState === 'visible') visibleMs += vTime - prevTime;
        prevTime = vTime;
        currentState = v.visibleState;
      }
      if (currentState === 'visible') visibleMs += wEnd - prevTime;
      const tabVisibleFraction = visibleMs / (wEnd - wStart);

      windows.push({
        windowStartMs: wStartBi,
        windowEndMs: wEndBi,
        clickRate,
        scrollActivity,
        cursorMovement,
        tabVisibleFraction,
      });
    }

    // Normalise against session max (min-max)
    const maxClick = Math.max(...windows.map((w) => w.clickRate), 1);
    const maxScroll = Math.max(...windows.map((w) => w.scrollActivity), 1);
    const maxCursor = Math.max(...windows.map((w) => w.cursorMovement), 1);

    let recordsWritten = 0;
    for (const w of windows) {
      const clickNorm = w.clickRate / maxClick;
      const scrollNorm = w.scrollActivity / maxScroll;
      const cursorNorm = w.cursorMovement / maxCursor;

      const engagementScore =
        0.3 * clickNorm + 0.2 * scrollNorm + 0.3 * cursorNorm + 0.2 * w.tabVisibleFraction;

      await this.prisma.derived_engagement.upsert({
        where: {
          sessionId_windowStartMs: { sessionId, windowStartMs: w.windowStartMs },
        },
        update: {
          clickRate: w.clickRate,
          scrollActivity: w.scrollActivity,
          cursorMovement: w.cursorMovement,
          tabVisibleFraction: w.tabVisibleFraction,
          engagementScore,
          computedAt: new Date(),
        },
        create: {
          sessionId,
          userId: session.userId,
          windowStartMs: w.windowStartMs,
          windowEndMs: w.windowEndMs,
          clickRate: w.clickRate,
          scrollActivity: w.scrollActivity,
          cursorMovement: w.cursorMovement,
          tabVisibleFraction: w.tabVisibleFraction,
          engagementScore,
        },
      });
      recordsWritten++;
    }

    return { recordsWritten, durationMs: Date.now() - start };
  }
}
