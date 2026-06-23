import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

/** PR1 of the Research Analysis Studio: pick a cohort, see per-session summary
 * cards (interventions / practice-testing / EF / coder coding). No inference. */
export function CohortAnalysis() {
  const [users, setUsers] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .analysisUsers()
      .then((r) => setUsers(r.users))
      .catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    const ids = [...selected];
    if (ids.length === 0) {
      setSessions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .cohortSummary(ids)
      .then((r) => {
        if (!cancelled) setSessions(r.sessions);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const byUser = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const s of sessions) {
      const arr = m.get(s.userId) ?? [];
      arr.push(s);
      m.set(s.userId, arr);
    }
    return m;
  }, [sessions]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
        <Link to="/" className="text-slate-400 hover:text-slate-700">
          ← Library
        </Link>
        <span className="font-semibold">Research Analysis Studio</span>
        <span className="text-slate-400">· cohort summary</span>
        <span className="ml-auto text-xs text-slate-400">
          interventions · practice-testing · EF · activity inference
        </span>
      </div>

      <div className="grid grid-cols-[240px_1fr] gap-3">
        {/* cohort selector */}
        <div className="max-h-[82vh] overflow-auto rounded-lg border border-slate-200 bg-white p-2">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
            <span>Cohort ({selected.size})</span>
            {selected.size > 0 && (
              <button
                onClick={() => setSelected(new Set())}
                className="text-slate-400 hover:text-slate-700"
              >
                clear
              </button>
            )}
          </div>
          {users.map((u) => (
            <label
              key={u.userId}
              className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selected.has(u.userId)}
                onChange={() => toggle(u.userId)}
              />
              <span className="flex-1 truncate">{u.displayName ?? u.userId.slice(0, 8)}</span>
              <span className="text-xs text-slate-400">{u.sessions}</span>
            </label>
          ))}
          {users.length === 0 && (
            <div className="p-3 text-center text-xs text-slate-400">No users</div>
          )}
        </div>

        {/* summary cards */}
        <div className="space-y-4">
          {selected.size === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-400">
              Select one or more learners to see their per-session summary.
            </div>
          ) : loading ? (
            <div className="p-8 text-center text-slate-400">Loading cohort…</div>
          ) : (
            [...byUser.entries()].map(([userId, sess]) => (
              <div key={userId}>
                <div className="mb-2 text-sm font-semibold text-slate-700">
                  {sess[0].userDisplayName ?? userId.slice(0, 8)}{' '}
                  <span className="text-slate-400">· {sess.length} session(s)</span>
                </div>
                <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                  {sess.map((s) => (
                    <SessionCard key={s.sessionId} s={s} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SessionCard({ s }: { s: any }) {
  const [open, setOpen] = useState<number | null>(null);
  const iv = s.interventions;
  const sysTypes = Object.entries(iv.system.byType as Record<string, number>).filter(
    ([, n]) => n > 0,
  );
  const coderTypes = Object.entries(iv.coder.byType as Record<string, number>).filter(
    ([, n]) => n > 0,
  );
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">{new Date(s.startedAt).toLocaleString()}</span>
        <span className="text-slate-400">
          {fmtDur(s.durationSecs)} · {s.courseTitle ?? 'no course'}
        </span>
      </div>

      {/* 1a interventions — system vs coder */}
      <Section title="Interventions">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] uppercase text-slate-400">system ({iv.system.total})</div>
            {sysTypes.length === 0 ? (
              <span className="text-slate-300">none</span>
            ) : (
              sysTypes.map(([t, n]) => (
                <div key={t}>
                  <span className="text-slate-500">{t}</span> <b>{n}</b>
                </div>
              ))
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase text-slate-400">coder ({iv.coder.total})</div>
            {coderTypes.length === 0 ? (
              <span className="text-slate-300">none coded</span>
            ) : (
              coderTypes.map(([t, n]) => (
                <div key={t}>
                  <span className="text-slate-500">{t}</span> <b>{n}</b>
                </div>
              ))
            )}
          </div>
        </div>
        {iv.disagreement > 0 && (
          <div className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
            Δ {iv.disagreement} system vs coder
          </div>
        )}
      </Section>

      {/* 1b activity (Part B inference) */}
      {s.activity && (
        <Section title="Activity (gaze × DOM × interaction)">
          <ActivityBar pct={s.activity.pctByActivity} />
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-slate-500">
            {(Object.entries(s.activity.pctByActivity) as [string, number][])
              .filter(([, v]) => v > 0.005)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <span key={k} className="flex items-center gap-1">
                  <span
                    className="h-2 w-2 rounded-sm"
                    style={{ background: ACTIVITY_COLOR[k] ?? '#94a3b8' }}
                  />
                  {k.replace(/_/g, ' ')} {(v * 100).toFixed(0)}%
                </span>
              ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <span
              className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700"
              title="windows where the page is the lesson but gaze is on the chatbot (divided attention, off-task relative to lesson)"
            >
              reading-but-gaze-elsewhere {(s.activity.pctReadingButGazeElsewhere * 100).toFixed(1)}%
            </span>
            <span
              className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600"
              title="total-variation distance of observed allocation from expected weights (0 = matches expectation)"
            >
              allocation score {s.activity.allocationScore.toFixed(2)}
            </span>
          </div>
        </Section>
      )}

      {/* 1c practice testing */}
      {s.practiceTesting.length > 0 && (
        <Section title="Practice testing">
          {s.practiceTesting.map((p: any, i: number) => (
            <div key={i} className="mb-1">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="flex w-full items-center gap-2 text-left"
              >
                <span className="rounded bg-slate-900 px-1.5 py-0.5 font-semibold text-white">
                  {p.score ?? '—'}
                </span>
                <span className="text-slate-500">
                  {p.mcqCorrect}/{p.mcqTotal} mcq
                  {p.shortAnswerTotal > 0
                    ? `, ${p.shortAnswerCorrect}/${p.shortAnswerTotal} short`
                    : ''}
                </span>
                <span className="ml-auto text-slate-300">{open === i ? '−' : '+'}</span>
              </button>
              {open === i && (
                <table className="mt-1 w-full">
                  <tbody>
                    {p.perQuestion.map((q: any) => (
                      <tr key={q.idx} className="border-t border-slate-100">
                        <td className="py-0.5 pr-1 text-slate-400">Q{q.idx + 1}</td>
                        <td className={q.correct ? 'text-emerald-600' : 'text-rose-600'}>
                          {q.correct ? '✓' : '✗'}
                        </td>
                        <td className="truncate text-slate-500" title={q.feedback}>
                          {q.feedback}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </Section>
      )}

      {/* 1e EF detections */}
      <Section title={`EF detections (${s.efDetections.length})`}>
        {s.efDetections.length === 0 ? (
          <span className="text-slate-300">none</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {topCounts(s.efDetections.map((d: any) => d.construct)).map(([c, n]) => (
              <span key={c} className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700">
                {c} {n}
              </span>
            ))}
          </div>
        )}
      </Section>

      {/* 1f coder coding */}
      <Section title={`Coder coding (${s.coderCoding.length})`}>
        {s.coderCoding.length === 0 ? (
          <span className="text-slate-300">not coded yet</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {topCounts(s.coderCoding.map((c: any) => `${c.codingPass}:${c.codeLabel}`)).map(
              ([k, n]) => (
                <span key={k} className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                  {k} {n}
                </span>
              ),
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

const ACTIVITY_COLOR: Record<string, string> = {
  reading_lesson: '#10b981',
  chatbot: '#0ea5e9',
  intervention: '#8b5cf6',
  navigating: '#64748b',
  idle: '#cbd5e1',
  off_task: '#f43f5e',
};
const ACTIVITY_ORDER = [
  'reading_lesson',
  'chatbot',
  'intervention',
  'navigating',
  'off_task',
  'idle',
];

function ActivityBar({ pct }: { pct: Record<string, number> }) {
  return (
    <div className="flex h-3 w-full overflow-hidden rounded bg-slate-100">
      {ACTIVITY_ORDER.filter((k) => (pct[k] ?? 0) > 0).map((k) => (
        <div
          key={k}
          style={{ width: `${(pct[k] ?? 0) * 100}%`, background: ACTIVITY_COLOR[k] ?? '#94a3b8' }}
          title={`${k.replace(/_/g, ' ')} ${((pct[k] ?? 0) * 100).toFixed(0)}%`}
        />
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 border-t border-slate-100 pt-1.5">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </div>
      {children}
    </div>
  );
}

function topCounts(items: string[]): [string, number][] {
  const m: Record<string, number> = {};
  for (const i of items) m[i] = (m[i] ?? 0) + 1;
  return Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
}

function fmtDur(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
