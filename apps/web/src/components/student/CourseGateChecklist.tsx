import { useEffect, useState } from 'react';
import { Check, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { KnowledgeTestStatus, StudentGateStep } from '@ats/shared';
import { api } from '../../lib/api';

/**
 * "Before you start" checklist on the course page: the course gates a
 * student still has to pass. Labels come from the server and are neutral
 * by design (no construct names in the student bundle).
 */
/** Knowledge-test gate occasion (PRE_STUDY, S3_POST, …) → test page path segment. */
function knowledgePath(occasion: string): string | null {
  if (occasion === 'PRE_STUDY') return 'pre-study';
  if (occasion === 'POST_STUDY') return 'post-study';
  const m = /^S([1-8])_(PRE|POST)$/.exec(occasion);
  return m ? `${m[2] === 'PRE' ? 'pre-session' : 'post-session'}/${m[1]}` : null;
}

/** Where a step is done in the student app. */
export function stepHref(
  courseId: string,
  s: Pick<StudentGateStep, 'step' | 'occasion'>,
): string | null {
  if ((s.step === 'questionnaire' || s.step === 'puzzles') && s.occasion) {
    return `/student/courses/${courseId}/puzzles/${s.occasion}`;
  }
  if (s.step === 'knowledge' && s.occasion) {
    const p = knowledgePath(s.occasion);
    return p ? `/student/courses/${courseId}/knowledge-check/${p}` : null;
  }
  return null;
}

export function CourseGateChecklist({
  courseId,
  steps,
  compact = false,
}: {
  courseId: string;
  steps: StudentGateStep[];
  compact?: boolean;
}) {
  const next = steps.find((s) => s.next);
  const waitsForLesson = useWaitsForLesson(courseId, next);
  if (!next) return null;
  const done = steps.filter((s) => s.done).length;
  const first = done === 0;
  // A post-session check that is next in line still needs its lesson
  // finished first: point at the lesson instead of a check that refuses.
  const href = waitsForLesson ? null : stepHref(courseId, next);
  return (
    <div
      className={`rounded-lg border border-amber-200 bg-amber-50 ${compact ? 'p-2 mb-3' : 'p-5 max-w-xl'}`}
      data-testid="course-gate-checklist"
    >
      <p className={`font-semibold text-amber-900 ${compact ? 'text-xs mb-1' : 'text-base mb-1'}`}>
        {first ? 'Before you start' : 'Next step'}
      </p>
      {!compact && (
        <p className="text-sm text-amber-800 mb-3">
          {first
            ? 'Please complete these steps first. The course sessions open once they are done.'
            : 'Complete this step to continue. The next part of the course opens once it is done.'}
        </p>
      )}
      <div
        className={`flex items-center gap-2 ${compact ? 'text-xs' : 'text-sm'} text-amber-900 font-medium`}
      >
        <span
          className={`inline-block rounded-full bg-amber-500 ${compact ? 'h-2 w-2' : 'h-2.5 w-2.5'}`}
        />
        <span>
          {waitsForLesson
            ? `Finish the Session ${waitsForLesson} lesson (save the reflection on its last slide)`
            : next.label}
        </span>
        {href && (
          <Link
            to={href}
            className={`ml-auto rounded-md bg-amber-600 font-medium text-white hover:bg-amber-700 ${
              compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'
            }`}
          >
            {first ? 'Start' : 'Continue'}
          </Link>
        )}
      </div>
      {done > 0 && (
        <p
          className={`mt-1 flex items-center gap-1 text-green-700 ${compact ? 'text-[10px]' : 'text-xs'}`}
        >
          <Check size={compact ? 10 : 12} aria-label="done" /> {done} of {steps.length} steps done
        </p>
      )}
    </div>
  );
}

/**
 * Session number when `next` is a post-session check whose lesson is not
 * finished yet (per the knowledge-test status), else null.
 */
function useWaitsForLesson(courseId: string, next: StudentGateStep | undefined): number | null {
  const m = next?.step === 'knowledge' ? /^S([1-8])_POST$/.exec(next.occasion ?? '') : null;
  const sessionNo = m ? Number(m[1]) : null;
  const [waits, setWaits] = useState<number | null>(null);
  useEffect(() => {
    setWaits(null);
    if (!sessionNo) return;
    let current = true;
    api
      .get<KnowledgeTestStatus>(`/knowledge-tests/courses/${courseId}/status`)
      .then((st) => {
        const t = st.tests.find((x) => x.kind === 'POST_SESSION' && x.sessionNo === sessionNo);
        if (current && t?.reasonCode === 'LESSON_NOT_FINISHED') setWaits(sessionNo);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [courseId, sessionNo]);
  return waits;
}

export function LockedBadge({ size = 12 }: { size?: number }) {
  return <Lock size={size} className="shrink-0 text-gray-400" aria-label="locked" />;
}
