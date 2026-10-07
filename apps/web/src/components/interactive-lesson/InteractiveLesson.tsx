import { useCallback, useEffect, useRef, useState } from 'react';
import type { LessonSlide } from '@ats/shared';
import { api } from '../../lib/api';
import { useActivityLog } from '../../lib/activity-log';
import { ConsentPanel, NudgeCard, type ConsentChoice, type Nudge } from './governance';
import { useLessonData } from './useLessonData';
import { useLessonTracking } from './useLessonTracking';
import { Slide, type LessonEmit } from './slides';
import { matchPaste, notePaste, takePaste } from './prompt-lab/aiOutputs';
import { editRatio } from './prompt-lab/wordDiff';
import './interactive-lesson.css';

/**
 * Renders an INTERACTIVE_LESSON item (one session of the prompting course)
 * inside the GALS lesson column, replacing the PDF/PAGE viewport. The GALS
 * sidebar and docked chatbot stay as they are; the course's own rail is not
 * reproduced. One slide is shown at a time, so slide enter/exit is
 * unambiguous for dwell measurement (PHASE0_DISCOVERY.md §4).
 */
export interface InteractiveLessonProps {
  itemId: string;
  /** Teacher preview: everything works locally but nothing is saved. */
  readOnly?: boolean;
  sessionId?: string | null;
  /** Ids stamped on every activity-log row (ActivityLog columns). */
  courseId?: string;
  moduleId?: string;
  onSlideChange?: (slide: LessonSlide, index: number) => void;
}

const POSITION_KEY = (itemId: string) => `gals.interactiveLesson.position.${itemId}`;

