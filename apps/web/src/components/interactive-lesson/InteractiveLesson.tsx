import { useCallback, useEffect, useRef, useState } from 'react';
import type { LessonSlide } from '@ats/shared';
import { useLessonData } from './useLessonData';
import { Slide, type LessonEmit } from './slides';
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
  /** Learning-event sink (Phase 2 wires this to the activity log). */
  emit?: (slide: LessonSlide, ...args: Parameters<LessonEmit>) => void;
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

export function InteractiveLesson({
  itemId,
  readOnly = false,
  sessionId = null,
  emit,
  onSlideChange,
}: InteractiveLessonProps) {
  const { lesson, fieldsBySlide, saveFields, error } = useLessonData(itemId, {
    readOnly,
    sessionId,
  });
  const [index, setIndex] = useState(() => loadPosition(itemId));
  const rootRef = useRef<HTMLDivElement>(null);

  const total = lesson?.slides.length ?? 0;
  const current = lesson ? lesson.slides[Math.min(index, total - 1)] : undefined;

  useEffect(() => {
    setIndex(loadPosition(itemId));
  }, [itemId]);

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

  useEffect(() => {
    if (current) onSlideChange?.(current, Math.min(index, total - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.key]);

  if (error) {
    return <div className="p-6 text-sm text-red-600">Could not load this lesson: {error}</div>;
  }
  if (!lesson || !current) {
    return <div className="p-6 text-sm text-gray-500">Loading lesson…</div>;
  }

  const pos = Math.min(index, total - 1);
  const slideEmit: LessonEmit = (name, data) => emit?.(current, name, data);

  return (
    <div
      ref={rootRef}
      className="il-root"
      data-interactive-lesson={itemId}
      tabIndex={-1}
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
        <select aria-label="Jump to slide" value={pos} onChange={(e) => go(Number(e.target.value))}>
          {lesson.slides.map((s, i) => (
            <option key={s.key} value={i}>
              {slideTitle(s, i)}
            </option>
          ))}
        </select>
      </div>
      <Slide
        key={current.key}
        slide={current}
        session={lesson.session}
        index={pos}
        total={total}
        fields={fieldsBySlide[current.key] ?? {}}
        save={(patch) => saveFields(current.key, patch)}
        emit={slideEmit}
        onAdvance={() => go(pos + 1)}
      />
    </div>
  );
}

export default InteractiveLesson;
