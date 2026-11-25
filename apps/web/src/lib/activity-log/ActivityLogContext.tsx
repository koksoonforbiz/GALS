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

/** Split into batches the server (≤500 events) and, for keepalive, the browser accept. */
function chunk(events: ActivityEvent[], maxBytes: number): ActivityEvent[][] {
  const out: ActivityEvent[][] = [];
  let cur: ActivityEvent[] = [];
  let bytes = 0;
  for (const e of events) {
    const size = JSON.stringify(e).length + 1;
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

/** A 4xx other than auth/timeout/rate-limit will fail again: drop it rather than block the queue. */
function isPermanentRejection(status: number): boolean {
  return status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status);
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
  const buffer = useRef<ActivityEvent[]>([]);
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Listen for session changes dispatched by initActivitySession / clearActivitySession
  useEffect(() => {
    const handler = () => {
      const next = sessionStorage.getItem(SESSION_KEY);
      // Events belong to the session they happened in: never carry them
      // into the next login (logout flushes them first, see ACTIVITY_FLUSH_EVENT).
      if (next !== sessionIdRef.current) buffer.current = [];
      sessionIdRef.current = next;
      setSessionId(next);
    };
    window.addEventListener(SESSION_CHANGE_EVENT, handler);
    return () => window.removeEventListener(SESSION_CHANGE_EVENT, handler);
  }, []);

  // ── Flush buffer to API ──────────────────────────────────────────────────
  const send = useCallback(
    async (events: ActivityEvent[], keepalive: boolean) => {
      const sid = sessionIdRef.current;
      const token = getToken();
      if (!sid || !token) return events;
      const failed: ActivityEvent[] = [];
      for (const batch of chunk(events, keepalive ? MAX_KEEPALIVE_BYTES : Infinity)) {
        try {
          const res = await fetch(API_BATCH_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
              'X-Session-Id': sid,
            },
            body: JSON.stringify({ sessionId: sid, events: batch }),
            keepalive,
          });
          if (res.ok) {
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
          } else {
            console.warn('[ActivityLog] batch flush failed:', res.status, detail);
            failed.push(...batch);
          }
        } catch {
          failed.push(...batch); // network error: keep for the next flush
        }
      }
      return failed;
    },
    [getToken],
  );

  const flush = useCallback(async () => {
    if (!sessionIdRef.current || buffer.current.length === 0) return;
    const events = buffer.current;
    buffer.current = [];
    const failed = await send(events, false);
    if (failed.length) buffer.current = [...failed, ...buffer.current];
  }, [send]);

  // ── Track a single event ─────────────────────────────────────────────────
  const track = useCallback(
    (action: ActivityAction, extras: Omit<ActivityEvent, 'action' | 'occurredAt'> = {}) => {
      console.log('[ActivityLog] track:', action, 'buffer size:', buffer.current.length + 1);
      buffer.current.push({
        action,
        occurredAt: new Date().toISOString(),
        ...extras,
      });
    },
    [],
  );

  // ── Start flush timer ────────────────────────────────────────────────────
  useEffect(() => {
    flushTimer.current = setInterval(flush, FLUSH_INTERVAL_MS);
    return () => {
      if (flushTimer.current) clearInterval(flushTimer.current);
    };
  }, [flush]);

  // ── Flush on hide / unload (keepalive fetch) ────────────────────────────
  // Take the buffer before sending: re-sending it on every tab switch
  // without clearing it duplicated rows in the raw log.
  useEffect(() => {
    const handleUnload = () => {
      if (!sessionIdRef.current || buffer.current.length === 0) return;
      const events = buffer.current;
      buffer.current = [];
      void send(events, true).then((failed) => {
        if (failed.length) buffer.current = [...failed, ...buffer.current];
      });
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

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener(ACTIVITY_FLUSH_EVENT, handleFlushRequest);
    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handleUnload);
      window.removeEventListener(ACTIVITY_FLUSH_EVENT, handleFlushRequest);
    };
  }, [send, flush]);

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
