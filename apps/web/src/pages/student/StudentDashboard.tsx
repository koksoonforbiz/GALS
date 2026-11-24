import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, CircleCheckBig, Lock } from 'lucide-react';
import type { CourseProgress, CourseSessionProgress } from '@ats/shared';
import { useAuth } from '../../contexts/AuthContext';
import { usePageContext } from '../../contexts/PageContext';
import { apiFetch } from '../../lib/api';
import { stepHref } from '../../components/student/CourseGateChecklist';

interface Enrollment {
  id: string;
  courseId: string;
  course: {
    id: string;
    title: string;
  };
}

function lastActive(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'Last active today';
  if (days === 1) return 'Last active yesterday';
  return `Last active ${days} days ago`;
}

function continueHref(p: CourseProgress): string {
  const n = p.next;
  if (n?.kind === 'lesson' && n.moduleItemId) {
    return `/student/courses/${p.courseId}?item=${n.moduleItemId}`;
  }
  if (n?.kind === 'step' && n.step) {
    return (
      stepHref(p.courseId, { step: n.step, occasion: n.occasion }) ??
      `/student/courses/${p.courseId}`
    );
  }
  return `/student/courses/${p.courseId}`;
}

const SESSION_STATE_LABEL: Record<CourseSessionProgress['state'], string> = {
  done: 'done',
  in_progress: 'in progress',
  open: 'ready to start',
  locked: 'not open yet',
};

function SessionChips({ sessions }: { sessions: CourseSessionProgress[] }) {
  if (!sessions.length) return null;
  return (
    <ol className="mt-3 flex flex-wrap gap-1.5" aria-label="Sessions">
      {sessions.map((s) => {
        const label = `${s.title}: ${SESSION_STATE_LABEL[s.state]}`;
        const cls =
          s.state === 'done'
            ? 'border-green-200 bg-green-50 text-green-700'
            : s.state === 'in_progress'
              ? 'border-blue-300 bg-blue-50 text-blue-700'
              : s.state === 'open'
                ? 'border-gray-300 bg-white text-gray-700'
                : 'border-gray-200 bg-gray-50 text-gray-400';
        return (
          <li
            key={s.sessionNo}
            title={label}
            aria-label={label}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}
          >
            {s.state === 'done' ? (
              <Check size={12} />
            ) : s.state === 'locked' ? (
              <Lock size={11} />
            ) : s.state === 'in_progress' ? (
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            ) : null}
            Session {s.sessionNo}
          </li>
        );
      })}
    </ol>
  );
}

function ProgressCard({ p }: { p: CourseProgress }) {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  const complete = p.total > 0 && p.done === p.total;
  const active = lastActive(p.lastActiveAt);
  return (
    <li
      className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
      data-testid="course-progress"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-base font-semibold text-gray-900">{p.title}</h4>
          <p className="text-xs text-gray-500">
            by {p.teacherName}
            {active && <> · {active}</>}
          </p>
        </div>
        <Link
          to={continueHref(p)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          {complete ? 'Open course' : p.done === 0 ? 'Start' : 'Continue'} <ArrowRight size={15} />
        </Link>
      </div>

      {p.total > 0 && (
        <>
          <div className="mt-4 flex items-center gap-3">
            <div
              className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label={`${p.title} progress`}
            >
              <div
                className={`h-full rounded-full ${complete ? 'bg-green-500' : 'bg-blue-600'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-10 text-right text-sm font-semibold text-gray-800">{pct}%</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {p.done} of {p.total} steps done
          </p>
          <SessionChips sessions={p.sessions} />
          {complete ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-green-700">
              <CircleCheckBig size={16} /> You have finished this course. Well done!
            </p>
          ) : (
            p.next && (
              <p className="mt-3 text-sm text-gray-700">
                <span className="font-medium text-gray-900">Next:</span> {p.next.label}
              </p>
            )
          )}
        </>
      )}
    </li>
  );
}

export function StudentDashboard() {
  const { user } = useAuth();
  const { setPageContext } = usePageContext();
  const [progress, setProgress] = useState<CourseProgress[] | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setPageContext({ pageType: 'dashboard', courseId: null, contentId: null, contentTitle: null });
  }, [setPageContext]);

  useEffect(() => {
    let current = true;
    (async () => {
      try {
        const data = await apiFetch<CourseProgress[]>('/course-progress/my');
        if (current) setProgress(data);
      } catch {
        // Progress is a summary: fall back to the plain course list.
        try {
          const data = await apiFetch<Enrollment[]>('/enrollments/my');
          if (current) setEnrollments(data);
        } catch {
          // Silently fail for dashboard
        }
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => {
      current = false;
    };
  }, []);

  const count = progress ? progress.length : enrollments.length;

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Welcome, {user?.name}!</h2>
      <p className="mb-6 text-sm text-gray-500">
        {loading
          ? ' '
          : count === 0
            ? 'You are not enrolled in any courses yet.'
            : `Here is where you are in your ${count === 1 ? 'course' : `${count} courses`}.`}
      </p>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : progress ? (
        progress.length > 0 && (
          <ul className="space-y-4">
            {progress.map((p) => (
              <ProgressCard key={p.courseId} p={p} />
            ))}
          </ul>
        )
      ) : (
        enrollments.length > 0 && (
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Your Courses</h3>
            <ul className="space-y-2">
              {enrollments.map((enrollment) => (
                <li key={enrollment.id}>
                  <Link
                    to={`/student/courses/${enrollment.course.id}`}
                    className="block p-3 bg-gray-50 rounded-lg text-gray-700 hover:bg-blue-50 hover:text-blue-700"
                  >
                    {enrollment.course.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )
      )}
    </div>
  );
}
