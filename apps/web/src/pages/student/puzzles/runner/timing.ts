import { useEffect, useRef } from 'react';

/** Monotonic milliseconds (performance.now()). */
export const now = () => performance.now();

/**
 * Resolve with the timestamp of the frame after the next paint (double
 * rAF): the moment a DOM change is actually on screen. Stimulus onsets and
 * offsets are measured with this, not with setTimeout.
 */
export function afterPaint(): Promise<number> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame((t) => resolve(t))),
  );
}

/** Wait until performance.now() reaches `target` (rAF-aligned). */
export function untilTime(target: number): Promise<number> {
  return new Promise((resolve) => {
    const tick = (t: number) => (t >= target - 8 ? resolve(t) : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });
}

/**
 * Milliseconds the page was hidden or unfocused since `reset()`. Logged per
 * trial (spec: focus loss during timed trials is recorded, not prevented).
 */
export function useFocusLoss() {
  const lost = useRef(0);
  const since = useRef<number | null>(document.hidden || !document.hasFocus() ? now() : null);
  useEffect(() => {
    const away = () => {
      if (since.current == null) since.current = now();
    };
    const back = () => {
      if (since.current != null) {
        lost.current += now() - since.current;
        since.current = null;
      }
    };
    const vis = () => (document.hidden ? away() : back());
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('blur', away);
    window.addEventListener('focus', back);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('blur', away);
      window.removeEventListener('focus', back);
    };
  }, []);
  return {
    take(): number {
      const open = since.current != null ? now() - since.current : 0;
      if (since.current != null) since.current = now();
      const v = Math.round(lost.current + open);
      lost.current = 0;
      return v;
    },
  };
}
