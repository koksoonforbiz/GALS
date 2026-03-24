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
}

const ActivityLogContext = createContext<ActivityLogContextValue>({
  sessionId: null,
  track: () => {},
});

const SESSION_KEY = 'ats_session_id';
const SESSION_CHANGE_EVENT = 'ats_session_change';
const FLUSH_INTERVAL_MS = 30_000; // 30 seconds
const API_BATCH_URL = '/api/activity-log/batch';

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
      setSessionId(sessionStorage.getItem(SESSION_KEY));
    };
    window.addEventListener(SESSION_CHANGE_EVENT, handler);
    return () => window.removeEventListener(SESSION_CHANGE_EVENT, handler);
  }, []);

  // ── Flush buffer to API ──────────────────────────────────────────────────
  const flush = useCallback(async () => {
    if (!sessionIdRef.current || buffer.current.length === 0) return;
    const events = [...buffer.current];
    buffer.current = [];

    try {
      const token = getToken();
      if (!token) {
        buffer.current = [...events, ...buffer.current];
        return;
      }
      const res = await fetch(API_BATCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Session-Id': sessionIdRef.current,
        },
        body: JSON.stringify({ sessionId: sessionIdRef.current, events }),
      });
      if (!res.ok) {
        console.warn(
          '[ActivityLog] batch flush failed:',
          res.status,
          await res.text().catch(() => ''),
        );
        buffer.current = [...events, ...buffer.current];
      }
    } catch {
      // Silently restore events to the buffer so they aren't lost
      buffer.current = [...events, ...buffer.current];
    }
  }, [getToken]);

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

  // ── Flush on page unload (sendBeacon for reliability) ───────────────────
  useEffect(() => {
    const handleUnload = () => {
      if (!sessionIdRef.current || buffer.current.length === 0) return;
      const token = getToken();
      if (!token) return;
      const payload = JSON.stringify({
        sessionId: sessionIdRef.current,
        events: buffer.current,
      });
      fetch(API_BATCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') handleUnload();
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handleUnload);
    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handleUnload);
    };
  }, [getToken]);

  return (
    <ActivityLogContext.Provider value={{ sessionId, track }}>
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
