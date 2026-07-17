import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Bot, Check, Download, Pencil, Scissors, TriangleAlert, X } from 'lucide-react';
import { api } from '../lib/api';
import { formatDateTimeSGT } from '../lib/formatDateTime';

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

  // affect threshold panel (Part C) — live recompute via the lightweight endpoint
  const [affectOpts, setAffectOpts] = useState<AffectOpts>(DEFAULT_AFFECT_OPTS);
  const [affectOv, setAffectOv] = useState<Record<string, any>>({});
  const sessionIds = useMemo(() => sessions.map((s) => s.sessionId), [sessions]);

  useEffect(() => {
    if (sessionIds.length === 0) {
      setAffectOv({});
      return;
    }
    if (isDefaultAffect(affectOpts)) {
      setAffectOv({});
      return;
    } // cohort-summary already carries default-opt affect
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .affect(sessionIds, affectOpts)
        .then((r) => {
          if (cancelled) return;
          const m: Record<string, any> = {};
          for (const [id, v] of Object.entries<any>(r.affect)) m[id] = v?.byMethod ?? null;
          setAffectOv(m);
        })
        .catch(() => {});
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [sessionIds, affectOpts]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const exportZip = () => {
    if (selected.size === 0) return;
    const a = document.createElement('a');
    a.href = api.analysisExportZipUrl([...selected]);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const exportCsv = () => {
    if (sessions.length === 0) return;
    const csv = buildCohortCsv(sessions, (s) => affectOv[s.sessionId] ?? s.affect);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cohort-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
        <Link to="/" className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-700">
          <ArrowLeft size={14} /> Library
        </Link>
        <span className="font-semibold">Research Analysis Studio</span>
        <span className="text-slate-400">· cohort summary</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-xs text-slate-400 lg:inline">
            interventions · practice-testing · EF · activity inference
          </span>
          <button
            onClick={exportCsv}
            disabled={sessions.length === 0}
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
            title="Export every selected session as one CSV (items × sessions)"
          >
            <Download size={13} /> Report CSV
          </button>
          <button
            onClick={exportZip}
            disabled={selected.size === 0}
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
            title="Export chat utterances + LLM text-mining (EF) results + a summary, as CSVs in a zip"
          >
            <Download size={13} /> Chat + EF (zip)
          </button>
        </div>
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
            <>
              <AffectPanel opts={affectOpts} onChange={setAffectOpts} />
              <AgreementPanel sessions={sessions} />
              {[...byUser.entries()].map(([userId, sess]) => (
                <div key={userId}>
                  <div className="mb-2 text-sm font-semibold text-slate-700">
                    {sess[0].userDisplayName ?? userId.slice(0, 8)}{' '}
                    <span className="text-slate-400">· {sess.length} session(s)</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                    {sess.map((s) => (
                      <SessionCard
                        key={s.sessionId}
                        s={s}
                        affect={affectOv[s.sessionId] ?? s.affect}
                        methods={affectOpts.methods}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SessionCard({ s, affect, methods }: { s: any; affect: any; methods: string[] }) {
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
        <span className="font-medium">{formatDateTimeSGT(s.startedAt)}</span>
        <span className="text-slate-400">
          {s.trimmed ? (
            <span
              className="mr-1 inline-flex items-center gap-0.5 rounded bg-sky-100 px-1 text-sky-700"
              title={`trimmed — retained ${fmtDur(s.durationSecs)} of ${fmtDur(s.fullDurationSecs ?? s.durationSecs)}`}
            >
              <Scissors size={10} /> trimmed
            </span>
          ) : null}
          {fmtDur(s.durationSecs)} · {s.courseTitle ?? 'no course'}
        </span>
      </div>

      {s.dataHealth && <DataHealth health={s.dataHealth} />}

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

      {/* 1d affect — per method (Part C) */}
      {affect && (
        <Section title="Affect (per method)">
          <div className="space-y-1.5">
            {(methods as string[]).map((m) => {
              const r = affect[m];
              if (!r) return null;
              return (
                <div key={m}>
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>{AFFECT_METHOD_LABEL[m] ?? m}</span>
                    {r.unresolvedConfusionEpisodes > 0 && (
                      <span
                        className="rounded bg-amber-100 px-1 text-amber-700"
                        title="confusion episodes that did not resolve to engagement within the persistence window"
                      >
                        {r.unresolvedConfusionEpisodes} unresolved confusion
                      </span>
                    )}
                  </div>
                  <AffectStateBar pct={r.pctByState} />
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
            {AFFECT_STATES.map((st) => (
              <span key={st} className="flex items-center gap-1">
                <span
                  className="h-2 w-2 rounded-sm"
                  style={{ background: AFFECT_STATE_COLOR[st] }}
                />
                {st}
              </span>
            ))}
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
                          {q.correct ? <Check size={12} /> : <X size={12} />}
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
        {s.coderOverrides && <CoderOverrides ov={s.coderOverrides} />}
      </Section>
    </div>
  );
}

/** Part A flow-back: how the coder confirmed/overrode the model on this session. */
function CoderOverrides({ ov }: { ov: { activity: any; affect: any } }) {
  const row = (label: string, o: any) => {
    if (!o || o.withGuess === 0) return null;
    return (
      <span
        className="inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-sky-700"
        title={`${o.marks} mark(s)`}
      >
        {label}: {o.agree}
        <Check size={11} /> / {o.override}
        <Pencil size={11} />
        {o.agreementPct != null ? ` (${(o.agreementPct * 100).toFixed(0)}%)` : ''}
      </span>
    );
  };
  const a = row('activity', ov.activity);
  const f = row('affect', ov.affect);
  if (!a && !f) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1" title="coder confirmed / overrode the model guess">
      {a}
      {f}
    </div>
  );
}

/** Fetched-vs-expected data diagnostics — raw stream counts + gap warnings. */
function DataHealth({ health }: { health: { counts: Record<string, number>; flags: string[] } }) {
  const c = health.counts;
  const chip = (label: string, n: number) => (
    <span
      key={label}
      className={`rounded px-1.5 py-0.5 ${n > 0 ? 'bg-slate-100 text-slate-500' : 'bg-rose-50 text-rose-600'}`}
      title={`${label}: ${n}`}
    >
      {label} {n}
    </span>
  );
  return (
    <div className="mb-2 space-y-1">
      <div className="flex flex-wrap gap-1 text-[10px]">
        {chip('snapshots', c.snapshots)}
        {chip('gaze', c.gaze)}
        {chip('AU', c.au)}
        {chip('face', c.emotion)}
        {chip('webcam', c.webcam)}
        {chip('chat', c.chatbot)}
      </div>
      {health.flags.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {health.flags.map((f) => (
            <span key={f} className="inline-flex items-center gap-1 text-[10px] text-amber-700">
              <TriangleAlert size={11} /> {f}
            </span>
          ))}
        </div>
      )}
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

// ── affect (Part C) ──
interface AffectOpts {
  methods: string[];
  activationThreshold: number;
  persistenceWindowMs: number;
  personBaseline: boolean;
}
const DEFAULT_AFFECT_OPTS: AffectOpts = {
  methods: ['au_mapping', 'openface_emotion', 'wickens', 'fused'],
  activationThreshold: 0.3,
  persistenceWindowMs: 3000,
  personBaseline: true,
};
const ALL_METHODS = ['au_mapping', 'openface_emotion', 'wickens', 'fused'];
const AFFECT_METHOD_LABEL: Record<string, string> = {
  au_mapping: 'AU mapping',
  openface_emotion: 'OpenFace emotion',
  wickens: 'Wickens (attention)',
  fused: 'Fused',
};
const AFFECT_STATES = ['confusion', 'frustration', 'engagement', 'boredom', 'delight', 'neutral'];
const AFFECT_STATE_COLOR: Record<string, string> = {
  confusion: '#f59e0b',
  frustration: '#ef4444',
  engagement: '#10b981',
  boredom: '#64748b',
  delight: '#a855f7',
  neutral: '#e2e8f0',
};
function isDefaultAffect(o: AffectOpts): boolean {
  const d = DEFAULT_AFFECT_OPTS;
  return (
    o.activationThreshold === d.activationThreshold &&
    o.persistenceWindowMs === d.persistenceWindowMs &&
    o.personBaseline === d.personBaseline &&
    o.methods.length === d.methods.length
  );
}

function AffectStateBar({ pct }: { pct: Record<string, number> }) {
  return (
    <div className="flex h-3 w-full overflow-hidden rounded bg-slate-100">
      {AFFECT_STATES.filter((k) => (pct[k] ?? 0) > 0).map((k) => (
        <div
          key={k}
          style={{ width: `${(pct[k] ?? 0) * 100}%`, background: AFFECT_STATE_COLOR[k] }}
          title={`${k} ${((pct[k] ?? 0) * 100).toFixed(0)}%`}
        />
      ))}
    </div>
  );
}

function AffectPanel({ opts, onChange }: { opts: AffectOpts; onChange: (o: AffectOpts) => void }) {
  const toggleMethod = (m: string) =>
    onChange({
      ...opts,
      methods: opts.methods.includes(m)
        ? opts.methods.filter((x) => x !== m)
        : [...ALL_METHODS.filter((x) => opts.methods.includes(x) || x === m)],
    });
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-semibold text-slate-600">Affect thresholds</span>
        <span className="text-[10px] text-slate-400">live recompute · D'Mello/Pekrun states</span>
        {!isDefaultAffect(opts) && (
          <button
            onClick={() => onChange(DEFAULT_AFFECT_OPTS)}
            className="ml-auto text-slate-400 hover:text-slate-700"
          >
            reset
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">methods</span>
          {ALL_METHODS.map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={opts.methods.includes(m)}
                onChange={() => toggleMethod(m)}
              />
              {AFFECT_METHOD_LABEL[m]}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <span className="text-slate-400">activation</span>
          <input
            type="range"
            min={0.1}
            max={0.7}
            step={0.05}
            value={opts.activationThreshold}
            onChange={(e) => onChange({ ...opts, activationThreshold: Number(e.target.value) })}
          />
          <span className="tabular-nums">{opts.activationThreshold.toFixed(2)}</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-slate-400">persistence</span>
          <input
            type="range"
            min={1000}
            max={12000}
            step={500}
            value={opts.persistenceWindowMs}
            onChange={(e) => onChange({ ...opts, persistenceWindowMs: Number(e.target.value) })}
          />
          <span className="tabular-nums">{(opts.persistenceWindowMs / 1000).toFixed(1)}s</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={opts.personBaseline}
            onChange={(e) => onChange({ ...opts, personBaseline: e.target.checked })}
          />
          <span>person baseline</span>
        </label>
      </div>
    </div>
  );
}

// ── machine-vs-coder agreement (PR5) ──
type AgreeStats = { n: number; po: number; kappa: number | null; pabak: number };

/** Cohen's κ + PABAK over (machineGuess, coderLabel) pairs for one dimension. */
function agreementFor(pairs: Array<[string, string]>): AgreeStats | null {
  const n = pairs.length;
  if (n === 0) return null;
  const cats = [...new Set(pairs.flat())];
  const rowM: Record<string, number> = {}; // machine marginals
  const colM: Record<string, number> = {}; // coder marginals
  let agree = 0;
  for (const [m, c] of pairs) {
    rowM[m] = (rowM[m] ?? 0) + 1;
    colM[c] = (colM[c] ?? 0) + 1;
    if (m === c) agree += 1;
  }
  const po = agree / n;
  const pe = cats.reduce((s, k) => s + ((rowM[k] ?? 0) / n) * ((colM[k] ?? 0) / n), 0);
  const kappa = pe >= 1 ? null : (po - pe) / (1 - pe);
  return { n, po, kappa, pabak: 2 * po - 1 };
}

/** Cohort agreement across every coded timeline mark that carried a model guess. */
function cohortAgreement(sessions: any[]): {
  activity: AgreeStats | null;
  affect: AgreeStats | null;
} {
  const collect = (dim: string): Array<[string, string]> => {
    const out: Array<[string, string]> = [];
    for (const s of sessions)
      for (const c of s.coderCoding ?? [])
        if (c.dimension === dim && c.machineGuess != null && c.codingPass === 'timeline')
          out.push([c.machineGuess, c.codeLabel]);
    return out;
  };
  return { activity: agreementFor(collect('activity')), affect: agreementFor(collect('affect')) };
}

function fmtK(k: number | null): string {
  return k == null ? '—' : k.toFixed(2);
}
function kappaLabel(k: number | null): string {
  if (k == null) return '';
  if (k < 0) return 'poor';
  if (k < 0.2) return 'slight';
  if (k < 0.4) return 'fair';
  if (k < 0.6) return 'moderate';
  if (k < 0.8) return 'substantial';
  return 'almost perfect';
}

function AgreementPanel({ sessions }: { sessions: any[] }) {
  const agree = useMemo(() => cohortAgreement(sessions), [sessions]);
  const rows = (['activity', 'affect'] as const)
    .map((dim) => ({ dim, st: agree[dim] }))
    .filter((r) => r.st && r.st.n > 0);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-semibold text-slate-600">Coder vs. model agreement</span>
        <span className="text-[10px] text-slate-400">
          over timeline marks where the coder accepted/overrode a model guess
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="text-slate-400">
          No confirmed/overridden marks yet — accept or override model guesses in the timeline coder
          (<Bot size={12} className="inline align-[-2px]" /> lanes) to populate this.
        </div>
      ) : (
        <table className="w-full">
          <thead className="text-left text-[10px] uppercase text-slate-400">
            <tr>
              <th className="py-0.5">dimension</th>
              <th>n</th>
              <th>observed</th>
              <th>Cohen's κ</th>
              <th>PABAK</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ dim, st }) => (
              <tr key={dim} className="border-t border-slate-100">
                <td className="py-0.5 capitalize text-slate-600">{dim}</td>
                <td className="tabular-nums">{st!.n}</td>
                <td className="tabular-nums">{(st!.po * 100).toFixed(0)}%</td>
                <td className="tabular-nums">
                  {fmtK(st!.kappa)} <span className="text-slate-400">{kappaLabel(st!.kappa)}</span>
                </td>
                <td className="tabular-nums">{st!.pabak.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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

// ── one-file CSV export (PR5+): items down the rows, one column per session ──
const csvEsc = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const pct1 = (v: number | null | undefined): string => (v == null ? '' : (v * 100).toFixed(1));
const IV_TYPES = [
  'PRACTICE_TESTING',
  'DISTRIBUTED_PRACTICE',
  'STEPWISE_LEARNING',
  'INTERROGATIVE_ELABORATION',
];
const ACTIVITY_BUCKETS = [
  'reading_lesson',
  'chatbot',
  'intervention',
  'navigating',
  'idle',
  'off_task',
];
const HEALTH_KEYS = ['snapshots', 'gaze', 'au', 'emotion', 'webcam', 'chatbot', 'dialogue'];

function sessionColHeader(s: any): string {
  const who = s.userDisplayName ?? s.userId?.slice(0, 8) ?? 'session';
  const when = s.startedAt ? formatDateTimeSGT(s.startedAt) : '';
  return when ? `${who} · ${when}` : who;
}

/** Build the cohort report as a transposed CSV: row 1 = sessions, col 1 = item. */
function buildCohortCsv(sessions: any[], affectFor: (s: any) => any): string {
  type Row = { label: string; get: (s: any, aff: any) => unknown };
  const rows: Row[] = [];
  const add = (label: string, get: (s: any, aff: any) => unknown) => rows.push({ label, get });

  // identity
  add('User', (s) => s.userDisplayName ?? s.userId?.slice(0, 8));
  add('Session ID', (s) => s.sessionId);
  add('Course', (s) => s.courseTitle ?? '');
  add('Started', (s) => (s.startedAt ? formatDateTimeSGT(s.startedAt) : ''));
  add('Ended', (s) => (s.endedAt ? formatDateTimeSGT(s.endedAt) : ''));
  add('Duration (s)', (s) => s.durationSecs);

  // interventions (1a)
  add('Interventions — system total', (s) => s.interventions.system.total);
  for (const t of IV_TYPES) add(`  system: ${t}`, (s) => s.interventions.system.byType?.[t] ?? 0);
  add('Interventions — coder total', (s) => s.interventions.coder.total);
  for (const t of [...IV_TYPES, 'uncoded'])
    add(`  coder: ${t}`, (s) => s.interventions.coder.byType?.[t] ?? 0);
  add('Interventions — disagreement |sys−coder|', (s) => s.interventions.disagreement);

  // time-spent per learning intervention (from ActivityEvent spans)
  add('Intervention time (s) — total', (s) => s.interventionTime?.totalSec ?? 0);
  for (const t of IV_TYPES) add(`  time (s): ${t}`, (s) => s.interventionTime?.byType?.[t] ?? 0);

  // activity (1b)
  for (const k of ACTIVITY_BUCKETS)
    add(`Activity % — ${k}`, (s) => pct1(s.activity?.pctByActivity?.[k]));
  add('Reading-but-gaze-elsewhere %', (s) => pct1(s.activity?.pctReadingButGazeElsewhere));
  add('Allocation score', (s) =>
    s.activity?.allocationScore != null ? s.activity.allocationScore.toFixed(3) : '',
  );

  // affect per method (1d)
  for (const m of ALL_METHODS) {
    for (const st of AFFECT_STATES)
      add(`Affect[${m}] % — ${st}`, (_s, aff) => pct1(aff?.[m]?.pctByState?.[st]));
    add(`Affect[${m}] — transitions`, (_s, aff) => aff?.[m]?.transitions?.length ?? '');
    add(
      `Affect[${m}] — unresolved confusion`,
      (_s, aff) => aff?.[m]?.unresolvedConfusionEpisodes ?? '',
    );
  }
  add('Affect frames — AU', (s) => s.affectFrames?.au ?? '');
  add('Affect frames — emotion', (s) => s.affectFrames?.emotion ?? '');
  add('Affect frames — pupil', (s) => s.affectFrames?.pupil ?? '');

  // practice testing (1c)
  add('Practice tests — count', (s) => s.practiceTesting?.length ?? 0);
  add('Practice tests — avg score', (s) => {
    const arr = (s.practiceTesting ?? [])
      .map((p: any) => p.score)
      .filter((x: any) => typeof x === 'number');
    return arr.length
      ? (arr.reduce((a: number, b: number) => a + b, 0) / arr.length).toFixed(1)
      : '';
  });
  add('Practice tests — MCQ correct/total', (s) => {
    const pt = s.practiceTesting ?? [];
    const c = pt.reduce((a: number, p: any) => a + (p.mcqCorrect || 0), 0);
    const t = pt.reduce((a: number, p: any) => a + (p.mcqTotal || 0), 0);
    return t ? `${c}/${t}` : '';
  });
  add('Practice tests — short correct/total', (s) => {
    const pt = s.practiceTesting ?? [];
    const c = pt.reduce((a: number, p: any) => a + (p.shortAnswerCorrect || 0), 0);
    const t = pt.reduce((a: number, p: any) => a + (p.shortAnswerTotal || 0), 0);
    return t ? `${c}/${t}` : '';
  });

  // EF (1e)
  add('EF detections — count', (s) => s.efDetections?.length ?? 0);

  // coder coding + flow-back (1f / Part A)
  add('Coder marks — count', (s) => s.coderCoding?.length ?? 0);
  const ov = (dim: string) => (s: any) => s.coderOverrides?.[dim];
  add('Coder vs model — activity agree/override', (s) => {
    const o = ov('activity')(s);
    return o && o.withGuess ? `${o.agree}/${o.override}` : '';
  });
  add('Coder vs model — activity agreement %', (s) => pct1(ov('activity')(s)?.agreementPct));
  add('Coder vs model — affect agree/override', (s) => {
    const o = ov('affect')(s);
    return o && o.withGuess ? `${o.agree}/${o.override}` : '';
  });
  add('Coder vs model — affect agreement %', (s) => pct1(ov('affect')(s)?.agreementPct));

  // data diagnostics
  for (const k of HEALTH_KEYS) add(`Data — ${k}`, (s) => s.dataHealth?.counts?.[k] ?? '');
  add('Data — flags', (s) => (s.dataHealth?.flags ?? []).join(' | '));

  const header = ['item', ...sessions.map(sessionColHeader)];
  const lines = [header.map(csvEsc).join(',')];
  for (const r of rows) {
    const cells = [r.label, ...sessions.map((s) => r.get(s, affectFor(s)))];
    lines.push(cells.map(csvEsc).join(','));
  }
  return lines.join('\r\n');
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
