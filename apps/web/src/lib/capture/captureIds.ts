/**
 * Ids that make capture checkable (Prompt B, B2/B4).
 *
 * TAB_ID identifies this page load: a reload or a second tab gets a new one.
 * Each stream numbers its rows 1, 2, 3, ... per session and page load, so a
 * missing number on the server is a lost row (capture_quality, kind `gap`).
 */

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 from getRandomValues (older browsers).
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const newEventId = uuid;

/** This page load. */
export const TAB_ID: string = uuid();

/** The web build, for the activity envelope. */
export const APP_BUILD: string = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';

const counters = new Map<string, number>();

/** Next sequence number for a stream in a session, in this page load. */
export function nextSeq(stream: string, sessionId: string): number {
  const key = `${stream}|${sessionId}`;
  const n = (counters.get(key) ?? 0) + 1;
  counters.set(key, n);
  return n;
}
