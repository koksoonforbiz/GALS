import { useCallback, useEffect, useRef, useState } from 'react';
import type { LessonDocument, LessonSlideState, TextConsentDecision } from '@ats/shared';
import { api } from '../../lib/api';

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

  const saveFields = useCallback(
    (slideKey: string, patch: SlideFields) => {
      const next = { ...(fieldsRef.current[slideKey] ?? {}), ...patch };
      fieldsRef.current = { ...fieldsRef.current, [slideKey]: next };
      setFieldsBySlide(fieldsRef.current);
      if (opts.readOnly) return;
      api
        .put(`/interactive-lessons/items/${itemId}/slides/${encodeURIComponent(slideKey)}/state`, {
          state: { fields: next },
          ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
        })
        .catch((err: unknown) => {
          // Capture failure must never block the learner (plan rule 6).
          console.warn('[InteractiveLesson] slide state save failed', slideKey, err);
        });
    },
    [itemId, opts.readOnly, opts.sessionId],
  );

  return { lesson, fieldsBySlide, saveFields, error, consent, setConsent, courseId };
}
