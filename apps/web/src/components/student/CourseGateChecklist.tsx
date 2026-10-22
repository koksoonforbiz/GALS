import { Check, Lock } from 'lucide-react';
import type { StudentGateStep } from '@ats/shared';

/**
 * "Before you start" checklist on the course page: the course gates a
 * student still has to pass. Labels come from the server and are neutral
 * by design (no construct names in the student bundle).
 */
export function CourseGateChecklist({
  steps,
  compact = false,
}: {
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
            {s.next && !compact && <span className="ml-auto text-xs text-amber-700">Next</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function LockedBadge({ size = 12 }: { size?: number }) {
  return <Lock size={size} className="shrink-0 text-gray-400" aria-label="locked" />;
}
