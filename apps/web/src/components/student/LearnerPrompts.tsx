/**
 * Learner prompts that are not tied to one widget (Prompt B, P5d):
 *   goal card (G1)       start of each session, on a course page
 *   progress check (G2)  every 10 min of active time, at most 3 per session
 *   resume prompt (G9)   back after more than 5 min away (T1)
 * Each is logged when shown (AFFORDANCE_SHOWN), answered, or closed without
 * an answer (AFFORDANCE_DISMISSED). Wording approved by the PI (PLAN_B §5).
 * The intention tag is in the chatbot, the confidence slider in practice
 * tests and the end-of-session reflection at sign-out.
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useActivityLog } from '../../lib/activity-log';
import { activeMs, lastInputAt } from '../../lib/capture/activeTime';
import {
  currentCourseId,
  markShown,
  shownThisSession,
  usePromptFlags,
} from '../../lib/capture/learnerPrompts';

const GOALS = ['Finish this lesson', 'Practise what I learned', 'Review for a test'];
const PROGRESS_EVERY_MS = 10 * 60_000;
const MAX_PROGRESS_CHECKS = 3;
const AWAY_MS = 5 * 60_000;

type Shown = 'goal_card' | 'progress_check' | 'resume_prompt' | null;

export function LearnerPrompts() {
  const { track, sessionId } = useActivityLog();
  const location = useLocation();
  const courseId = currentCourseId(location.pathname);
  const flags = usePromptFlags(courseId);
  const [shown, setShown] = useState<Shown>(null);
  const [ownGoal, setOwnGoal] = useState('');
  const shownAt = useRef(0);
  const awayMs = useRef(0);
  const nextProgressAt = useRef(PROGRESS_EVERY_MS);
  const progressCount = useRef(0);

  const open = (p: Exclude<Shown, null>) => {
    shownAt.current = Date.now();
    setShown(p);
    track('AFFORDANCE_SHOWN', { courseId: courseId ?? undefined, metadata: { affordance: p } });
  };
  const close = () => setShown(null);
  const dismiss = () => {
    if (shown) {
      track('AFFORDANCE_DISMISSED', {
        courseId: courseId ?? undefined,
        metadata: { affordance: shown, msShown: Date.now() - shownAt.current },
      });
    }
    close();
  };

  // Goal card: once per session, on the first course page.
  useEffect(() => {
    if (!flags.goal_card || !courseId || shown) return;
    if (!/\/courses\//.test(location.pathname)) return;
    if (shownThisSession(sessionId, 'goal_card')) return;
    markShown(sessionId, 'goal_card');
    open('goal_card');
  }, [flags.goal_card, courseId, sessionId, location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Progress check and resume prompt: checked every 15 s.
  useEffect(() => {
    if (!courseId) return;
    let wasAwaySince: number | null = null;
    const timer = window.setInterval(() => {
      if (shown) return;
      const active = activeMs();
      if (
        flags.progress_check &&
        active >= nextProgressAt.current &&
        progressCount.current < MAX_PROGRESS_CHECKS
      ) {
        nextProgressAt.current = active + PROGRESS_EVERY_MS;
        progressCount.current += 1;
        open('progress_check');
      }
    }, 15_000);
    const onInput = () => {
      const last = lastInputAt();
      if (wasAwaySince == null && last != null && Date.now() - last >= AWAY_MS) wasAwaySince = last;
      if (wasAwaySince != null && flags.resume_prompt && !shown) {
        awayMs.current = Date.now() - wasAwaySince;
        wasAwaySince = null;
        open('resume_prompt');
      }
    };
    const onVisible = () => {
      if (document.hidden) wasAwaySince = Date.now();
      else if (wasAwaySince != null && Date.now() - wasAwaySince < AWAY_MS) wasAwaySince = null;
    };
    window.addEventListener('pointerdown', onInput, true);
    window.addEventListener('keydown', onInput, true);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pointerdown', onInput, true);
      window.removeEventListener('keydown', onInput, true);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [courseId, flags.progress_check, flags.resume_prompt, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shown) return null;
  const meta = { courseId: courseId ?? undefined };
  return (
    <div
      className="fixed bottom-4 left-4 z-[120] w-80 rounded-lg border border-blue-200 bg-white p-3 text-sm shadow-lg"
      role="dialog"
      aria-label="Learning prompt"
      data-testid={`prompt-${shown}`}
    >
      <button
        type="button"
        className="float-right text-gray-400 hover:text-gray-600"
        aria-label="Close"
        onClick={dismiss}
      >
        ×
      </button>
      {shown === 'goal_card' && (
        <>
          <p className="mb-2 font-medium text-gray-800">
            What do you want to get done in this session?
          </p>
          <div className="flex flex-col gap-1.5">
            {GOALS.map((g) => (
              <button
                key={g}
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-left hover:bg-blue-50"
                onClick={() => {
                  track('GOAL_SET', { ...meta, metadata: { goal: g, source: 'option' } });
                  close();
                }}
              >
                {g}
              </button>
            ))}
            <form
              className="flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                const goal = ownGoal.trim();
                if (!goal) return;
                track('GOAL_SET', {
                  ...meta,
                  metadata: { goal, source: 'own', chars: goal.length },
                });
                setOwnGoal('');
                close();
              }}
            >
              <input
                className="flex-1 rounded border border-gray-300 px-2 py-1"
                placeholder="Or write your own"
                value={ownGoal}
                onChange={(e) => setOwnGoal(e.target.value)}
              />
              <button type="submit" className="rounded bg-blue-600 px-2 py-1 text-white">
                Set
              </button>
            </form>
          </div>
        </>
      )}
      {shown === 'progress_check' && (
        <>
          <p className="mb-2 font-medium text-gray-800">Quick check: how is it going?</p>
          <div className="flex gap-1.5">
            {[
              ['on_track', 'On track'],
              ['stuck', 'Stuck'],
              ['not_sure', 'Not sure'],
            ].map(([status, label]) => (
              <button
                key={status}
                type="button"
                className="flex-1 rounded border border-gray-300 px-2 py-1 hover:bg-blue-50"
                onClick={() => {
                  track('PROGRESS_CHECKED', {
                    ...meta,
                    metadata: { status, activeMinutes: Math.round(activeMs() / 60_000) },
                  });
                  close();
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      {shown === 'resume_prompt' && (
        <>
          <p className="mb-2 font-medium text-gray-800">
            Welcome back. Pick up where you left off?
          </p>
          <div className="flex gap-1.5">
            {[
              ['continue', 'Yes, continue'],
              ['something_else', 'Start something else'],
            ].map(([choice, label]) => (
              <button
                key={choice}
                type="button"
                className="flex-1 rounded border border-gray-300 px-2 py-1 hover:bg-blue-50"
                onClick={() => {
                  track('RESUME_ANSWERED', {
                    ...meta,
                    metadata: { choice, awayMs: awayMs.current },
                  });
                  close();
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