function loadPosition(itemId: string): number {
  try {
    const n = Number(localStorage.getItem(POSITION_KEY(itemId)));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function slideTitle(s: LessonSlide, i: number): string {
  const label =
    s.t === 'title'
      ? 'Title'
      : (s.heading ?? s.box ?? s.t.charAt(0).toUpperCase() + s.t.slice(1)).replace(/<[^>]+>/g, '');
  return `${i + 1}. ${label}`;
}

/** Moments after which the server may have a nudge (starter rules M16/M24/M28/M31). */
const NUDGE_MOMENTS = new Set([
  'misconception_changed',
  'predict_revealed',
  'check_revealed',
  'expect_revealed',
  'prompt_submitted',
  'output_regenerated',
  'output_edited',
]);

export function InteractiveLesson({
  itemId,
  readOnly = false,
  sessionId = null,
  courseId,
  moduleId,
  onSlideChange,
}: InteractiveLessonProps) {
  const {
    lesson,
    fieldsBySlide,
    saveFields,
    error,
    consent,
    setConsent,
    courseId: lessonCourseId,
  } = useLessonData(itemId, {
    readOnly,
    sessionId,
  });
  const { track, flush } = useActivityLog();
  const [showConsent, setShowConsent] = useState(false);
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const evalTimer = useRef<number | null>(null);

  // Phase 6.1: ask the server for a rule-triggered nudge after key moments.
  // The activity buffer is flushed first so the server sees the latest
  // actions. Off unless a researcher enabled a policy for this course.
  const scheduleNudgeCheck = useCallback(
    (slideKey?: string) => {
      if (readOnly || !sessionId) return;
      if (evalTimer.current) window.clearTimeout(evalTimer.current);
      evalTimer.current = window.setTimeout(async () => {
        try {
          await flush();
          const res = await api.post<{ nudge: Nudge | null }>('/nudges/evaluate', {
            moduleItemId: itemId,
            sessionId,
            ...(slideKey ? { slideKey } : {}),
          });
          if (res.nudge) {
            setNudge(res.nudge);
            track('INTERVENTION_VIEWED', {
              courseId,
              moduleId,
              moduleItemId: itemId,
              interventionId: res.nudge.id,
              metadata: {
                triggerReason: 'rule_triggered',
                ruleId: res.nudge.ruleId,
                slideKey: res.nudge.slideKey,
              },
            });
          }
        } catch {
          // A nudge is optional; never block the learner.
        }
      }, 1500);
    },
    [readOnly, sessionId, flush, itemId, track, courseId, moduleId],
  );
  const [index, setIndex] = useState(() => loadPosition(itemId));
  const rootRef = useRef<HTMLDivElement>(null);

  const total = lesson?.slides.length ?? 0;
  const current = lesson ? lesson.slides[Math.min(index, total - 1)] : undefined;
  // Teacher previews are never logged.
  const tracking = useLessonTracking({
    enabled: !readOnly,
    itemId,
    courseId,
    moduleId,
    // Phase 6.2: free text only with consent (a); otherwise chars only.
    captureText: consent?.answerText === true,
    onIdleEnded: () => scheduleNudgeCheck(),
  });
  const { enterSlide, reportVisible } = tracking;
  const sessionCriteria = lesson?.slides.find((s) => s.t === 'selfscore')?.criteria ?? [];

  useEffect(() => {
    setIndex(loadPosition(itemId));
  }, [itemId]);

  // First visit: show the notice until the learner has made a decision.
  useEffect(() => {
    if (!readOnly && lesson && consent === null) setShowConsent(true);
  }, [readOnly, lesson, consent]);

  const saveConsent = async (choice: ConsentChoice) => {
    const cid = lessonCourseId ?? courseId;
    if (!cid) return;
    const res = await api.put<{ decision: typeof consent }>(`/text-consent/courses/${cid}`, choice);
    setConsent(res.decision);
    setShowConsent(false);
  };

  const respondToNudge = (status: 'accepted' | 'dismissed') => {
    if (!nudge) return;
    track(status === 'accepted' ? 'INTERVENTION_COMPLETED' : 'INTERVENTION_DISMISSED', {
      courseId,
      moduleId,
      moduleItemId: itemId,
      interventionId: nudge.id,
      metadata: { triggerReason: 'rule_triggered', ruleId: nudge.ruleId },
    });
    api.post(`/nudges/${nudge.id}/respond`, { status }).catch(() => {});
    setNudge(null);
  };

  const go = useCallback(
    (i: number) => {
      if (!total) return;
      const next = Math.max(0, Math.min(total - 1, i));
      setIndex(next);
      try {
        localStorage.setItem(POSITION_KEY(itemId), String(next));
      } catch {
        // storage can be unavailable; position is only a convenience
      }
      rootRef.current?.scrollIntoView({ block: 'start' });
    },
    [itemId, total],
  );

  // Leaving a slide is when "revealed but noted nothing" (M15) becomes visible.
  const prevKey = useRef<string | null>(null);
  useEffect(() => {
    if (!current) return;
    if (prevKey.current && prevKey.current !== current.key) scheduleNudgeCheck(prevKey.current);
    prevKey.current = current.key;
    enterSlide(current);
    onSlideChange?.(current, Math.min(index, total - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.key]);

  // Page restored from the back/forward cache after a pagehide exit.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted && current) enterSlide(current);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [current, enterSlide]);

  // maxVisiblePct: the lesson scrolls inside the docked layout's inner
  // container, so that container — not the viewport — is the root.
  useEffect(() => {
    const el = rootRef.current?.querySelector<HTMLElement>('[data-slide-key]');
    if (!el || !current || typeof IntersectionObserver === 'undefined') return;
    const root = rootRef.current?.closest<HTMLElement>('[data-lesson-scroll-host]') ?? null;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => reportVisible(current.key, en.intersectionRatio * 100)),
      { root, threshold: [0, 0.1, 0.25, 0.5, 0.6, 0.75, 0.9, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [current, reportVisible]);

  if (error) {
    return <div className="p-6 text-sm text-red-600">Could not load this lesson: {error}</div>;
  }
  if (!lesson || !current) {
    return <div className="p-6 text-sm text-gray-500">Loading lesson…</div>;
  }

  const pos = Math.min(index, total - 1);
  const slideEmit: LessonEmit = (name, data) => {
    tracking.emit(current, name, data);
    if (NUDGE_MOMENTS.has(name)) scheduleNudgeCheck(current.key);
    // OUTPUT_EDITED: a field that received an AI-output paste is now saved.
    const fieldKey = data?.fieldKey;
    if (typeof fieldKey === 'string' && typeof data?.text === 'string') {
      const pasted = takePaste(fieldKey);
      if (pasted) {
        tracking.emit(current, 'output_edited', {
          targetField: fieldKey,
          editRatio: editRatio(pasted.text, data.text),
          runId: pasted.runId,
        });
      }
    }
  };

  return (
    <div
      ref={rootRef}
      className="il-root"
      data-interactive-lesson={itemId}
      tabIndex={-1}
      onPasteCapture={(e) => {
        // OUTPUT_PASTED: compared client-side with recent AI outputs; the
        // clipboard text itself is never sent (plan rule 5).
        const field = (e.target as HTMLElement).closest<HTMLElement>('[data-field-key]');
        if (!field || readOnly) return;
        const text = e.clipboardData.getData('text');
        if (!text) return;
        const fieldKey = field.dataset.fieldKey!;
        const match = matchPaste(text);
        if (match) notePaste(fieldKey, text, match.runId);
        scheduleNudgeCheck(current.key);
        tracking.emit(current, 'output_pasted', {
          targetField: fieldKey,
          chars: text.length,
          matchesAiOutput: Boolean(match),
          matchKind: match?.kind ?? null,
          runId: match?.runId ?? null,
        });
      }}
      onKeyDown={(e) => {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
        if (['ArrowDown', 'ArrowRight', 'j', 'PageDown'].includes(e.key)) {
          e.preventDefault();
          go(pos + 1);
        } else if (['ArrowUp', 'ArrowLeft', 'k', 'PageUp'].includes(e.key)) {
          e.preventDefault();
          go(pos - 1);
        }
      }}
    >
      <div className="il-bar">
        <button
          type="button"
          aria-label="Previous slide"
          disabled={pos === 0}
          onClick={() => go(pos - 1)}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label="Next slide"
          disabled={pos === total - 1}
          onClick={() => go(pos + 1)}
        >
          ↓
        </button>
        <span>
          Slide {pos + 1} of {total}
        </span>
        <div className="il-progress" aria-hidden="true">
          <i style={{ width: `${((pos + 1) / total) * 100}%` }} />
        </div>
        {readOnly && <span className="il-readonly">Preview · nothing is saved</span>}
        {!readOnly && (
          <button type="button" className="il-privacy" onClick={() => setShowConsent((v) => !v)}>
            Privacy &amp; data
          </button>
        )}
        <select aria-label="Jump to slide" value={pos} onChange={(e) => go(Number(e.target.value))}>
          {lesson.slides.map((s, i) => (
            <option key={s.key} value={i}>
              {slideTitle(s, i)}
            </option>
          ))}
        </select>
      </div>
      {showConsent && !readOnly && (
        <ConsentPanel
          current={consent}
          onSave={saveConsent}
          onClose={consent ? () => setShowConsent(false) : undefined}
        />
      )}
      {nudge && (
        <NudgeCard
          nudge={nudge}
          onAccept={() => respondToNudge('accepted')}
          onDismiss={() => respondToNudge('dismissed')}
          onGoToSlide={
            nudge.slideKey && nudge.slideKey !== current.key
              ? () => {
                  const i = lesson.slides.findIndex((s) => s.key === nudge.slideKey);
                  if (i >= 0) go(i);
                }
              : undefined
          }
        />
      )}
      <Slide
        key={current.key}
        slide={current}
        session={lesson.session}
        index={pos}
        total={total}
        fields={fieldsBySlide[current.key] ?? {}}
        save={(patch) => saveFields(current.key, patch)}
        emit={slideEmit}
        sessionCriteria={sessionCriteria}
        itemId={itemId}
        sessionId={sessionId}
        readOnly={readOnly}
        onAdvance={() => go(pos + 1)}
      />
    </div>
  );
}

export default InteractiveLesson;
