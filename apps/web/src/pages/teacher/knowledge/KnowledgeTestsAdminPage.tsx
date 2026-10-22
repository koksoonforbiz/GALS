import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../../lib/api';

/**
 * Knowledge tests for one course (staff, admin bundle): turn the tests on
 * (places the 18 gates), blinded written scoring with adjudication,
 * exports and inter-rater agreement. docs/assessments/README.md.
 */

interface Setup {
  enabled: boolean;
  sessions: Array<{ sessionNo: number; hasLesson: boolean; finalSlideKey: string | null }>;
  gates: Array<{
    id: string;
    occasion: string;
    position: string;
    sequence: number;
    required: boolean;
    completions: number;
  }>;
  definitions: Array<{
    scope: string;
    sessionNo: number;
    form: string;
    version: string;
    maxMarks: number;
    attempts: number;
  }>;
}
interface WrittenItem {
  attemptId: string;
  slot: number;
  stem: string;
  rubric: string;
  maxMarks: number;
  text: string;
  shownAt: string;
  scoredByMe: boolean;
  needsAdjudication: boolean;
}
interface InterRater {
  scope: string;
  slot: number;
  maxMarks: number;
  n: number;
  dimensions: Array<{
    dimension: number;
    n: number;
    agreement: number | null;
    kappa: number | null;
  }>;
  totalAgreement: number | null;
  totalKappa: number | null;
  totalKappaWeighting: string;
}
type Tab = 'setup' | 'scoring' | 'exports';
const msg = (e: unknown, f: string) => (e instanceof ApiError ? e.message : f);

