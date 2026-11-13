/**
 * Attention and memory puzzles: one occasion (route /student/courses/:courseId/puzzles/:occasion).
 *
 * Mounted with student(), not studentBiometric(): eye tracking, pupil and
 * webcam recording never start here, and replay snapshots are paused while
 * the page is open. Everything shown comes from /api/puzzles in neutral
 * wording; the page never receives scores or answer keys.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { PuzzleNextStep, PuzzleOccasion } from '@ats/shared';
import { api, ApiError } from '../../../lib/api';
import { usePauseReplay } from '../../../components/replayPause';
import { useHoldSurvey } from '../../../components/surveyHold';
import { NoticeStep } from './NoticeStep';
import { QuestionnaireStep } from './QuestionnaireStep';
import { ColourCheckStep } from './ColourCheckStep';
import { TaskRunner } from './runner/TaskRunner';

export interface OccasionView {
  occasionId: string | null;
  occasion: PuzzleOccasion;
  next: PuzzleNextStep;
  puzzleCount: number;
  notice?: { version: string; title: string; paragraphs: string[]; acceptLabel: string };
  message?: string;
  task?: { code: 'w1' | 'w2' | 'w3' | 'w4' | 'w5' | 'w6' | 'w7'; number: number; of: number };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-gray-50 py-8 px-4">
      <div className="mx-auto max-w-3xl">{children}</div>
    </div>
  );
}

function Message({ title, body, onBack }: { title: string; body: string; onBack: () => void }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <p className="mt-2 text-sm text-gray-600">{body}</p>
      <button
        onClick={onBack}
        className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Back to the course
      </button>
    </div>
  );
}

export function PuzzlesPage() {
  const { courseId = '', occasion = 'T0' } = useParams<{
    courseId: string;
    occasion: PuzzleOccasion;
  }>();
  const navigate = useNavigate();
  const [view, setView] = useState<OccasionView | null>(null);
  const [error, setError] = useState('');
  usePauseReplay(true);
  useHoldSurvey(true);

  const back = () => navigate(`/student/courses/${courseId}`);

  const load = useCallback(async () => {
    try {
      setError('');
      setView(await api.get<OccasionView>(`/puzzles/courses/${courseId}/occasions/${occasion}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    }
  }, [courseId, occasion]);

  useEffect(() => {
    document.title = 'Attention and memory puzzles';
    void load();
  }, [load]);

  if (error)
    return (
      <Shell>
        <Message title="Please try again" body={error} onBack={back} />
      </Shell>
    );
  if (!view)
    return (
      <Shell>
        <p className="text-sm text-gray-500">Loading…</p>
      </Shell>
    );

  const go = (v: OccasionView) => setView(v);

  return (
    <Shell>
      {view.next === 'consent' && view.notice && (
        <NoticeStep courseId={courseId} occasion={occasion} notice={view.notice} onStarted={go} />
      )}
      {view.next === 'questionnaire' && view.occasionId && (
        <QuestionnaireStep occasionId={view.occasionId} part="before" onSubmitted={go} />
      )}
      {view.next === 'colour' && view.occasionId && (
        <ColourCheckStep occasionId={view.occasionId} onDone={go} />
      )}
      {view.next === 'tasks' && view.occasionId && view.task && (
        <TaskRunner
          key={view.task.code}
          occasionId={view.occasionId}
          task={view.task}
          onDone={go}
        />
      )}
      {view.next === 'after' && view.occasionId && (
        <QuestionnaireStep occasionId={view.occasionId} part="after" onSubmitted={go} />
      )}
      {view.next === 'done' && (
        <Message
          title="Thank you"
          body="You have finished this part. Go back to the course to see your next step."
          onBack={back}
        />
      )}
      {view.next === 'abandoned' && (
        <Message
          title="This session has expired"
          body="It was left unfinished for more than a day. Please contact your instructor to continue."
          onBack={back}
        />
      )}
      {view.next === 'unavailable' && (
        <Message
          title="Nothing to do here"
          body={view.message ?? 'Nothing to do here at the moment.'}
          onBack={back}
        />
      )}
    </Shell>
  );
}
