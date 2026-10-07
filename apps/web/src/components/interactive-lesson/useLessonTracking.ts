import { useCallback, useEffect, useRef } from 'react';
import type { LessonSlide } from '@ats/shared';
import { useActivityLog } from '../../lib/activity-log';
import type { ActivityAction } from '../../lib/activity-log/types';
import {
  LIBRARY_VERSION,
  commitKey,
  mapLessonEvent,
  revealCommitKey,
  type LessonEventName,
} from './lessonEvents';

/**
 * Raw-action layer for interactive lessons (plan Phase 2): slide enter/exit
 * with dwell, idle start/end, and the course's own events, all emitted
 * through the existing activity-log `track()` spine.
 *
 * Dwell counts only *active* time: the clock pauses while the tab is hidden
 * and, retroactively from the last input, once the learner has been idle
 * for `idleMs` (workbook T_idle, default 120 s). Capture failures never
 * block the learner — everything here is best-effort and wrapped.
 */

export interface LessonTrackingOptions {
  enabled: boolean;
  itemId: string;
  courseId?: string;
  moduleId?: string;
  idleMs?: number;
  captureText?: boolean;
}

interface CurrentSlide {
  key: string;
  type: string;
  enteredAt: number; // performance.now()
  activeMs: number;
  segStart: number | null; // start of the running active segment
  maxVisiblePct: number;
}

const VISITS_KEY = (itemId: string) => `gals.interactiveLesson.visits.${itemId}`;
const ACTIVITY_EVENTS = [
  'pointerdown',
  'keydown',
  'wheel',
  'touchstart',
  'mousemove',
  'scroll',
] as const;

