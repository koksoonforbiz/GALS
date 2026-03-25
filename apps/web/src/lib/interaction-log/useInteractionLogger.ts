import { useEffect, useRef, useCallback } from 'react';
import { api } from '../api';

const API_BASE = '/api';
const FLUSH_INTERVAL_MS = 30_000;
const CURSOR_THROTTLE_MS = 100;
const SCROLL_THROTTLE_MS = 200;
const RESIZE_DEBOUNCE_MS = 500;

interface UseInteractionLoggerParams {
  sessionId: string;
  userId: string;
  enabled?: boolean;
}

// ─── Helpers ────────────────────────────────────────────

function buildElementTarget(el: EventTarget | null): string {
  if (!el || !(el instanceof HTMLElement)) return 'unknown';
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  if (el.className && typeof el.className === 'string') {
    const first = el.className.split(/\s+/)[0];
    if (first) return `${tag}.${first}`;
  }
  return tag;
}

function buildCssSelector(el: EventTarget | null): string {
  if (!el || !(el instanceof HTMLElement)) return 'unknown';
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  if (el.className && typeof el.className === 'string') {
    const first = el.className.split(/\s+/)[0];
    if (first) return `${tag}.${first}`;
  }
  return tag;
}

function computeScrollPercent(): number {
  const scrollY = window.scrollY;
  const maxScroll = Math.max(1, document.body.scrollHeight - window.innerHeight);
  return Math.min(100, Math.max(0, (scrollY / maxScroll) * 100));
}

function getTop10Resources(): object[] {
  try {
    return performance
      .getEntriesByType('resource')
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10)
      .map((r) => ({ name: r.name.slice(-100), duration: Math.round(r.duration) }));
  } catch {
    return [];
  }
}

function sendBeacon(path: string, body: object) {
  try {
    const token = localStorage.getItem('token');
    // sendBeacon can't set Authorization header, fall back to fetch with keepalive
    fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Swallow errors on unload
  }
}

// ─── Hook ───────────────────────────────────────────────

