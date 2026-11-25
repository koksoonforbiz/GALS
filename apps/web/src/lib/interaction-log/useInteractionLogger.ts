import { useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import { enqueue, flushStreams } from '../capture/streamQueues';

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

/** Typed text and clipboard text are kept up to this many characters. */
const TEXT_CAP = 10_000;
/** A typing burst ends after this pause, on blur, or at MAX_BURST_KEYS keys. */
const BURST_IDLE_MS = 2_000;
const MAX_BURST_KEYS = 500;

type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

/** The text field (input, textarea or rich-text editor) an event happened in. */
function editableOf(el: EventTarget | null): Editable | null {
  if (!(el instanceof HTMLElement)) return null;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return el;
  if (el.isContentEditable) {
    return (el.closest('[contenteditable="true"],[contenteditable=""]') as HTMLElement) ?? el;
  }
  return null;
}

/** Password, one-time-code and payment fields: never record their keys or text. */
function isSensitive(el: Editable): boolean {
  if (el instanceof HTMLInputElement) {
    if (['password', 'hidden'].includes(el.type)) return true;
    const ac = (el.autocomplete || '').toLowerCase();
    if (/(current-password|new-password|one-time-code|cc-)/.test(ac)) return true;
  }
  return el.closest('[data-no-capture]') !== null;
}

function fieldIdOf(el: Editable): string {
  return (
    (el as HTMLInputElement).id ||
    (el as HTMLInputElement).name ||
    el.getAttribute('data-field-id') ||
    `field_${el.tagName}_${Array.from(el.parentElement?.children ?? []).indexOf(el)}`
  );
}

function fieldKindOf(el: Editable): string {
  if (el instanceof HTMLInputElement) return `input:${el.type || 'text'}`;
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  return 'contenteditable';
}

function fieldText(el: Editable): string {
  const v =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : el.innerText;
  return (v ?? '').slice(0, TEXT_CAP);
}

/** Selected text for copy/cut, including a selection inside an input or textarea. */
function selectedText(target: EventTarget | null): string {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const { selectionStart: a, selectionEnd: b, value } = target;
    if (a != null && b != null && b > a) return value.slice(a, b);
  }
  return window.getSelection()?.toString() ?? '';
}

interface Burst {
  el: Editable;
  sensitive: boolean;
  count: number;
  startTime: number;
  lastTime: number;
  longestGap: number;
  keys: Array<{ k: string; t: number }>;
  timer: ReturnType<typeof setTimeout> | null;
}

// ─── Hook ───────────────────────────────────────────────

