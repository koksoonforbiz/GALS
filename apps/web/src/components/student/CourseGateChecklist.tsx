import { Check, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { StudentGateStep } from '@ats/shared';

/**
 * "Before you start" checklist on the course page: the course gates a
 * student still has to pass. Labels come from the server and are neutral
 * by design (no construct names in the student bundle).
 */
/** Where a step is done in the student app (knowledge checks: later). */
function stepHref(courseId: string, s: StudentGateStep): string | null {
  if ((s.step === 'questionnaire' || s.step === 'puzzles') && s.occasion) {
    return `/student/courses/${courseId}/puzzles/${s.occasion}`;
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
  const open = steps.filter((s) => !s.done);
  if (!open.length) return null;
  return (
    <div
      className={`rounded-lg border border-amber-200 bg-amber-50 ${compact ? 'p-2 mb-3' : 'p-5 max-w-xl'}`}
      data-testid="course-gate-checklist"
    >
      <p className={`font-semibold text-amber-900 ${compact ? 'text-xs mb-1' : 'text-base mb-1'}`}>
        Before you start
      </p>
      {!compact && (
        <p className="text-sm text-amber-800 mb-3">
          Please complete these steps first. The course sessions open once they are done.
        </p>
      )}
      <ol className="space-y-1">
        {steps.map((s) => (
          <li
            key={s.gateId}
            className={`flex items-center gap-2 ${compact ? 'text-xs' : 'text-sm'} ${
              s.done
                ? 'text-green-700'
                : s.next
                  ? 'text-amber-900 font-medium'
                  : 'text-amber-700/70'
            }`}
          >
            {s.done ? (
              <Check size={compact ? 12 : 14} aria-label="done" />
            ) : (
              <span
                className={`inline-block rounded-full ${compact ? 'h-2 w-2' : 'h-2.5 w-2.5'} ${s.next ? 'bg-amber-500' : 'bg-amber-200'}`}
              />
            )}
            <span>{s.label}</span>
            {s.next && stepHref(courseId, s) && (
              <Link
                to={stepHref(courseId, s)!}
                className={`ml-auto rounded-md bg-amber-600 font-medium text-white hover:bg-amber-700 ${
                  compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'
                }`}
              >
                {steps.some((x) => x.done) ? 'Continue' : 'Start'}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function LockedBadge({ size = 12 }: { size?: number }) {
  return <Lock size={size} className="shrink-0 text-gray-400" aria-label="locked" />;
}