export function useInteractionLogger({
  sessionId,
  userId,
  enabled = true,
}: UseInteractionLoggerParams): { flushAll: () => Promise<void> } {
  const cursorBuffer = useRef<any[]>([]);
  const clickBuffer = useRef<any[]>([]);
  const scrollBuffer = useRef<any[]>([]);
  const keystrokeBuffer = useRef<any[]>([]);

  // Keystroke tracking state
  const keystrokeState = useRef<
    Map<string, { count: number; lastTime: number; longestGap: number; startTime: number }>
  >(new Map());

  // Visibility tracking
  const hiddenAt = useRef<number>(0);

  // Throttle refs
  const lastCursorTime = useRef(0);
  const lastScrollTime = useRef(0);
  const resizeTimer = useRef<ReturnType<typeof setTimeout>>();

  const flush = useCallback(
    async (path: string, buffer: React.MutableRefObject<any[]>, useBeacon = false) => {
      if (buffer.current.length === 0) return;
      const events = buffer.current.splice(0);
      const body = { sessionId, userId, events };
      if (useBeacon) {
        sendBeacon(path, body);
      } else {
        try {
          await api.post(path, body);
        } catch {
          // Re-add events on failure so next flush retries
          buffer.current.unshift(...events);
        }
      }
    },
    [sessionId, userId],
  );

  const flushAll = useCallback(
    async (useBeacon = false) => {
      await Promise.all([
        flush('/logs/cursor', cursorBuffer, useBeacon),
        flush('/logs/clicks', clickBuffer, useBeacon),
        flush('/logs/scroll', scrollBuffer, useBeacon),
        flush('/logs/keystrokes', keystrokeBuffer, useBeacon),
      ]);
    },
    [flush],
  );

  useEffect(() => {
    if (!enabled || !sessionId || !userId) return;

    // ─── Initialisation ───────────────────────────────

    const wallClockMs = Date.now();
    const monotonicMs = Math.round(performance.now());

    api
      .post('/logs/sync-anchor', {
        sessionId,
        userId,
        wallClockMs,
        monotonicMs,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        userAgent: navigator.userAgent,
      })
      .catch(() => {});

    // Initial viewport
    api
      .post('/logs/viewport', {
        sessionId,
        userId,
        width: window.innerWidth,
        height: window.innerHeight,
        orientation: screen.orientation?.type ?? 'unknown',
        timestamp: Date.now(),
      })
      .catch(() => {});

    // Performance observer
    try {
      const perfObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length > 0) {
          const entry = entries[0] as PerformanceNavigationTiming;
          api
            .post('/logs/performance', {
              sessionId,
              userId,
              pageUrl: window.location.pathname,
              pageLoadMs: Math.round(entry.loadEventEnd - entry.startTime),
              resourceTimingsJson: getTop10Resources(),
              timestamp: Date.now(),
            })
            .catch(() => {});
          perfObserver.disconnect();
        }
      });
      perfObserver.observe({ type: 'navigation', buffered: true });
    } catch {
      // PerformanceObserver not supported
    }

    // ─── Collector 1: Cursor Movement ─────────────────

    const onMouseMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastCursorTime.current < CURSOR_THROTTLE_MS) return;
      lastCursorTime.current = now;
      cursorBuffer.current.push({
        x: e.clientX,
        y: e.clientY,
        pageUrl: window.location.pathname,
        elementTarget: buildElementTarget(e.target),
        timestamp: now,
      });
    };
    window.addEventListener('mousemove', onMouseMove);

    // ─── Collector 2: Click Tracker ───────────────────

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      clickBuffer.current.push({
        x: e.clientX,
        y: e.clientY,
        pageUrl: window.location.pathname,
        elementSelector: buildCssSelector(target),
        elementText: (target?.innerText || '').slice(0, 50),
        timestamp: Date.now(),
      });
    };
    window.addEventListener('click', onClick, true);

    // ─── Collector 3: Scroll Tracker ──────────────────

    const onScroll = () => {
      const now = Date.now();
      if (now - lastScrollTime.current < SCROLL_THROTTLE_MS) return;
      lastScrollTime.current = now;
      scrollBuffer.current.push({
        scrollY: window.scrollY,
        scrollPercent: computeScrollPercent(),
        pageUrl: window.location.pathname,
        timestamp: now,
      });
    };
    window.addEventListener('scroll', onScroll);

    // ─── Collector 4: Keystroke Metrics ───────────────

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA')) return;
      const fieldId =
        (target as HTMLInputElement).id ||
        (target as HTMLInputElement).name ||
        `field_${target.tagName}_${Array.from(target.parentElement?.children ?? []).indexOf(target)}`;
      const now = Date.now();
      const state = keystrokeState.current.get(fieldId) || {
        count: 0,
        lastTime: now,
        longestGap: 0,
        startTime: now,
      };
      const gap = now - state.lastTime;
      if (gap > state.longestGap && state.count > 0) state.longestGap = gap;
      state.count++;
      state.lastTime = now;
      keystrokeState.current.set(fieldId, state);
    };

    const onBlur = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA')) return;
      const fieldId =
        (target as HTMLInputElement).id ||
        (target as HTMLInputElement).name ||
        `field_${target.tagName}_${Array.from(target.parentElement?.children ?? []).indexOf(target)}`;
      const state = keystrokeState.current.get(fieldId);
      if (!state || state.count === 0) return;
      const durationSec = Math.max(0.001, (Date.now() - state.startTime) / 1000);
      const estimatedWords = state.count / 5;
      const wpm = (estimatedWords / durationSec) * 60;
      keystrokeBuffer.current.push({
        fieldId,
        keystrokeCount: state.count,
        pauseDurationMs: state.longestGap,
        typingSpeedWPM: Math.round(wpm * 10) / 10,
        timestamp: Date.now(),
      });
      keystrokeState.current.delete(fieldId);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('blur', onBlur, true);

    // ─── Collector 5: Page Visibility ─────────────────

    const onVisibilityChange = () => {
      const now = Date.now();
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = now;
        api
          .post('/logs/visibility', {
            sessionId,
            userId,
            events: [
              {
                visibleState: 'hidden',
                pageUrl: window.location.pathname,
                timestamp: now,
                hiddenDurationMs: null,
              },
            ],
          })
          .catch(() => {});
      } else {
        const duration = hiddenAt.current ? now - hiddenAt.current : null;
        api
          .post('/logs/visibility', {
            sessionId,
            userId,
            events: [
              {
                visibleState: 'visible',
                pageUrl: window.location.pathname,
                timestamp: now,
                hiddenDurationMs: duration,
              },
            ],
          })
          .catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // ─── Collector 6: Clipboard Tracker ───────────────

    const onCopy = (e: ClipboardEvent) => {
      api
        .post('/logs/clipboard', {
          sessionId,
          userId,
          events: [
            {
              action: 'copy',
              textLength: window.getSelection()?.toString().length ?? 0,
              sourceElement: buildElementTarget(e.target),
              pageUrl: window.location.pathname,
              timestamp: Date.now(),
            },
          ],
        })
        .catch(() => {});
    };
    const onCut = (e: ClipboardEvent) => {
      api
        .post('/logs/clipboard', {
          sessionId,
          userId,
          events: [
            {
              action: 'cut',
              textLength: window.getSelection()?.toString().length ?? 0,
              sourceElement: buildElementTarget(e.target),
              pageUrl: window.location.pathname,
              timestamp: Date.now(),
            },
          ],
        })
        .catch(() => {});
    };
    const onPaste = (e: ClipboardEvent) => {
      api
        .post('/logs/clipboard', {
          sessionId,
          userId,
          events: [
            {
              action: 'paste',
              textLength: e.clipboardData?.getData('text').length ?? 0,
              sourceElement: buildElementTarget(e.target),
              pageUrl: window.location.pathname,
              timestamp: Date.now(),
            },
          ],
        })
        .catch(() => {});
    };
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    window.addEventListener('paste', onPaste);

    // ─── Collector 7: Viewport / Resize ───────────────

    const onResize = () => {
      clearTimeout(resizeTimer.current);
      resizeTimer.current = setTimeout(() => {
        api
          .post('/logs/viewport', {
            sessionId,
            userId,
            width: window.innerWidth,
            height: window.innerHeight,
            orientation: screen.orientation?.type ?? 'unknown',
            timestamp: Date.now(),
          })
          .catch(() => {});
      }, RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    // ─── Collector 8: Error Tracker ───────────────────

    const onError = (
      msg: Event | string,
      _src?: string,
      _line?: number,
      _col?: number,
      err?: Error,
    ) => {
      const errorMessage = err?.message || (typeof msg === 'string' ? msg : 'Unknown error');
      api
        .post('/logs/errors', {
          sessionId,
          userId,
          errorMessage,
          stack: (err?.stack || '').slice(0, 2000),
          pageUrl: window.location.pathname,
          timestamp: Date.now(),
          errorType: 'window_error',
        })
        .catch(() => {});
    };

    const onUnhandledRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      api
        .post('/logs/errors', {
          sessionId,
          userId,
          errorMessage: reason?.message || String(reason),
          stack: (reason?.stack || '').slice(0, 2000),
          pageUrl: window.location.pathname,
          timestamp: Date.now(),
          errorType: 'unhandled_rejection',
        })
        .catch(() => {});
    };

    window.onerror = onError;
    window.onunhandledrejection = onUnhandledRejection;

    // ─── Periodic Flush ───────────────────────────────

    const flushInterval = setInterval(() => {
      flushAll(false);
    }, FLUSH_INTERVAL_MS);

    // ─── Unload Flush ─────────────────────────────────

    const onBeforeUnload = () => {
      flushAll(true);
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    // ─── Cleanup ──────────────────────────────────────

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('blur', onBlur, true);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.removeEventListener('beforeunload', onBeforeUnload);
      clearInterval(flushInterval);
      clearTimeout(resizeTimer.current);
      window.onerror = null;
      window.onunhandledrejection = null;
    };
  }, [enabled, sessionId, userId, flush, flushAll]);

  if (!enabled) {
    return { flushAll: async () => {} };
  }

  return { flushAll: () => flushAll(false) };
}
