/**
 * Laptop/desktop only (study requirement): phones and tablets cannot share
 * a browser tab, are not where the course was validated, and change how the
 * timed puzzles and eye tracking behave.
 */
export type BlockedDevice = 'phone' | 'tablet';

export interface DeviceSignals {
  userAgent: string;
  maxTouchPoints: number;
  /** some input can point precisely (mouse or trackpad): `(any-pointer: fine)` */
  finePointer: boolean;
}

export function blockedDevice({
  userAgent: ua,
  maxTouchPoints,
  finePointer,
}: DeviceSignals): BlockedDevice | null {
  if (/iPhone|iPod|Windows Phone|Android.+Mobile|Mobile Safari|\bMobile\b/i.test(ua)) {
    // iPadOS Safari also says "Mobile": tell it apart below.
    if (!/iPad/i.test(ua)) return 'phone';
  }
  if (/iPad|Android|Tablet|Silk|Kindle|PlayBook/i.test(ua)) return 'tablet';
  // iPadOS 13+ presents itself as a Mac; only the touch screen gives it away.
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return 'tablet';
  // Any other touch-only device (no mouse or trackpad).
  if (maxTouchPoints > 0 && !finePointer) return 'tablet';
  return null;
}

export function currentDeviceSignals(): DeviceSignals {
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    finePointer: window.matchMedia?.('(any-pointer: fine)').matches ?? true,
  };
}
