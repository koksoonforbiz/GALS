/**
 * Knowledge check (docs/assessments/README.md). One item per screen; "Next"
 * never requires an answer (skipping is allowed and recorded); a review
 * screen lists unanswered items; submitting needs a confirmation. After
 * submission only "Submitted. Thank you!" is shown. The server decides
 * availability (403 with a reason) and never sends keys or scores.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { requestSignOut } from '../../../lib/signOut';
import { Link, useParams } from 'react-router-dom';
import type {
  KnowledgeTestKind,
  KnowledgeTestResponse,
  KnowledgeTestResponses,
  KnowledgeTestStudentItem,
} from '@ats/shared';
import { api, ApiError } from '../../../lib/api';
import { useActivityLog } from '../../../lib/activity-log';
import { usePauseReplay } from '../../../components/replayPause';
import { useHoldSurvey } from '../../../components/surveyHold';

const KIND: Record<string, KnowledgeTestKind> = {
  'pre-study': 'PRE_STUDY',
  'post-study': 'POST_STUDY',
  'pre-session': 'PRE_SESSION',
  'post-session': 'POST_SESSION',
};

interface Attempt {
  attemptId: string;
  kind: KnowledgeTestKind;
  sessionNo: number | null;
  label: string;
  form: string;
  order: string;
  startedAt: string;
  items: KnowledgeTestStudentItem[];
  responses: KnowledgeTestResponses;
}

type View =
  | { at: 'loading' }
  | { at: 'blocked'; message: string }
  | { at: 'submitted' }
  | { at: 'item'; i: number; fromReview?: boolean }
  | { at: 'review' };

const answered = (it: KnowledgeTestStudentItem, r?: KnowledgeTestResponse) =>
  it.type === 'mcq' ? !!r?.option : it.type === 'sata' ? !!r?.options?.length : !!r?.text?.trim();
const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function KnowledgeTestPage() {
  const {
    courseId = '',
    kind: slug = '',
    sessionNo,
  } = useParams<{ courseId: string; kind: string; sessionNo?: string }>();
  const kind = KIND[slug];
  const { track, flush } = useActivityLog();
  usePauseReplay(true); // items are test content: keep them out of replay snapshots
  useHoldSurvey(true);

  const [view, setView] = useState<View>({ at: 'loading' });
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [responses, setResponses] = useState<KnowledgeTestResponses>({});
  const [confirming, setConfirming] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [now, setNow] = useState(Date.now());
  const openedAt = useRef(0);
  const dirty = useRef(false);
  const changes = useRef<Record<string, number>>({});
  const responsesRef = useRef(responses);
  responsesRef.current = responses;

  // ── start / resume ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!kind) {
      setView({ at: 'blocked', message: 'This page does not exist.' });
      return;
    }
    void api
      .post<Attempt>(`/knowledge-tests/courses/${courseId}/attempts`, {
        kind,
        ...(sessionNo ? { sessionNo: Number(sessionNo) } : {}),
      })
      .then((a) => {
        setAttempt(a);
        setResponses(a.responses ?? {});
        openedAt.current = performance.now();
        track('KNOWLEDGE_TEST_OPENED', {
          courseId,
          metadata: {
            kind: a.kind,
            sessionNo: a.sessionNo,
            form: a.form,
            order: a.order,
            attemptId: a.attemptId,
          },
        });
        // Resume where the student left off: the first unanswered question.
        const firstOpen = a.items.findIndex((it) => !answered(it, a.responses?.[String(it.slot)]));
        setView({ at: 'item', i: firstOpen === -1 ? 0 : firstOpen });
      })
      .catch((err) => {
        if (err instanceof ApiError && err.code === 'ALREADY_SUBMITTED') {
          setView({ at: 'submitted' });
        } else {
          setView({
            at: 'blocked',
            message: err instanceof ApiError ? err.message : 'Could not open this check.',
          });
        }
      });
  }, [courseId, kind, sessionNo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── autosave: every 10 s and on blur ───────────────────────────────────
  const save = useCallback(async () => {
    if (!attempt || !dirty.current) return;
    dirty.current = false;
    try {
      await api.patch(`/knowledge-tests/attempts/${attempt.attemptId}`, {
        responses: responsesRef.current,
      });
      setSaveError('');
    } catch {
      dirty.current = true;
      setSaveError('Not saved yet. We will keep trying.');
    }
  }, [attempt]);
  useEffect(() => {
    const t = setInterval(() => void save(), 10_000);
    const onBlur = () => void save();
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onBlur);
    return () => {
      clearInterval(t);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onBlur);
    };
  }, [save]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── item view events ────────────────────────────────────────────────────
  const item = view.at === 'item' && attempt ? attempt.items[view.i] : null;
  useEffect(() => {
    if (!item) return;
    track('KNOWLEDGE_TEST_ITEM_VIEWED', {
      courseId,
      metadata: {
        slot: item.slot,
        type: item.type,
        msFromOpen: Math.round(performance.now() - openedAt.current),
      },
    });
  }, [item?.slot]); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = (it: KnowledgeTestStudentItem, r: KnowledgeTestResponse) => {
    const key = String(it.slot);
    const before = responses[key];
    const n = (changes.current[key] = (changes.current[key] ?? 0) + 1);
    setResponses((prev) => ({ ...prev, [key]: r }));
    dirty.current = true;
    if (it.type !== 'open') {
      // option ids only — never text
      track('KNOWLEDGE_TEST_ITEM_ANSWERED', {
        courseId,
        metadata: {
          slot: it.slot,
          type: it.type,
          changed: answered(it, before),
          attemptNo: n,
          ...(it.type === 'mcq' ? { option: r.option } : { options: r.options }),
        },
      });
    }
  };
  /** Open answers: one event when the student leaves the box (chars only). */
  const textDone = (it: KnowledgeTestStudentItem) => {
    const r = responses[String(it.slot)];
    track('KNOWLEDGE_TEST_ITEM_ANSWERED', {
      courseId,
      metadata: {
        slot: it.slot,
        type: 'open',
        changed: (changes.current[String(it.slot)] ?? 0) > 1,
        attemptNo: changes.current[String(it.slot)] ?? 0,
        chars: r?.text?.length ?? 0,
      },
    });
    void save();
  };

  const go = (to: number | 'review') => {
    if (item && !answered(item, responses[String(item.slot)])) {
      track('KNOWLEDGE_TEST_ITEM_SKIPPED', { courseId, metadata: { slot: item.slot } });
    }
    void save();
    setView(to === 'review' ? { at: 'review' } : { at: 'item', i: to });
  };

  const submit = async () => {
    if (!attempt) return;
    try {
      await api.post(`/knowledge-tests/attempts/${attempt.attemptId}/submit`, { responses });
      void flush();
      setView({ at: 'submitted' });
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not submit. Please try again.');
    } finally {
      setConfirming(false);
    }
  };

  // ── render ──────────────────────────────────────────────────────────────
  const back = (
    <Link to={`/student/courses/${courseId}`} className="text-sm text-blue-600 hover:underline">
      ← Back to the course
    </Link>
  );
  if (view.at === 'loading') return <p className="p-6 text-sm text-gray-500">Loading…</p>;
  if (view.at === 'blocked')
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6">
        {back}
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
          {view.message}
        </p>
      </div>
    );
  if (view.at === 'submitted' && kind === 'PRE_STUDY')
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6">
        {back}
        <div
          className="rounded-lg border border-green-200 bg-green-50 p-6"
          data-testid="pre-study-break"
        >
          <p className="text-lg font-medium text-green-800">Submitted. Thank you!</p>
          <h2 className="mt-3 text-base font-semibold text-gray-900">
            Well done! You&apos;ve finished the warm-up and the first knowledge check.
          </h2>
          <p className="mt-2 text-sm text-gray-700">
            You&apos;re welcome to take a break here and come back another time. The questionnaire,
            puzzles and knowledge check take real effort, and your progress is saved.
          </p>
          <p className="mt-2 text-sm text-gray-700">
            If you&apos;d like to carry on, remember that each session starts with a short knowledge
            check before the lesson and ends with another one after it.
          </p>
          <p className="mt-2 text-sm text-gray-700">Thank you for taking part, and good luck!</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              to={`/student/courses/${courseId}`}
              className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
            >
              Continue to Session 1
            </Link>
            <button
              type="button"
              onClick={requestSignOut}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Take a break and sign out
            </button>
          </div>
        </div>
      </div>
    );
  if (view.at === 'submitted')
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6">
        {back}
        <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
          <p className="text-lg font-medium text-green-800">Submitted. Thank you!</p>
          <Link
            to={`/student/courses/${courseId}`}
            className="mt-4 inline-block rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
          >
            Continue to your next step
          </Link>
        </div>
      </div>
    );
  if (!attempt) return null;

  const total = attempt.items.length;
  const missing = attempt.items.filter((it) => !answered(it, responses[String(it.slot)]));
  // Clamped: a browser clock slightly behind the server showed "-1:-1".
  const elapsed = Math.max(0, now - new Date(attempt.startedAt).getTime());

  return (
    <div
      className="mx-auto flex min-h-full max-w-3xl flex-col gap-4 p-6"
      data-testid="knowledge-test"
    >
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span className="font-medium text-gray-800">{attempt.label}</span>
        <span>
          {view.at === 'item' ? `Question ${view.i + 1} of ${total}` : 'Review'} ·{' '}
          <span className="font-mono">{fmt(elapsed)}</span>
        </span>
      </div>
      <p className="text-xs text-gray-500">
        Not graded. Answer what you can. A best guess is fine, and you can skip a question and come
        back to it before you submit.
      </p>
      <div className="h-1 overflow-hidden rounded bg-gray-100">
        <div
          className="h-full bg-blue-500"
          style={{ width: `${((total - missing.length) / total) * 100}%` }}
        />
      </div>

      {item && (
        <div className="rounded-lg border border-gray-200 bg-white p-6" data-slot={item.slot}>
          <p className="whitespace-pre-wrap text-base text-gray-900">{item.stem}</p>
          {item.type === 'sata' && (
            <p className="mt-2 text-sm font-medium text-gray-600">Select all that apply</p>
          )}
          <div className="mt-4 space-y-2">
            {item.type === 'mcq' &&
              item.options!.map((o) => (
                <label
                  key={o.id}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 p-3 hover:bg-gray-50"
                >
                  <input
                    type="radio"
                    name={`slot-${item.slot}`}
                    checked={responses[String(item.slot)]?.option === o.id}
                    onChange={() => answer(item, { option: o.id })}
                    className="mt-1"
                  />
                  <span className="text-sm text-gray-800">
                    <span className="mr-2 font-medium">{o.id}.</span>
                    {o.text}
                  </span>
                </label>
              ))}
            {item.type === 'sata' &&
              item.options!.map((o) => {
                const sel = responses[String(item.slot)]?.options ?? [];
                return (
                  <label
                    key={o.id}
                    className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 p-3 hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={sel.includes(o.id)}
                      onChange={(e) =>
                        answer(item, {
                          options: e.target.checked
                            ? [...sel, o.id].sort()
                            : sel.filter((x) => x !== o.id),
                        })
                      }
                      className="mt-1"
                    />
                    <span className="text-sm text-gray-800">
                      <span className="mr-2 font-medium">{o.id}.</span>
                      {o.text}
                    </span>
                  </label>
                );
              })}
            {item.type === 'open' && (
              <div>
                <textarea
                  aria-label="Your answer"
                  value={responses[String(item.slot)]?.text ?? ''}
                  maxLength={item.maxChars ?? 2000}
                  onChange={(e) => answer(item, { text: e.target.value })}
                  onBlur={() => textDone(item)}
                  className="h-40 w-full rounded-md border border-gray-300 p-3 text-sm"
                />
                <p className="mt-1 text-right text-xs text-gray-500">
                  {(responses[String(item.slot)]?.text ?? '').length} / {item.maxChars ?? 2000}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {view.at === 'review' && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="font-semibold text-gray-900">Review</h2>
          {missing.length ? (
            <>
              <p className="mt-2 text-sm text-gray-700">
                {missing.length} question{missing.length > 1 ? 's are' : ' is'} unanswered. You can
                still go back; a best guess is fine.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {missing.map((it) => (
                  <button
                    key={it.slot}
                    onClick={() =>
                      setView({ at: 'item', i: attempt.items.indexOf(it), fromReview: true })
                    }
                    className="rounded border px-2 py-1 text-sm hover:bg-gray-50"
                  >
                    Question {it.slot}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-gray-700">All questions are answered.</p>
          )}
        </div>
      )}

      {saveError && <p className="text-sm text-red-600">{saveError}</p>}

      <div className="flex gap-3">
        {view.at === 'item' && view.i > 0 && (
          <button
            onClick={() => go(view.i - 1)}
            className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50"
          >
            Back
          </button>
        )}
        {view.at === 'review' && (
          <button
            onClick={() => setView({ at: 'item', i: total - 1 })}
            className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50"
          >
            Back
          </button>
        )}
        {view.at === 'item' && view.fromReview && view.i + 1 < total && (
          <button
            onClick={() => go('review')}
            className="rounded-md border border-blue-600 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
          >
            Back to review
          </button>
        )}
        {view.at === 'item' && (
          <button
            onClick={() => go(view.i + 1 < total ? view.i + 1 : 'review')}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {view.i + 1 < total ? 'Next' : 'Review'}
          </button>
        )}
        {view.at === 'review' && (
          <button
            onClick={() => setConfirming(true)}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Submit
          </button>
        )}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-lg">
            <p className="font-medium text-gray-900">Submit your answers?</p>
            <p className="mt-1 text-sm text-gray-600">You cannot change them afterwards.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="rounded border px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => void submit()}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white"
              >
                Yes, submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
