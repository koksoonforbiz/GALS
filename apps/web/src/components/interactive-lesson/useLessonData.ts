import { useCallback, useEffect, useRef, useState } from 'react';
import type { LessonDocument, LessonSlideState, TextConsentDecision } from '@ats/shared';
import { api, ApiError } from '../../lib/api';

export type SlideFields = Record<string, unknown>;

interface LessonResponse {
  item: { id: string; title: string; moduleId: string; courseId: string };
  lesson: LessonDocument;
  state: Record<string, LessonSlideState>;
  /** Phase 6: the student's text-capture decision; null = not asked yet. */
  consent?: TextConsentDecision | null;
}

/**
 * Loads an INTERACTIVE_LESSON item plus the learner's saved slide state,
 * and saves per-slide work back to the server (replacing the course
 * HTML's localStorage). Saving never blocks the learner: local state
 * updates immediately and a failed PUT is only logged.
 */
export function useLessonData(
  itemId: string,
  opts: { readOnly: boolean; sessionId: string | null },
) {
  const [lesson, setLesson] = useState<LessonDocument | null>(null);
  const [fieldsBySlide, setFieldsBySlide] = useState<Record<string, SlideFields>>({});
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState<TextConsentDecision | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const fieldsRef = useRef(fieldsBySlide);
  fieldsRef.current = fieldsBySlide;

  useEffect(() => {
    let cancelled = false;
    setLesson(null);
    setError(null);
    setFieldsBySlide({});
    api
      .get<LessonResponse>(`/interactive-lessons/items/${itemId}`)
      .then((res) => {
        if (cancelled) return;
        setLesson(res.lesson);
        setConsent(res.consent ?? null);
        setCourseId(res.item.courseId);
        setFieldsBySlide(
          Object.fromEntries(Object.entries(res.state ?? {}).map(([k, v]) => [k, v?.fields ?? {}])),
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load lesson');
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  // Saves that have not reached the server yet, by slide. A failed save used
  // to be dropped silently while the slide said "Saved" — a lost reflection
  // then kept the after-lesson check locked ("cannot proceed"). Failed saves
  // are retried with backoff (always the slide's latest fields) and the page
  // shows that work is unsaved until they land.
  const [unsaved, setUnsaved] = useState(0);
  const pending = useRef(
    new Map<string, { attempt: number; timer?: ReturnType<typeof setTimeout> }>(),
  );

  const putSlide = useCallback(
    (slideKey: string) => {
      const entry = pending.current.get(slideKey) ?? { attempt: 0 };
      pending.current.set(slideKey, entry);
      if (entry.timer) clearTimeout(entry.timer);
      api
        .put(`/interactive-lessons/items/${itemId}/slides/${encodeURIComponent(slideKey)}/state`, {
          state: { fields: fieldsRef.current[slideKey] ?? {} },
          ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
        })
        .then(() => {
          if (pending.current.get(slideKey) === entry) pending.current.delete(slideKey);
        })
        .catch((err: unknown) => {
          // Never block the learner (plan rule 6): keep retrying in the background.
          console.warn('[InteractiveLesson] slide state save failed', slideKey, err);
          if (
            err instanceof ApiError &&
            err.status >= 400 &&
            err.status < 500 &&
            err.status !== 408 &&
            err.status !== 429
          ) {
            pending.current.delete(slideKey); // rejected for good (e.g. locked); retrying won't help
            return;
          }
          entry.attempt += 1;
          const delay = Math.min(60_000, 2_000 * 2 ** Math.min(entry.attempt - 1, 5));
          entry.timer = setTimeout(() => putSlide(slideKey), delay);
        })
        .finally(() => setUnsaved(pending.current.size));
      setUnsaved(pending.current.size);
    },
    [itemId, opts.sessionId],
  );

  useEffect(() => {
    const map = pending.current;
    return () => map.forEach((e) => e.timer && clearTimeout(e.timer));
  }, []);

  const saveFields = useCallback(
    (slideKey: string, patch: SlideFields) => {
      const next = { ...(fieldsRef.current[slideKey] ?? {}), ...patch };
      fieldsRef.current = { ...fieldsRef.current, [slideKey]: next };
      setFieldsBySlide(fieldsRef.current);
      if (opts.readOnly) return;
      putSlide(slideKey);
    },
    [opts.readOnly, putSlide],
  );

  return { lesson, fieldsBySlide, saveFields, unsaved, error, consent, setConsent, courseId };
}