export function useInteractionLogger({
  sessionId,
  userId,
  enabled = true,
}: UseInteractionLoggerParams): { flushAll: () => Promise<void> } {
  // Typing bursts in progress, per field (Collector 4).
  const keystrokeState = useRef<Map<string, Burst>>(new Map());

  // Visibility tracking
  const hiddenAt = useRef<number>(0);

  // Throttle refs
  const lastCursorTime = useRef(0);
  const lastScrollTime = useRef(0);
  const resizeTimer = useRef<ReturnType<typeof setTimeout>>();

  // Rows wait in persistent per-stream queues (lib/capture/streamQueues.ts)
  // until the server has stored them; this sends them.
  const flushAll = useCallback(async (useBeacon = false) => {
    await flushStreams(useBeacon ? { keepalive: true } : { force: true });
  }, []);

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
      enqueue('cursor', sessionId, userId, {
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
      enqueue('clicks', sessionId, userId, {
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
      enqueue('scroll', sessionId, userId, {
        scrollY: window.scrollY,
        scrollPercent: computeScrollPercent(),
        pageUrl: window.location.pathname,
        timestamp: now,
      });
    };
    window.addEventListener('scroll', onScroll);

    // ─── Collector 4: Keystrokes ──────────────────────
    //
    // One row per typing burst in a field: the keys pressed with their ms
    // offsets, and the field's text when the burst ends (PI decision,
    // 2026-11-25: record keystroke contents). A burst ends after a 2 s
    // pause, on blur, or at 500 keys. Rows are queued and sent with the
    // 30 s batch, never one request per key. Password and one-time-code
    // fields record counts and timings only.

    const endBurst = (fieldId: string) => {
      const b = keystrokeState.current.get(fieldId);
      if (!b) return;
      if (b.timer) clearTimeout(b.timer);
      keystrokeState.current.delete(fieldId);
      if (b.count === 0) return;
      const durationSec = Math.max(0.001, (b.lastTime - b.startTime) / 1000);
      const wpm = (b.count / 5 / durationSec) * 60;
      enqueue('keystrokes', sessionId, userId, {
        fieldId,
        keystrokeCount: b.count,
        pauseDurationMs: b.longestGap,
        typingSpeedWPM: Math.round(wpm * 10) / 10,
        timestamp: b.lastTime,
        burstStart: b.startTime,
        fieldKind: fieldKindOf(b.el),
        ...(b.sensitive ? {} : { keys: b.keys, text: fieldText(b.el) }),
      });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const el = editableOf(e.target);
      if (!el) return;
      const fieldId = fieldIdOf(el);
      const now = Date.now();
      let b = keystrokeState.current.get(fieldId);
      if (!b) {
        b = {
          el,
          sensitive: isSensitive(el),
          count: 0,
          startTime: now,
          lastTime: now,
          longestGap: 0,
          keys: [],
          timer: null,
        };
        keystrokeState.current.set(fieldId, b);
      }
      const gap = now - b.lastTime;
      if (gap > b.longestGap && b.count > 0) b.longestGap = gap;
      b.count++;
      b.lastTime = now;
      if (!b.sensitive) b.keys.push({ k: e.key, t: now - b.startTime });
      if (b.timer) clearTimeout(b.timer);
      if (b.count >= MAX_BURST_KEYS) endBurst(fieldId);
      else b.timer = setTimeout(() => endBurst(fieldId), BURST_IDLE_MS);
    };

    const onBlur = (e: FocusEvent) => {
      const el = editableOf(e.target);
      if (el) endBurst(fieldIdOf(el));
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('blur', onBlur, true);

    // ─── Collector 5: Page Visibility ─────────────────
    //
    // Queued like every stream (retried, deduped); a hidden page also
    // flushes everything with keepalive.

    const postVisibility = (
      visibleState: string,
      timestamp: number,
      hiddenDurationMs: number | null,
    ) =>
      enqueue('visibility', sessionId, userId, {
        visibleState,
        pageUrl: window.location.pathname,
        timestamp,
        hiddenDurationMs,
      });

    const onVisibilityChange = () => {
      const now = Date.now();
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = now;
        for (const id of [...keystrokeState.current.keys()]) endBurst(id);
        postVisibility('hidden', now, null);
        void flushStreams({ keepalive: true });
      } else {
        postVisibility('visible', now, hiddenAt.current ? now - hiddenAt.current : null);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Window focus loss while the tab stays visible (e.g. working side by
    // side with an external AI tool) never fires visibilitychange. Record it
    // as visibleState 'blurred', which aoiScoring.ts already treats as an
    // inattention interval; the next 'visible' row closes it.
    // (Prompting-course plan, PHASE0_DISCOVERY.md §9 #55.)
    const blurredAt = { current: null as number | null };
    const onWindowBlur = () => {
      // Defer: focus moving into an in-page iframe also blurs the window.
      window.setTimeout(() => {
        if (document.visibilityState !== 'visible' || document.hasFocus()) return;
        if (document.activeElement?.tagName === 'IFRAME') return;
        blurredAt.current = Date.now();
        postVisibility('blurred', blurredAt.current, null);
      }, 0);
    };
    const onWindowFocus = () => {
      if (blurredAt.current == null) return;
      const now = Date.now();
      const away = now - blurredAt.current;
      blurredAt.current = null;
      postVisibility('visible', now, away);
    };
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);

    // ─── Collector 6: Clipboard ───────────────────────
    //
    // Copy, cut and paste with their text (PI decision, 2026-11-25), capped
    // at 10,000 characters; textLength is always the full length. Nothing
    // from password fields.

    const clip = (action: 'copy' | 'cut' | 'paste', e: ClipboardEvent, text: string) => {
      const el = editableOf(e.target);
      const sensitive = el ? isSensitive(el) : false;
      enqueue('clipboard', sessionId, userId, {
        action,
        textLength: text.length,
        sourceElement: buildElementTarget(e.target),
        pageUrl: window.location.pathname,
        timestamp: Date.now(),
        ...(sensitive || !text ? {} : { text: text.slice(0, TEXT_CAP) }),
      });
    };
    const onCopy = (e: ClipboardEvent) => clip('copy', e, selectedText(e.target));
    const onCut = (e: ClipboardEvent) => clip('cut', e, selectedText(e.target));
    const onPaste = (e: ClipboardEvent) => clip('paste', e, e.clipboardData?.getData('text') ?? '');
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
      void flushStreams();
    }, FLUSH_INTERVAL_MS);
    // Rows left from an earlier page load (closed tab, crash, offline).
    void flushStreams();

    // ─── Unload Flush ─────────────────────────────────

    const onBeforeUnload = () => {
      for (const id of [...keystrokeState.current.keys()]) endBurst(id);
      void flushStreams({ keepalive: true });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onBeforeUnload);

    // ─── Cleanup ──────────────────────────────────────

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('blur', onBlur, true);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onBeforeUnload);
      for (const id of [...keystrokeState.current.keys()]) endBurst(id);
      clearInterval(flushInterval);
      clearTimeout(resizeTimer.current);
      window.onerror = null;
      window.onunhandledrejection = null;
    };
  }, [enabled, sessionId, userId]);

  if (!enabled) {
    return { flushAll: async () => {} };
  }

  return { flushAll: () => flushAll(false) };
}