function loadVisits(itemId: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(VISITS_KEY(itemId)) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

export function useLessonTracking({
  enabled,
  itemId,
  courseId,
  moduleId,
  idleMs = 120_000,
  captureText = false,
}: LessonTrackingOptions) {
  const { track } = useActivityLog();
  const current = useRef<CurrentSlide | null>(null);
  const visits = useRef<Record<string, number>>({});
  const commits = useRef<Map<string, number>>(new Map());
  const lastActivity = useRef(performance.now());
  const idleSince = useRef<number | null>(null);
  // Exit/enter pairs often share a millisecond; `seq` (monotonic per page
  // load) gives the parser an unambiguous order within a session.
  const seq = useRef(0);
  const opts = useRef({ enabled, itemId, courseId, moduleId, captureText });
  opts.current = { enabled, itemId, courseId, moduleId, captureText };

  const send = useCallback(
    (action: ActivityAction, metadata: Record<string, unknown>) => {
      const o = opts.current;
      if (!o.enabled) return;
      try {
        track(action, {
          courseId: o.courseId,
          moduleId: o.moduleId,
          moduleItemId: o.itemId,
          metadata: { ...metadata, seq: ++seq.current },
        });
      } catch (err) {
        console.warn('[InteractiveLesson] track failed', err);
      }
    },
    [track],
  );

  const pause = (at: number) => {
    const c = current.current;
    if (c && c.segStart != null) {
      c.activeMs += Math.max(0, at - c.segStart);
      c.segStart = null;
    }
  };
  const resume = () => {
    const c = current.current;
    if (c && c.segStart == null && !document.hidden && idleSince.current == null)
      c.segStart = performance.now();
  };
  const activeMsNow = () => {
    const c = current.current;
    if (!c) return 0;
    return c.activeMs + (c.segStart != null ? performance.now() - c.segStart : 0);
  };

  const exitSlide = useCallback(
    (reason: string) => {
      const c = current.current;
      if (!c) return;
      pause(performance.now());
      send('SLIDE_EXITED', {
        slideKey: c.key,
        slideType: c.type,
        libraryVersion: LIBRARY_VERSION,
        dwellMs: Math.round(c.activeMs),
        elapsedMs: Math.round(performance.now() - c.enteredAt),
        maxVisiblePct: Math.round(c.maxVisiblePct),
        exitReason: reason,
      });
      current.current = null;
    },
    [send],
  );

  const enterSlide = useCallback(
    (slide: LessonSlide) => {
      if (current.current?.key === slide.key) return;
      exitSlide('navigate');
      const visitNo = (visits.current[slide.key] ?? 0) + 1;
      visits.current[slide.key] = visitNo;
      try {
        localStorage.setItem(VISITS_KEY(opts.current.itemId), JSON.stringify(visits.current));
      } catch {
        // convenience only — the parser recomputes visitNo server-side
      }
      const now = performance.now();
      current.current = {
        key: slide.key,
        type: slide.t,
        enteredAt: now,
        activeMs: 0,
        segStart: document.hidden || idleSince.current != null ? null : now,
        maxVisiblePct: 0,
      };
      send('SLIDE_ENTERED', {
        slideKey: slide.key,
        slideType: slide.t,
        libraryVersion: LIBRARY_VERSION,
        visitNo,
      });
    },
    [exitSlide, send],
  );

  /** Reports the slide's current visible share (IntersectionObserver). */
  const reportVisible = useCallback((slideKey: string, pct: number) => {
    const c = current.current;
    if (c && c.key === slideKey && pct > c.maxVisiblePct) c.maxVisiblePct = pct;
  }, []);

  const emit = useCallback(
    (slide: LessonSlide, name: LessonEventName, data: Record<string, unknown> = {}) => {
      try {
        const now = performance.now();
        const ck = commitKey(name, slide.key, data);
        if (ck) commits.current.set(ck, now);
        const rk = revealCommitKey(name, slide.key, data);
        const committedAt = rk ? commits.current.get(rk) : undefined;
        const c = current.current;
        const mapped = mapLessonEvent(name, data, {
          slideKey: slide.key,
          slideType: slide.t,
          msOnSlide: activeMsNow(),
          msSinceEnter: c ? now - c.enteredAt : 0,
          msSinceCommit: committedAt != null ? Math.round(now - committedAt) : null,
          captureText: opts.current.captureText,
        });
        if (mapped) send(mapped.action, mapped.metadata);
      } catch (err) {
        console.warn('[InteractiveLesson] emit failed', name, err);
      }
    },
    [send],
  );

  // Reset per item; close the open slide on unmount / item change.
  useEffect(() => {
    visits.current = loadVisits(itemId);
    commits.current = new Map();
    return () => exitSlide('unmount');
  }, [itemId, exitSlide]);

  // Visibility, page lifecycle and idle detection.
  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => (document.hidden ? pause(performance.now()) : resume());
    // Capture phase so this runs before ActivityLogProvider's own pagehide
    // flush, which then carries the SLIDE_EXITED out with keepalive.
    const onPageHide = () => exitSlide('pagehide');
    const onActivity = () => {
      const now = performance.now();
      lastActivity.current = now;
      if (idleSince.current != null) {
        const idleFor = now - idleSince.current;
        idleSince.current = null;
        send('IDLE_ENDED', {
          slideKey: current.current?.key ?? null,
          libraryVersion: LIBRARY_VERSION,
          idleMs: Math.round(idleFor),
        });
        resume();
      }
    };
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (idleSince.current == null && now - lastActivity.current >= idleMs) {
        idleSince.current = lastActivity.current;
        pause(lastActivity.current); // retroactive: idle began at the last input
        send('IDLE_STARTED', {
          slideKey: current.current?.key ?? null,
          libraryVersion: LIBRARY_VERSION,
          idleThresholdMs: idleMs,
        });
      }
    }, 5_000);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide, { capture: true });
    for (const ev of ACTIVITY_EVENTS)
      document.addEventListener(ev, onActivity, { capture: true, passive: true });
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide, { capture: true });
      for (const ev of ACTIVITY_EVENTS)
        document.removeEventListener(ev, onActivity, { capture: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, idleMs, exitSlide, send]);

  return { enterSlide, emit, reportVisible };
}
