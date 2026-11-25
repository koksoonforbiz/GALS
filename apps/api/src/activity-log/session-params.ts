/**
 * Session thresholds (Prompt B, P2; PI decision 2026-11-25), versioned so
 * each session records which values cut it.
 *
 *   T_idle  120 s  a pause inside a lesson counts as idle time (lesson tracker)
 *   T1      5 min  a break within a session (analysis)
 *   T2     30 min  no learner input for this long closes the session; the
 *                  next input starts a new session linked to it
 *
 * Learner input = activity events (except heartbeats and server bookkeeping),
 * clicks, keystrokes, scrolling and cursor movement. A tab that is open but
 * untouched (only periodic replay snapshots) is idle.
 *
 * Change a value => bump `version`. SESSION_T2_MS overrides T2 (tests).
 */
export const SESSION_PARAMS = {
  version: 'session-v1',
  T_idle_ms: 120_000,
  T1_ms: 5 * 60_000,
  T2_ms: Number(process.env.SESSION_T2_MS) || 30 * 60_000,
} as const;

/** Activity actions that are not learner input (they never keep a session open). */
export const NON_INPUT_ACTIONS = ['SESSION_START', 'SESSION_END', 'SESSION_HEARTBEAT'] as const;

/** Close reasons stored on student_sessions.close_reason. */
export type CloseReason = 'logout' | 'explicit' | 'idle_timeout' | 'tab_closed';

/**
 * Groups sessions for post-analysis: same learner, same course, same
 * calendar day in Singapore. Topic-level grouping (module item, slide) is
 * done from the events themselves.
 */
export function episodeKey(userId: string, courseId: string | null, at: Date): string {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
  return `${userId}|${courseId ?? '-'}|${day}`;
}
