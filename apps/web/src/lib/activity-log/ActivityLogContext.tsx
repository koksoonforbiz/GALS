import {
  createContext,
  useContext,
  useRef,
  useCallback,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import { ActivityAction, ActivityEvent } from './types';
import { DurableQueue, backoffMs } from '../capture/durableQueue';
import { APP_BUILD, TAB_ID, newEventId, nextSeq } from '../capture/captureIds';
import { decideOnInput, noteInput, setIdleTimeoutMs } from '../capture/sessionSync';

interface ActivityLogContextValue {
  sessionId: string | null;
  track: (action: ActivityAction, extras?: Omit<ActivityEvent, 'action' | 'occurredAt'>) => void;
  /**
   * Force the buffered events to be POSTed immediately instead of waiting
   * for the 30s timer. Use this when latency-to-DB matters, e.g. the
   * floating chatbot whose events power the teacher's text-mining and
   * conversation views — those need to be visible the moment the teacher
   * opens the session log, not 30 seconds after the student stops typing.
   */
  flush: () => Promise<void>;
}

const ActivityLogContext = createContext<ActivityLogContextValue>({
  sessionId: null,
  track: () => {},
  flush: async () => {},
});

const SESSION_KEY = 'ats_session_id';
const SESSION_CHANGE_EVENT = 'ats_session_change';
const FLUSH_INTERVAL_MS = 30_000; // 30 seconds
const API_BATCH_URL = '/api/activity-log/batch';
/** Dispatched by AuthContext before it closes the session (see flushBeforeClose). */
export const ACTIVITY_FLUSH_EVENT = 'ats:activity-flush';
const MAX_EVENTS_PER_BATCH = 500; // server DTO limit (log-event.dto.ts)
// keepalive bodies are capped by the browser at ~64 KB in total.
const MAX_KEEPALIVE_BYTES = 60_000;
/** Events kept in the browser while the server can't be reached. */
const MAX_QUEUED_EVENTS = 3_000;
const QUEUE_KEY = 'gals.capture.activity.v1';

/**
 * A queued event: the event with its envelope (Prompt B, B2), plus the
 * session it belongs to. Events tracked before a session exists (login page)
 * get the next session; events never move to a later session once they
 * have one (they are sent with their own session id).
 */
interface Queued {
  sid: string | null;
  event: ActivityEvent & {
    clientEventId: string;
    clientSeq?: number;
    tabId: string;
  };
}

/** Split into batches the server (≤500 events) and, for keepalive, the browser accept. */
function chunk(events: Queued[], maxBytes: number): Queued[][] {
  const out: Queued[][] = [];
  let cur: Queued[] = [];
  let bytes = 0;
  for (const e of events) {
    const size = JSON.stringify(e.event).length + 1;
    if (cur.length && (cur.length >= MAX_EVENTS_PER_BATCH || bytes + size > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(e);
    bytes += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * A 4xx other than auth/timeout/rate-limit will fail again: drop it rather
 * than block the queue. 403/404 mean the session is not this user's (events
 * left by another login on this browser), which retrying can't fix either.
 */
function isPermanentRejection(status: number): boolean {
  return status >= 400 && status < 500 && ![401, 408, 429].includes(status);
}

interface Props {
  children: ReactNode;
  getToken: () => string | null;
}

export function ActivityLogProvider({ children, getToken }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(() =>
    sessionStorage.getItem(SESSION_KEY),
  );
  const sessionIdRef = useRef(sessionId);
  const queueRef = useRef<DurableQueue<Queued> | null>(null);
  if (!queueRef.current) {
    queueRef.current = new DurableQueue<Queued>(
      QUEUE_KEY,
      (q) => q.event.clientEventId,
      MAX_QUEUED_EVENTS,
      TAB_ID,
    );
  }
  const queue = queueRef.current;
  const failures = useRef(0);
  const nextAttemptAt = useRef(0);
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Give session-less events (tracked before login) the current session. */
  const adoptOrphans = useCallback(
    (sid: string | null) => {
      if (!sid) return;
      queue.update((q) =>
        q.sid ? q : { sid, event: { ...q.event, clientSeq: nextSeq('activity', sid) } },
      );
    },
    [queue],
  );

  // Keep ref in sync with state
  useEffect(() => {
    sessionIdRef.current = sessionId;
    adoptOrphans(sessionId);
    if (sessionId) noteInput(sessionId, Date.now(), true);
  }, [sessionId, adoptOrphans]);

  // Listen for session changes dispatched by initActivitySession / clearActivitySession.
  // Queued events keep their own session (logout flushes them first, see
  // ACTIVITY_FLUSH_EVENT); anything still queued is sent later with it.
  useEffect(() => {
    const handler = () => {
      const next = sessionStorage.getItem(SESSION_KEY);
      sessionIdRef.current = next;
      setSessionId(next);
    };
    window.addEventListener(SESSION_CHANGE_EVENT, handler);
    return () => window.removeEventListener(SESSION_CHANGE_EVENT, handler);
  }, []);

  // ── New session after T2 idle; one session across tabs (sessionSync) ────
  const rolling = useRef(false);
  const rollover = useCallback(
    async (previous: string) => {
      if (rolling.current) return;
      rolling.current = true;
      sessionIdRef.current = null; // events tracked meanwhile join the new session
      try {
        const res = await fetch('/api/activity-log/session/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({ previousSessionId: previous }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as { sessionId: string; idleTimeoutMs?: number };
        setIdleTimeoutMs(j.idleTimeoutMs);
        noteInput(j.sessionId, Date.now(), true);
        initActivitySession(j.sessionId);
      } catch {
        sessionIdRef.current = previous; // try again on the next input
      } finally {
        rolling.current = false;
      }
    },
    [getToken],
  );

  useEffect(() => {
    let lastCheck = 0;
    const onInput = () => {
      const now = Date.now();
      if (now - lastCheck < 1_000) return;
      lastCheck = now;
      const sid = sessionIdRef.current;
      if (!sid || rolling.current) return;
      const d = decideOnInput(sid, now);
      if (d.kind === 'rollover') {
        void rollover(d.previous);
        return;
      }
      if (d.kind === 'join') initActivitySession(d.sid);
      noteInput(d.kind === 'join' ? d.sid : sid, now);
    };
    const opts = { capture: true, passive: true } as const;
    const kinds = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove', 'scroll'];
    for (const k of kinds) window.addEventListener(k, onInput, opts);
    return () => {
      for (const k of kinds) window.removeEventListener(k, onInput, opts);
    };
  }, [rollover]);

  // ── Send queued events ───────────────────────────────────────────────────
  /** Sends what is queued; returns true when everything sent was accepted. */
  const send = useCallback(
    async (keepalive: boolean): Promise<boolean> => {
      const token = getToken();
      if (!token) return false;
      const items = queue.take(Infinity, (q) => q.sid !== null);
      if (items.length === 0) return true;
      const bySession = new Map<string, Queued[]>();
      for (const q of items) bySession.set(q.sid!, [...(bySession.get(q.sid!) ?? []), q]);
      let ok = true;
      for (const [sid, list] of bySession) {
        for (const batch of chunk(list, keepalive ? MAX_KEEPALIVE_BYTES : Infinity)) {
          const overflow = queue.takeOverflow();
          try {
            const res = await fetch(API_BATCH_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                'X-Session-Id': sid,
              },
              body: JSON.stringify({
                sessionId: sid,
                events: batch.map((q) => q.event),
                appBuild: APP_BUILD,
                ...(overflow ? { overflow } : {}),
              }),
              keepalive,
            });
            if (res.ok) {
              queue.ack(batch);
              // The server keeps the valid events and records the rest (CAP-41).
              const r = (await res.json().catch(() => null)) as {
                rejected?: number;
                failed?: number;
              } | null;
              if (r && ((r.rejected ?? 0) > 0 || (r.failed ?? 0) > 0)) {
                console.warn('[ActivityLog] some events not stored:', r);
              }
              continue;
            }
            const detail = await res.text().catch(() => '');
            if (isPermanentRejection(res.status)) {
              console.warn('[ActivityLog] batch rejected, dropped:', res.status, detail);
              queue.ack(batch);
            } else {
              console.warn('[ActivityLog] batch flush failed:', res.status, detail);
              queue.release(batch);
              queue.restoreOverflow(overflow);
              ok = false;
            }
          } catch {
            queue.release(batch); // network error: keep for the next flush
            queue.restoreOverflow(overflow);
            ok = false;
          }
        }
      }
      return ok;
    },
    [getToken, queue],
  );

  /** Flush unless backing off; `force` (logout, manual flush) ignores the back-off. */
  const flushNow = useCallback(
    async (force: boolean) => {
      queue.adoptAbandoned(); // queues of page loads that have closed since
      if (queue.length === 0) return;
      if (!force && Date.now() < nextAttemptAt.current) return;
      const ok = await send(false);
      failures.current = ok ? 0 : failures.current + 1;
      nextAttemptAt.current = Date.now() + backoffMs(failures.current);
    },
    [queue, send],
  );

  const flush = useCallback(() => flushNow(true), [flushNow]);

  // ── Track a single event ─────────────────────────────────────────────────
  const track = useCallback(
    (action: ActivityAction, extras: Omit<ActivityEvent, 'action' | 'occurredAt'> = {}) => {
      const sid = sessionIdRef.current;
      queue.push({
        sid,
        event: {
          action,
          occurredAt: new Date().toISOString(),
          ...extras,
          clientEventId: newEventId(),
          tabId: TAB_ID,
          ...(sid ? { clientSeq: nextSeq('activity', sid) } : {}),
        },
      });
    },
    [queue],
  );

  // ── Start flush timer ────────────────────────────────────────────────────
  useEffect(() => {
    flushTimer.current = setInterval(() => void flushNow(false), FLUSH_INTERVAL_MS);
    // Events left from an earlier page load (closed tab, crash, offline).
    void flushNow(false);
    return () => {
      if (flushTimer.current) clearInterval(flushTimer.current);
    };
  }, [flushNow]);

  // ── Flush on hide / unload (keepalive fetch) ────────────────────────────
  // The queue is written to localStorage first, so whatever the keepalive
  // request doesn't deliver is sent from the next page load.
  useEffect(() => {
    const handleUnload = () => {
      queue.persistNow();
      if (queue.length > 0) void send(true);
    };
    // Closed or navigated away: if nothing follows, the session's close
    // reason is tab_closed (Prompt B, P2). A reload is followed by events.
    const handlePageHide = () => {
      track('PAGE_LEFT', { metadata: { path: window.location.pathname } });
      handleUnload();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') handleUnload();
    };

    // Logout: AuthContext waits for this before closing the session, so the
    // last events are parsed with it.
    const handleFlushRequest = (e: Event) => {
      const waits = (e as CustomEvent<Promise<void>[]>).detail;
      const p = flush();
      if (Array.isArray(waits)) waits.push(p);
    };

    // Back online: send what queued up while offline.
    const handleOnline = () => void flush();

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener(ACTIVITY_FLUSH_EVENT, handleFlushRequest);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener(ACTIVITY_FLUSH_EVENT, handleFlushRequest);
      window.removeEventListener('online', handleOnline);
    };
  }, [send, flush, queue, track]);

  return (
    <ActivityLogContext.Provider value={{ sessionId, track, flush }}>
      {children}
    </ActivityLogContext.Provider>
  );
}

export function useActivityLog() {
  return useContext(ActivityLogContext);
}

/**
 * Call this after a successful login to register the sessionId.
 */
export function initActivitySession(sid: string) {
  sessionStorage.setItem(SESSION_KEY, sid);
  window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
}

/**
 * Call this on logout.
 */
export function clearActivitySession() {
  sessionStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
}
