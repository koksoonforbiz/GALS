import { prisma } from '../prisma.js';

/**
 * Researcher-set retained window (crop). Offsets are ms from the session's
 * baseWallClockMs; null = unbounded on that side. The summary and exports
 * reflect only this window so dead head/tail is dropped.
 */
export interface RetainRange {
  startMs: number | null;
  endMs: number | null;
}

export const FULL_RANGE: RetainRange = { startMs: null, endMs: null };

export async function getTrim(sessionId: string): Promise<RetainRange> {
  const t = await prisma.sessionTrim.findUnique({ where: { sessionId } });
  return { startMs: t?.startMs ?? null, endMs: t?.endMs ?? null };
}

/** Load trims for many sessions at once → map of sessionId → range. */
export async function getTrims(sessionIds: string[]): Promise<Map<string, RetainRange>> {
  const rows = await prisma.sessionTrim.findMany({ where: { sessionId: { in: sessionIds } } });
  const m = new Map<string, RetainRange>();
  for (const r of rows) m.set(r.sessionId, { startMs: r.startMs ?? null, endMs: r.endMs ?? null });
  return m;
}

export function isTrimmed(r: RetainRange): boolean {
  return r.startMs != null || r.endMs != null;
}

/** Predicate on an offset-from-base (ms). */
export function offsetInRange(offMs: number, r: RetainRange): boolean {
  if (r.startMs != null && offMs < r.startMs) return false;
  if (r.endMs != null && offMs > r.endMs) return false;
  return true;
}

/** Predicate on an absolute wall-clock ms, given the session base. */
export function wallInRange(base: number, r: RetainRange): (wallMs: number) => boolean {
  const lo = r.startMs != null ? base + r.startMs : -Infinity;
  const hi = r.endMs != null ? base + r.endMs : Infinity;
  return (wallMs: number) => wallMs >= lo && wallMs <= hi;
}

/** Retained span in ms within [0, durationMs]. */
export function retainedDurationMs(durationMs: number, r: RetainRange): number {
  const start = r.startMs != null ? Math.max(0, r.startMs) : 0;
  const end = r.endMs != null ? Math.min(durationMs, r.endMs) : durationMs;
  return Math.max(0, end - start);
}
