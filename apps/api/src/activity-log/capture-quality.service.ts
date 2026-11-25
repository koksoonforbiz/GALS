import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Capture quality per session (Prompt B, B4).
 *
 * Every activity event and every interaction-stream row carries the page-load
 * id (`tabId`) and a sequence number that counts up from 1 per stream and
 * page load. A missing number means a lost row, so for each stream and tab
 * this records:
 *   - gap:          a run of missing sequence numbers (fromSeq..toSeq);
 *   - out_of_order: rows that reached the server before an earlier one
 *                   (activity events only; streams have no receive time).
 * Duplicates are counted at ingest (`ingest_issues`, kind `duplicate`).
 *
 * The records for a session are rewritten each time it is analysed: when it
 * closes, and again when late events arrive (Prompt B, P2).
 */
const STREAMS = [
  'cursor_logs',
  'click_logs',
  'scroll_logs',
  'keystroke_logs',
  'visibility_logs',
  'clipboard_logs',
] as const;

export interface QualityRecord {
  stream: string;
  tabId: string | null;
  kind: 'gap' | 'out_of_order';
  fromSeq: number | null;
  toSeq: number | null;
  count: number;
}

@Injectable()
export class CaptureQualityService {
  private readonly logger = new Logger(CaptureQualityService.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('session.closed', { async: true })
  async onSessionClosed(payload: { sessionId: string }) {
    try {
      await this.analyseSession(payload.sessionId);
    } catch (err) {
      this.logger.warn(
        `capture quality failed for ${payload.sessionId}: ${(err as Error).message}`,
      );
    }
  }

  /** Recompute and store the quality records of one session. */
  async analyseSession(sessionId: string): Promise<QualityRecord[]> {
    const records: QualityRecord[] = [];

    // Activity events: snake_case columns, uuid session id.
    const gaps = await this.prisma.$queryRaw<
      Array<{ tab_id: string | null; from_seq: number; to_seq: number }>
    >`
      WITH s AS (
        SELECT tab_id, client_seq,
               lag(client_seq) OVER (PARTITION BY tab_id ORDER BY client_seq) AS prev,
               row_number() OVER (PARTITION BY tab_id ORDER BY client_seq) AS rn
        FROM activity_logs
        WHERE session_id = ${sessionId}::uuid AND client_seq IS NOT NULL
      )
      SELECT tab_id, COALESCE(prev, 0) + 1 AS from_seq, client_seq - 1 AS to_seq
      FROM s
      WHERE (prev IS NULL AND client_seq > 1) OR (prev IS NOT NULL AND client_seq - prev > 1)`;
    for (const g of gaps) records.push(gapRecord('activity_log', g));

    const late = await this.prisma.$queryRaw<Array<{ tab_id: string | null; n: number }>>`
      WITH s AS (
        SELECT tab_id, server_received_at,
               max(server_received_at) OVER (
                 PARTITION BY tab_id ORDER BY client_seq
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ) AS prev_max
        FROM activity_logs
        WHERE session_id = ${sessionId}::uuid
          AND client_seq IS NOT NULL AND server_received_at IS NOT NULL
      )
      SELECT tab_id, count(*)::int AS n FROM s
      WHERE prev_max IS NOT NULL AND server_received_at < prev_max
      GROUP BY tab_id`;
    for (const o of late) {
      records.push({
        stream: 'activity_log',
        tabId: o.tab_id,
        kind: 'out_of_order',
        fromSeq: null,
        toSeq: null,
        count: Number(o.n),
      });
    }

    // Interaction streams: camelCase columns, text session id.
    for (const stream of STREAMS) {
      const rows = await this.prisma.$queryRaw<
        Array<{ tab_id: string | null; from_seq: number; to_seq: number }>
      >(Prisma.sql`
        WITH s AS (
          SELECT "tabId" AS tab_id, "clientSeq" AS seq,
                 lag("clientSeq") OVER (PARTITION BY "tabId" ORDER BY "clientSeq") AS prev
          FROM ${Prisma.raw(`"${stream}"`)}
          WHERE "sessionId" = ${sessionId} AND "clientSeq" IS NOT NULL
        )
        SELECT tab_id, COALESCE(prev, 0) + 1 AS from_seq, seq - 1 AS to_seq
        FROM s
        WHERE (prev IS NULL AND seq > 1) OR (prev IS NOT NULL AND seq - prev > 1)`);
      for (const g of rows) records.push(gapRecord(stream, g));
    }

    await this.prisma.$transaction([
      this.prisma.captureQuality.deleteMany({ where: { sessionId } }),
      this.prisma.captureQuality.createMany({
        data: records.map((r) => ({ sessionId, ...r })),
      }),
    ]);
    return records;
  }
}

function gapRecord(
  stream: string,
  g: { tab_id: string | null; from_seq: number; to_seq: number },
): QualityRecord {
  const from = Number(g.from_seq);
  const to = Number(g.to_seq);
  return { stream, tabId: g.tab_id, kind: 'gap', fromSeq: from, toSeq: to, count: to - from + 1 };
}
