/**
 * Interaction streams (cursor, clicks, scroll, keystrokes, visibility,
 * clipboard) with no silent loss (Prompt B, B3).
 *
 * Every row is numbered per stream, session and page load (clientSeq) and
 * waits in a persistent queue until the server has stored it. The server
 * dedupes on (sessionId, tabId, clientSeq), so a retry never doubles a row.
 * Failed sends back off (30 s doubling to 5 min) instead of hammering the
 * API: about 8 requests a minute per learner in normal use, well inside the
 * per-learner telemetry budget (TelemetryRateGuard).
 */
import { DurableQueue, backoffMs } from './durableQueue';
import { TAB_ID, nextSeq } from './captureIds';

export type StreamName = 'cursor' | 'clicks' | 'scroll' | 'keystrokes' | 'visibility' | 'clipboard';

const PATH: Record<StreamName, string> = {
  cursor: '/api/logs/cursor',
  clicks: '/api/logs/clicks',
  scroll: '/api/logs/scroll',
  keystrokes: '/api/logs/keystrokes',
  visibility: '/api/logs/visibility',
  clipboard: '/api/logs/clipboard',
};

/** Rows kept per stream while the server can't be reached. */
const CAP: Record<StreamName, number> = {
  cursor: 3_000,
  clicks: 1_000,
  scroll: 1_000,
  keystrokes: 300,
  visibility: 500,
  clipboard: 300,
};

const MAX_EVENTS_PER_BATCH = 500;
/** Browsers cap all in-flight keepalive bodies together at about 64 KB. */
const KEEPALIVE_BUDGET_BYTES = 60_000;

interface StreamItem {
  sid: string;
  uid: string;
  e: Record<string, unknown> & { tabId: string; clientSeq: number };
}

const queues = new Map<StreamName, DurableQueue<StreamItem>>();
const failures = new Map<StreamName, number>();
const nextAttemptAt = new Map<StreamName, number>();

function queue(stream: StreamName): DurableQueue<StreamItem> {
  let q = queues.get(stream);
  if (!q) {
    q = new DurableQueue<StreamItem>(
      `gals.capture.${stream}.v1`,
      (it) => `${it.sid}:${it.e.tabId}:${it.e.clientSeq}`,
      CAP[stream],
      TAB_ID,
    );
    queues.set(stream, q);
  }
  return q;
}

/** Queue one row for a stream; it gets this page load's id and the next sequence number. */
export function enqueue(
  stream: StreamName,
  sessionId: string,
  userId: string,
  event: Record<string, unknown>,
): void {
  queue(stream).push({
    sid: sessionId,
    uid: userId,
    e: { ...event, tabId: TAB_ID, clientSeq: nextSeq(stream, sessionId) },
  });
}

function isPermanentRejection(status: number): boolean {
  return status >= 400 && status < 500 && ![401, 408, 429].includes(status);
}

/**
 * Send every stream's queue. `keepalive` (page hidden or closing) sends only
 * what fits the browser's keepalive budget; the rest stays in localStorage
 * for the next page load. `force` ignores the back-off.
 */
export async function flushStreams(opts: { keepalive?: boolean; force?: boolean } = {}) {
  const token = localStorage.getItem('token');
  if (!token) return;
  let budget = opts.keepalive ? KEEPALIVE_BUDGET_BYTES : Infinity;
  const streams = Object.keys(PATH) as StreamName[];
  await Promise.all(
    streams.map(async (stream) => {
      const q = queue(stream);
      if (!opts.keepalive) q.adoptAbandoned(); // queues of page loads that have closed since
      if (q.length === 0) return;
      if (opts.keepalive) q.persistNow();
      if (!opts.force && Date.now() < (nextAttemptAt.get(stream) ?? 0)) return;
      const items = q.take(Infinity);
      const groups = new Map<string, StreamItem[]>();
      for (const it of items) {
        const k = `${it.sid}|${it.uid}`;
        groups.set(k, [...(groups.get(k) ?? []), it]);
      }
      let ok = true;
      for (const list of groups.values()) {
        for (let i = 0; i < list.length; i += MAX_EVENTS_PER_BATCH) {
          let batch = list.slice(i, i + MAX_EVENTS_PER_BATCH);
          let body = bodyOf(batch, q);
          if (opts.keepalive) {
            // Trim to what the remaining keepalive budget allows.
            while (batch.length > 0 && body.json.length > budget) {
              batch = batch.slice(0, Math.floor(batch.length / 2));
              q.restoreOverflow(body.overflow);
              body = bodyOf(batch, q);
            }
            const unsent = list.slice(i).filter((x) => !batch.includes(x));
            q.release(unsent);
            if (batch.length === 0) {
              q.restoreOverflow(body.overflow);
              break;
            }
            budget -= body.json.length;
          }
          try {
            const res = await fetch(PATH[stream], {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: body.json,
              keepalive: !!opts.keepalive,
            });
            if (res.ok || isPermanentRejection(res.status)) {
              if (!res.ok) console.warn(`[capture] ${stream} batch rejected:`, res.status);
              q.ack(batch);
            } else {
              q.release(batch);
              q.restoreOverflow(body.overflow);
              ok = false;
            }
          } catch {
            q.release(batch);
            q.restoreOverflow(body.overflow);
            ok = false;
          }
          if (opts.keepalive) break; // one batch per stream when the page is going away
        }
      }
      const n = ok ? 0 : (failures.get(stream) ?? 0) + 1;
      failures.set(stream, n);
      nextAttemptAt.set(stream, Date.now() + backoffMs(n));
    }),
  );
}

function bodyOf(batch: StreamItem[], q: DurableQueue<StreamItem>) {
  const overflow = q.takeOverflow();
  const first = batch[0];
  const json = JSON.stringify({
    sessionId: first?.sid,
    userId: first?.uid,
    events: batch.map((b) => b.e),
    ...(overflow ? { overflow } : {}),
  });
  return { json, overflow };
}