export function KnowledgeTestsAdminPage() {
  const { courseId = '' } = useParams<{ courseId: string }>();
  const [tab, setTab] = useState<Tab>('setup');
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div>
        <Link to={`/teacher/courses/${courseId}`} className="text-sm text-blue-600 hover:underline">
          ← Back to course
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">Knowledge tests</h1>
        <p className="mt-1 text-sm text-gray-600">
          Pre/post-study (forms A/B/C) and pre/post-session tests for Sessions 1–8 (forms A/B).
          Order: warm-up → pre-study → S1 pre → S1 lesson → S1 post → … → S8 post → post-study →
          post-study warm-up.
        </p>
      </div>
      <div className="flex gap-2 border-b">
        {(['setup', 'scoring', 'exports'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? 'border-blue-600 font-medium text-blue-700' : 'border-transparent text-gray-600'}`}
          >
            {t === 'setup' ? 'Setup' : t === 'scoring' ? 'Written scoring' : 'Exports & agreement'}
          </button>
        ))}
      </div>
      {tab === 'setup' && <SetupTab courseId={courseId} />}
      {tab === 'scoring' && <ScoringTab courseId={courseId} />}
      {tab === 'exports' && <ExportsTab courseId={courseId} />}
    </div>
  );
}

function SetupTab({ courseId }: { courseId: string }) {
  const [s, setS] = useState<Setup | null>(null);
  const [note, setNote] = useState('');
  const load = useCallback(
    () =>
      api
        .get<Setup>(`/knowledge-tests-admin/courses/${courseId}/setup`)
        .then(setS)
        .catch((e) => setNote(msg(e, 'Could not load'))),
    [courseId],
  );
  useEffect(() => void load(), [load]);
  if (!s) return <p className="text-sm text-gray-500">{note || 'Loading…'}</p>;
  const toggle = async (enabled: boolean) => {
    setNote('');
    try {
      setS(await api.put<Setup>(`/knowledge-tests-admin/courses/${courseId}/setup`, { enabled }));
      setNote(enabled ? 'Knowledge tests are on: 18 gates placed.' : 'Knowledge tests are off.');
    } catch (e) {
      setNote(msg(e, 'Could not save'));
    }
  };
  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-5 text-sm">
      <div className="flex items-center gap-3">
        <span
          className={`rounded px-2 py-0.5 ${s.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}
        >
          {s.enabled ? 'On' : 'Off'}
        </span>
        <button
          onClick={() => void toggle(!s.enabled)}
          className={`rounded px-3 py-1.5 text-white ${s.enabled ? 'bg-gray-700 hover:bg-gray-800' : 'bg-blue-600 hover:bg-blue-700'}`}
        >
          {s.enabled ? 'Turn off' : 'Turn on'}
        </button>
        {note && <span className="text-gray-700">{note}</span>}
      </div>
      <p className="text-gray-600">
        Item bank: {s.definitions.length} definitions (
        {s.definitions.filter((d) => d.scope === 'session').length} session,{' '}
        {s.definitions.filter((d) => d.scope === 'study').length} study). Sessions found:{' '}
        {s.sessions
          .map((x) => `S${x.sessionNo}${x.finalSlideKey ? '' : ' (no lesson)'}`)
          .join(', ') || 'none'}
        .
      </p>
      {s.gates.length > 0 && (
        <table className="text-xs">
          <tbody>
            {s.gates.map((g) => (
              <tr key={g.id} className="border-t">
                <td className="py-1 pr-3 font-mono">{g.occasion}</td>
                <td className="pr-3">
                  {g.position === 'AFTER_MODULE' ? 'after' : 'before'} its session
                </td>
                <td className="pr-3">#{g.sequence}</td>
                <td className="pr-3">{g.required ? 'required' : 'not required'}</td>
                <td>{g.completions} submitted</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ScoringTab({ courseId }: { courseId: string }) {
  const [item, setItem] = useState<WrittenItem | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [adjudicate, setAdjudicate] = useState<
    Array<{ attemptId: string; slot: number; totals: number[] }>
  >([]);
  const [mode, setMode] = useState<'RATER' | 'ADJUDICATOR'>('RATER');
  const [dims, setDims] = useState<Array<0 | 1>>([]);
  const [note, setNote] = useState('');

  const show = (w: WrittenItem | null) => {
    setItem(w);
    setDims(w ? Array(w.maxMarks).fill(0) : []);
  };
  const next = useCallback(async () => {
    setNote('');
    try {
      const r = await api.get<{ remaining: number; next: WrittenItem | null }>(
        `/knowledge-tests-admin/courses/${courseId}/written/next`,
      );
      setRemaining(r.remaining);
      setMode('RATER');
      show(r.next);
      api
        .get<{ items: Array<{ attemptId: string; slot: number; totals: number[] }> }>(
          `/knowledge-tests-admin/courses/${courseId}/written/disagreements`,
        )
        .then((d) => setAdjudicate(d.items))
        .catch(() => setAdjudicate([]));
    } catch (e) {
      setNote(msg(e, 'Could not load'));
    }
  }, [courseId]);
  useEffect(() => void next(), [next]);

  const openAdjudication = async (a: { attemptId: string; slot: number }) => {
    try {
      show(
        await api.get<WrittenItem>(
          `/knowledge-tests-admin/attempts/${a.attemptId}/written/${a.slot}`,
        ),
      );
      setMode('ADJUDICATOR');
    } catch (e) {
      setNote(msg(e, 'Could not load'));
    }
  };
  const save = async () => {
    if (!item) return;
    try {
      await api.post(
        `/knowledge-tests-admin/attempts/${item.attemptId}/written/${item.slot}/score`,
        {
          dimensionScores: dims,
          role: mode,
          shownAt: item.shownAt,
        },
      );
      await next();
    } catch (e) {
      setNote(msg(e, 'Could not save'));
    }
  };

  return (
    <div className="space-y-4">
      {note && <p className="rounded bg-blue-50 px-3 py-2 text-sm text-blue-800">{note}</p>}
      <div
        className="rounded-lg border border-gray-200 bg-white p-5 text-sm"
        data-testid="kt-scoring"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold text-gray-900">
            {mode === 'ADJUDICATOR' ? 'Adjudicate' : 'Score an answer'}
          </h2>
          <span className="text-xs text-gray-500">{remaining} answer(s) waiting for you</span>
        </div>
        {!item ? (
          <p className="mt-3 text-gray-600">Nothing to score right now.</p>
        ) : (
          <>
            <p className="mt-3 text-xs uppercase tracking-wide text-gray-400">Question</p>
            <p className="whitespace-pre-wrap text-gray-900">{item.stem}</p>
            <p className="mt-3 text-xs uppercase tracking-wide text-gray-400">Answer</p>
            <p className="whitespace-pre-wrap rounded bg-gray-50 p-3 text-gray-900">
              {item.text || <i className="text-gray-400">(no answer)</i>}
            </p>
            <p className="mt-3 text-xs uppercase tracking-wide text-gray-400">Rubric</p>
            <p className="whitespace-pre-wrap text-gray-700">{item.rubric}</p>
            <div className="mt-3 flex flex-wrap gap-4">
              {dims.map((v, i) => (
                <label key={i} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={v === 1}
                    onChange={(e) =>
                      setDims(dims.map((x, j) => (j === i ? (e.target.checked ? 1 : 0) : x)))
                    }
                  />
                  Dimension {i + 1} (1 mark)
                </label>
              ))}
              <span className="text-gray-500">
                Total {dims.reduce<number>((a, b) => a + b, 0)} / {item.maxMarks}
              </span>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => void save()}
                className="rounded bg-blue-600 px-4 py-1.5 text-white hover:bg-blue-700"
              >
                {mode === 'ADJUDICATOR' ? 'Save final score' : 'Save and next'}
              </button>
              {mode === 'ADJUDICATOR' && (
                <button
                  onClick={() => void next()}
                  className="rounded border px-4 py-1.5 hover:bg-gray-50"
                >
                  Cancel
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {adjudicate.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="font-medium text-amber-900">
            Waiting for adjudication: {adjudicate.length}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {adjudicate.map((a) => (
              <button
                key={`${a.attemptId}:${a.slot}`}
                onClick={() => void openAdjudication(a)}
                className="rounded border border-amber-300 bg-white px-2 py-1 text-xs hover:bg-amber-100"
              >
                Answer {a.attemptId.slice(0, 6)}·{a.slot} (raters {a.totals.join(' vs ')})
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ExportsTab({ courseId }: { courseId: string }) {
  const [ir, setIr] = useState<InterRater[] | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    void api
      .get<{ items: InterRater[] }>(`/knowledge-tests-admin/courses/${courseId}/inter-rater`)
      .then((r) => setIr(r.items))
      .catch((e) => setNote(msg(e, 'Could not load')));
  }, [courseId]);
  const download = async (kind: string) => {
    setNote('');
    const res = await fetch(`/api/knowledge-tests-admin/courses/${courseId}/${kind}.csv`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') ?? ''}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setNote(body.message ?? `Export failed (${res.status})`);
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = `knowledge_test_${kind}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-4 text-sm">
      {note && <p className="rounded bg-blue-50 px-3 py-2 text-blue-800">{note}</p>}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="font-semibold text-gray-900">Exports</h2>
        <p className="mt-1 text-xs text-gray-500">
          Pseudonymised (RESEARCH_EXPORT_SALT, same ids as the other research exports).
        </p>
        <div className="mt-3 flex gap-2">
          {['assignments', 'attempts', 'responses'].map((k) => (
            <button
              key={k}
              onClick={() => void download(k)}
              className="rounded border px-3 py-1.5 hover:bg-gray-50"
            >
              {k}.csv
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 text-left uppercase text-gray-500">
            <tr>
              {[
                'Item',
                'Max',
                'Double-scored',
                'Per dimension (agreement / κ)',
                'Total agreement',
                'Total κ',
              ].map((h) => (
                <th key={h} className="px-3 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(ir ?? []).map((r) => (
              <tr key={`${r.scope}:${r.slot}`} className="border-t">
                <td className="px-3 py-2">
                  {r.scope} item {r.slot}
                </td>
                <td className="px-3 py-2">{r.maxMarks}</td>
                <td className="px-3 py-2">{r.n}</td>
                <td className="px-3 py-2">
                  {r.dimensions
                    .map((d) => `D${d.dimension}: ${d.agreement ?? '—'} / ${d.kappa ?? '—'}`)
                    .join(' · ')}
                </td>
                <td className="px-3 py-2">{r.totalAgreement ?? '—'}</td>
                <td className="px-3 py-2">
                  {r.totalKappa ?? '—'}
                  {r.totalKappaWeighting === 'quadratic' ? ' (quadratic)' : ''}
                </td>
              </tr>
            ))}
            {ir && !ir.length && (
              <tr>
                <td className="px-3 py-3 text-gray-500" colSpan={6}>
                  No double-scored answers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
