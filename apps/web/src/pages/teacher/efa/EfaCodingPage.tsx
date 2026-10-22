import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { EfaCodedTask, EfaCodingItem, EfaCodingSummary, EfaEntryCode } from '@ats/shared';
import { api, ApiError } from '../../../lib/api';

/**
 * EF assessment: rater coding of W4 word lists and W5 Part B, the
 * disagreement queue (owner/admin), Cohen's κ, re-score and the research
 * exports. Staff only (admin bundle).
 */

const TASK_NAME: Record<EfaCodedTask, string> = {
  w4: 'W4 Word lists (verbal fluency)',
  w5: 'W5 Finishing sentences (Hayling, Part B)',
};
const W4_CODES = [
  ['valid', 'Valid'],
  ['repeat', 'Repeat'],
  ['rule_break', 'Rule break'],
  ['intrusion', 'Intrusion'],
] as const;
const W5_CODES = [
  ['A', 'A — fits the sentence'],
  ['B', 'B — related / indirect'],
  ['0', '0 — unrelated'],
] as const;
const EXPORTS = [
  ['trials', 'Trials'],
  ['task-scores', 'Task scores'],
  ['questionnaire', 'Questionnaire'],
  ['occasions', 'Occasions'],
  ['coding', 'Coding'],
] as const;

type Draft = Record<number, { code?: string; category?: string | null }>;
type Mode = { task: EfaCodedTask; view: 'code' | 'disagreements' } | null;

