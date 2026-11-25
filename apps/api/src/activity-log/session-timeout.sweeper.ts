import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from './session.service';
import { SESSION_PARAMS } from './session-params';

/** T2 (session-params.ts): no learner input for this long closes the session. */
export const SESSION_IDLE_TIMEOUT_MS = SESSION_PARAMS.T2_ms;
const SWEEP_EVERY_MS = 2 * 60_000;
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
      // Last learner input per open session (see SessionService.lastInputAt;
      // same definition, set-based). Periodic replay snapshots of an
      // untouched tab don't count. `last_action` tells a closed tab
      // (PAGE_LEFT and nothing after) from a tab left open.
      const cutoffMs = BigInt(cutoff.getTime());
      const idle = await this.prisma.$queryRaw<
        Array<{ id: string; last_at: Date; last_action: string | null }>
      >`
        SELECT s.id, GREATEST(s.started_at, a.last_at,
                 to_timestamp(c.t / 1000.0), to_timestamp(k.t / 1000.0),
                 to_timestamp(sc.t / 1000.0), to_timestamp(cu.t / 1000.0)) AS last_at,
               la.action AS last_action
        FROM student_sessions s
        LEFT JOIN LATERAL (
          SELECT max(occurred_at) AS last_at FROM activity_logs
          WHERE session_id = s.id
            AND action::text NOT IN ('SESSION_START', 'SESSION_END', 'SESSION_HEARTBEAT')
        ) a ON true
        LEFT JOIN LATERAL (
          SELECT action::text AS action FROM activity_logs
          WHERE session_id = s.id
            AND action::text NOT IN ('SESSION_START', 'SESSION_END', 'SESSION_HEARTBEAT')
          ORDER BY occurred_at DESC LIMIT 1
        ) la ON true
        LEFT JOIN LATERAL (SELECT max("timestamp") AS t FROM click_logs WHERE "sessionId" = s.id::text) c ON true
        LEFT JOIN LATERAL (SELECT max("timestamp") AS t FROM keystroke_logs WHERE "sessionId" = s.id::text) k ON true
        LEFT JOIN LATERAL (SELECT max("timestamp") AS t FROM scroll_logs WHERE "sessionId" = s.id::text) sc ON true
        LEFT JOIN LATERAL (SELECT max("timestamp") AS t FROM cursor_logs WHERE "sessionId" = s.id::text) cu ON true
        WHERE s.ended_at IS NULL
          AND s.started_at < ${cutoff}
          AND COALESCE(a.last_at, s.started_at) < ${cutoff}
          AND COALESCE(c.t, 0) < ${cutoffMs}
          AND COALESCE(k.t, 0) < ${cutoffMs}
          AND COALESCE(sc.t, 0) < ${cutoffMs}
          AND COALESCE(cu.t, 0) < ${cutoffMs}
        ORDER BY s.started_at
        LIMIT ${MAX_PER_SWEEP}`;
      for (const s of idle) {
        const last = s.last_at;
        const lastActivityLeft = s.last_action === 'PAGE_LEFT';
        await this.sessions.closeSession(s.id, {
          endedAt: last,
          reason: lastActivityLeft ? 'tab_closed' : 'idle_timeout',
        });
      }
      if (idle.length) this.logger.log(`Closed ${idle.length} idle session(s)`);
      return idle.length;
    } finally {
      this.running = false;
    }
  }
}
