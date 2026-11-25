/**
 * One session across tabs, and a new session after 30 minutes idle
 * (Prompt B, P2; PI decision 2026-11-25: "return after 30 mins is a new
 * session").
 *
 * The current session and the time of the last learner input are shared
 * through localStorage, so:
 *   - a second tab joins the open session (its events carry their own
 *     tab id, so analysis can split the tabs);
 *   - the first input after T2 without input in any tab starts a new
 *     session, linked to the previous one (`previousSessionId`);
 *   - when one tab has rolled over, the others follow on their next input.
 * The server applies the same T2 (its sweeper closes idle sessions); it
 * sends the value with every session it opens.
 */
const SHARED_KEY = 'gals.session.shared.v1';
const IDLE_KEY = 'gals.session.idleMs';
const DEFAULT_IDLE_MS = 30 * 60_000;
const WRITE_EVERY_MS = 5_000;

interface Shared {
  sid: string;
  userId: string;
  lastInputAt: number;
}

export function currentUserId(): string | null {
  try {
    return (
      (JSON.parse(localStorage.getItem('user') ?? 'null') as { id?: string } | null)?.id ?? null
    );
  } catch {
    return null;
  }
}

export function idleTimeoutMs(): number {
  const v = Number(sessionStorage.getItem(IDLE_KEY));
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_IDLE_MS;
}

export function setIdleTimeoutMs(ms: unknown): void {
  if (typeof ms === 'number' && ms > 0) sessionStorage.setItem(IDLE_KEY, String(ms));
}

export function readShared(): Shared | null {
  try {
    const s = JSON.parse(localStorage.getItem(SHARED_KEY) ?? 'null') as Shared | null;
    return s && typeof s.sid === 'string' && typeof s.lastInputAt === 'number' ? s : null;
  } catch {
    return null;
  }
}

let lastWrite = 0;

/** Record learner input for the session (throttled), shared with other tabs. */
export function noteInput(sid: string, now = Date.now(), force = false): void {
  const userId = currentUserId();
  if (!userId) return;
  if (!force && now - lastWrite < WRITE_EVERY_MS) return;
  lastWrite = now;
  try {
    localStorage.setItem(SHARED_KEY, JSON.stringify({ sid, userId, lastInputAt: now }));
  } catch {
    // Storage unavailable: each tab then keeps its own session.
  }
}

/** An open session another tab of this learner used within T2, if any. */
export function reusableSession(now = Date.now()): string | null {
  const s = readShared();
  const userId = currentUserId();
  if (!s || !userId || s.userId !== userId) return null;
  return now - s.lastInputAt < idleTimeoutMs() ? s.sid : null;
}

export type InputDecision =
  | { kind: 'same' }
  | { kind: 'join'; sid: string } // another tab's current session
  | { kind: 'rollover'; previous: string }; // T2 passed: start a new session

/** What a learner input means for this tab's session. */
export function decideOnInput(mySid: string | null, now = Date.now()): InputDecision {
  if (!mySid) return { kind: 'same' };
  const s = readShared();
  const userId = currentUserId();
  if (s && userId && s.userId === userId && s.sid !== mySid) {
    // Another tab rolled over (or started) since: follow it while it is live.
    if (now - s.lastInputAt < idleTimeoutMs()) return { kind: 'join', sid: s.sid };
    return { kind: 'rollover', previous: mySid };
  }
  const last = s && s.sid === mySid ? s.lastInputAt : null;
  if (last != null && now - last >= idleTimeoutMs()) return { kind: 'rollover', previous: mySid };
  return { kind: 'same' };
}
