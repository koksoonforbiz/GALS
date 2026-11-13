import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from './session.service';

/** No activity event and no replay snapshot for this long → the session is over. */
export const SESSION_IDLE_TIMEOUT_MS = 2 * 3600_000;
const SWEEP_EVERY_MS = 10 * 60_000;
const MAX_PER_SWEEP = 50;

/**
 * Closes sessions the student never logged out of (tab closed, laptop
 * shut). Logout was the only path to closeSession, so most sessions never
 * got SESSION_END, a summary, or the learning-event parse
 * (`session.closed`). The close is dated at the last activity, not now.
 */
@Injectable()
export class SessionTimeoutSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionTimeoutSweeper.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return; // specs call sweep() directly
    this.intervalHandle = setInterval(() => {
      this.sweep().catch((err) => this.logger.error('Session sweep failed', err));
    }, SWEEP_EVERY_MS);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }

  /** Close idle sessions; returns how many were closed. */
  async sweep(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const cutoff = new Date(now.getTime() - SESSION_IDLE_TIMEOUT_MS);
      const idle = await this.prisma.$queryRaw<Array<{ id: string; last_at: Date }>>`
        SELECT s.id, GREATEST(s.started_at, a.last_at, r.last_at) AS last_at
        FROM student_sessions s
        LEFT JOIN LATERAL (
          SELECT max(occurred_at) AS last_at FROM activity_logs WHERE session_id = s.id
        ) a ON true
        LEFT JOIN LATERAL (
          SELECT max("createdAt") AS last_at FROM session_replay_snapshots WHERE "sessionId" = s.id
        ) r ON true
        WHERE s.ended_at IS NULL
          AND s.started_at < ${cutoff}
          AND GREATEST(s.started_at, a.last_at, r.last_at) < ${cutoff}
        ORDER BY s.started_at
        LIMIT ${MAX_PER_SWEEP}`;
      for (const s of idle) {
        await this.sessions.closeSession(s.id, { endedAt: s.last_at, reason: 'timeout' });
      }
      if (idle.length) this.logger.log(`Closed ${idle.length} idle session(s)`);
      return idle.length;
    } finally {
      this.running = false;
    }
  }
}
