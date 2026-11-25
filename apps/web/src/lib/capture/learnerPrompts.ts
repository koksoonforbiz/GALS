/**
 * Learner-visible prompts (Prompt B, P5d; WP5 G1, G2, G9): which are on for
 * the course the learner is in. One switch per prompt per course (API
 * /course-flags); a course with no setting has every prompt on (PI decision
 * 2026-11-25). Cached per course for the page load.
 */
import { useEffect, useState } from 'react';
import { api } from '../api';

export type LearnerPrompt =
  | 'goal_card'
  | 'intention_tag'
  | 'progress_check'
  | 'confidence_slider'
  | 'resume_prompt'
  | 'session_reflection';

export type PromptFlags = Record<LearnerPrompt, boolean>;

const ALL_ON: PromptFlags = {
  goal_card: true,
  intention_tag: true,
  progress_check: true,
  confidence_slider: true,
  resume_prompt: true,
  session_reflection: true,
};

const cache = new Map<string, PromptFlags>();
const LAST_COURSE_KEY = 'gals.prompts.lastCourse';

/** The course id in the current URL, or the last course the learner was in. */
export function currentCourseId(pathname = window.location.pathname): string | null {
  const m = /\/courses\/([0-9a-f-]{36})/i.exec(pathname);
  if (m) {
    try {
      sessionStorage.setItem(LAST_COURSE_KEY, m[1]!);
    } catch {
      // ignore
    }
    return m[1]!;
  }
  try {
    return sessionStorage.getItem(LAST_COURSE_KEY);
  } catch {
    return null;
  }
}

/** The prompt switches for a course (all on until the API says otherwise). */
export function usePromptFlags(courseId: string | null): PromptFlags {
  const [flags, setFlags] = useState<PromptFlags>(() =>
    courseId ? (cache.get(courseId) ?? ALL_ON) : ALL_ON,
  );
  useEffect(() => {
    if (!courseId) return;
    const hit = cache.get(courseId);
    if (hit) {
      setFlags(hit);
      return;
    }
    let live = true;
    api
      .get<{ flags: PromptFlags }>(`/course-flags/${courseId}`)
      .then((r) => {
        const f = { ...ALL_ON, ...r.flags };
        cache.set(courseId, f);
        if (live) setFlags(f);
      })
      .catch(() => {
        // Not enrolled or offline: keep the default (on).
      });
    return () => {
      live = false;
    };
  }, [courseId]);
  return flags;
}

/** Once per session (and prompt): has this prompt already been shown? */
export function shownThisSession(sid: string | null, key: string): boolean {
  if (!sid) return true;
  try {
    return sessionStorage.getItem(`gals.prompt.${key}.${sid}`) === '1';
  } catch {
    return false;
  }
}

export function markShown(sid: string | null, key: string): void {
  if (!sid) return;
  try {
    sessionStorage.setItem(`gals.prompt.${key}.${sid}`, '1');
  } catch {
    // ignore
  }
}