export function EfaCodingPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const base = `/efa-admin/courses/${courseId}`;
  const [summary, setSummary] = useState<EfaCodingSummary[] | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const loadSummary = useCallback(
    () =>
      api
        .get<EfaCodingSummary[]>(`${base}/coding/summary`)
        .then(setSummary)
        .catch((e) => setMessage(e instanceof ApiError ? e.message : 'Could not load')),
    [base],
  );
  useEffect(() => void loadSummary(), [loadSummary]);

  const rescore = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ scoringVersion: string; runs: number; scored: number }>(
        `${base}/rescore`,
        undefined,
        { timeoutMs: 120_000 },
      );
      setMessage(`Re-scored ${r.scored} of ${r.runs} runs (${r.scoringVersion}).`);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Re-score failed');
    } finally {
      setBusy(false);
    }
  };

  const download = async (kind: string) => {
    setMessage('');
    const res = await fetch(`/api${base}/export/${kind}.csv`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') ?? ''}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMessage(body.message ?? `Export failed (${res.status})`);
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = `ef_${kind.replace('-', '_')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <Link
          to={`/teacher/courses/${courseId}/efa`}
          className="text-sm text-blue-600 hover:underline"
        >
          ← Back to EF assessment
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">
          EF assessment — coding and exports
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Items are shown without student or occasion and in a random order per rater. Two raters
          code each entry; agreeing codes become final, disagreements are adjudicated here.
        </p>
      </div>

      {message && (
        <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">{message}</p>
      )}

      <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              {[
                'Puzzle',
                'Items',
                'Entries',
                'Coded by me',
                'Double-coded',
                'Open disagreements',
                'Final',
                "Cohen's κ",
                '',
              ].map((h) => (
                <th key={h} className="px-3 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(summary ?? []).map((s) => (
              <tr key={s.task} className="border-t">
                <td className="px-3 py-2 font-medium">{TASK_NAME[s.task]}</td>
                <td className="px-3 py-2">{s.items}</td>
                <td className="px-3 py-2">{s.entries}</td>
                <td className="px-3 py-2">{s.codedByMe}</td>
                <td className="px-3 py-2">{s.doubleCoded}</td>
                <td className="px-3 py-2">{s.disagreements}</td>
                <td className="px-3 py-2">{s.finalised}</td>
                <td className="px-3 py-2">{s.kappa ?? '—'}</td>
                <td className="space-x-2 whitespace-nowrap px-3 py-2">
                  {s.canCode && (
                    <button
                      onClick={() => setMode({ task: s.task, view: 'code' })}
                      className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                    >
                      Code
                    </button>
                  )}
                  {s.disagreements > 0 && (
                    <button
                      onClick={() => setMode({ task: s.task, view: 'disagreements' })}
                      className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                    >
                      Adjudicate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {mode && (
        <CodingPanel
          key={`${mode.task}:${mode.view}`}
          base={base}
          mode={mode}
          onClose={() => {
            setMode(null);
            void loadSummary();
          }}
          onSaved={() => void loadSummary()}
        />
      )}

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-semibold text-gray-900">Exports and scoring</h2>
        <p className="mt-1 text-xs text-gray-500">
          Pseudonymised CSV (needs RESEARCH_EXPORT_SALT on the server). Only occasions whose notice
          was accepted are included. No z-scores or composites.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXPORTS.map(([kind, label]) => (
            <button
              key={kind}
              onClick={() => void download(kind)}
              className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              {label}.csv
            </button>
          ))}
          <button
            disabled={busy}
            onClick={() => void rescore()}
            className="ml-auto rounded bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-900 disabled:opacity-50"
          >
            {busy ? 'Re-scoring…' : 'Re-score all runs'}
          </button>
        </div>
      </section>
    </div>
  );
}

function CodingPanel({
  base,
  mode,
  onClose,
  onSaved,
}: {
  base: string;
  mode: NonNullable<Mode>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [items, setItems] = useState<EfaCodingItem[] | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState('');
  const item = items?.[0];

  const load = useCallback(async () => {
    setError('');
    try {
      if (mode.view === 'code') {
        const q = await api.get<{ remaining: number; items: EfaCodingItem[] }>(
          `${base}/coding/${mode.task}/queue`,
        );
        setItems(q.items);
        setRemaining(q.remaining);
      } else {
        const d = await api.get<{ items: EfaCodingItem[] }>(
          `${base}/coding/${mode.task}/disagreements`,
        );
        setItems(d.items);
        setRemaining(d.items.length);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load');
    }
  }, [base, mode]);
  useEffect(() => void load(), [load]);

  // Pre-fill: my earlier codes; W5 suggestion (to be confirmed); for adjudication, agreed codes.
  useEffect(() => {
    if (!item) return;
    const d: Draft = {};
    for (const e of item.entries) {
      const agreed =
        e.raters?.length === 2 &&
        e.raters[0]!.code === e.raters[1]!.code &&
        e.raters[0]!.category === e.raters[1]!.category;
      const pre =
        e.final ??
        (agreed ? e.raters![0] : null) ??
        e.mine ??
        (e.suggested ? { code: e.suggested, category: null } : null);
      if (pre) d[e.entryIndex] = { code: pre.code, category: pre.category };
    }
    setDraft(d);
  }, [item]);

  if (!items) return <p className="text-sm text-gray-500">{error || 'Loading…'}</p>;
  if (!item)
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
        <p>
          {mode.view === 'code' ? 'Nothing left for you to code here.' : 'No open disagreements.'}
        </p>
        <button onClick={onClose} className="mt-3 rounded border px-3 py-1.5 hover:bg-gray-50">
          Close
        </button>
      </section>
    );

  const codes = item.task === 'w4' ? W4_CODES : W5_CODES;
  const complete = item.entries.every(
    (e) =>
      draft[e.entryIndex]?.code &&
      (!item.categories || draft[e.entryIndex]!.code !== 'valid' || draft[e.entryIndex]!.category),
  );
  const save = async () => {
    setError('');
    const body: { codes: EfaEntryCode[] } = {
      codes: item.entries.map((e) => ({
        entryIndex: e.entryIndex,
        code: draft[e.entryIndex]!.code as EfaEntryCode['code'],
        category:
          draft[e.entryIndex]!.code === 'valid' ? (draft[e.entryIndex]!.category ?? null) : null,
      })),
    };
    try {
      await api.post(
        `${base}/coding/items/${item.itemId}${mode.view === 'disagreements' ? '/final' : ''}`,
        body,
      );
      onSaved();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save');
    }
  };
  const set = (i: number, patch: { code?: string; category?: string | null }) =>
    setDraft((d) => ({ ...d, [i]: { ...d[i], ...patch } }));

  return (
    <section
      className="rounded-lg border border-blue-200 bg-white p-4"
      data-testid="efa-coding-panel"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold text-gray-900">
          {mode.view === 'code' ? 'Code' : 'Adjudicate'}: {TASK_NAME[item.task]}
        </h2>
        <span className="text-xs text-gray-500">{remaining} item(s) left</span>
      </div>

      <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm">
        {item.prompt.kind === 'letter' && (
          <p>
            Words beginning with <b>{item.prompt.letter}</b> (no names, no same word with a
            different ending).
          </p>
        )}
        {item.prompt.kind === 'category' && (
          <p>
            Category: <b>{item.prompt.category}</b>
          </p>
        )}
        {item.prompt.kind === 'switch' && (
          <p>
            Switching between <b>{item.prompt.pair?.join(' / ')}</b>; give each valid word its
            category.
          </p>
        )}
        {item.prompt.kind === 'sentence' && (
          <>
            <p className="text-base">{item.prompt.sentence}</p>
            <p className="mt-1 text-gray-600">
              Expected completion: <b>{item.expected}</b>
              {item.anchors && (
                <>
                  {' '}
                  · A example: <i>{item.anchors.a}</i> · B example: <i>{item.anchors.b}</i>
                </>
              )}
            </p>
          </>
        )}
      </div>

      <ol className="mt-3 divide-y">
        {item.entries.map((e) => (
          <li key={e.entryIndex} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <span className="w-6 text-right text-gray-400">{e.entryIndex + 1}</span>
            <span className="w-40 font-medium">
              {e.text || <i className="text-gray-400">(no response)</i>}
            </span>
            {e.hints?.map((h) => (
              <span key={h} className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                {h}
              </span>
            ))}
            {e.raters && (
              <span className="text-xs text-gray-500">
                Raters:{' '}
                {e.raters
                  .map((r) => (r.category ? `${r.code} (${r.category})` : r.code))
                  .join(' vs ')}
              </span>
            )}
            <div className="ml-auto flex flex-wrap gap-1">
              {codes.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => set(e.entryIndex, { code: value })}
                  className={`rounded border px-2 py-0.5 text-xs ${
                    draft[e.entryIndex]?.code === value
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  {label}
                </button>
              ))}
              {item.categories && draft[e.entryIndex]?.code === 'valid' && (
                <select
                  value={draft[e.entryIndex]?.category ?? ''}
                  onChange={(ev) => set(e.entryIndex, { category: ev.target.value || null })}
                  className="rounded border px-1 py-0.5 text-xs"
                >
                  <option value="">category…</option>
                  {item.categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              )}
            </div>
            {e.suggested && !e.mine && mode.view === 'code' && (
              <p className="w-full pl-9 text-xs text-amber-700">
                Pre-filled {e.suggested}: the response is the expected word. Check it — saving
                confirms it.
              </p>
            )}
          </li>
        ))}
      </ol>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button
          disabled={!complete}
          onClick={() => void save()}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {mode.view === 'code' ? 'Save and next' : 'Save final codes'}
        </button>
        <button onClick={onClose} className="rounded border px-4 py-1.5 text-sm hover:bg-gray-50">
          Close
        </button>
      </div>
    </section>
  );
}
