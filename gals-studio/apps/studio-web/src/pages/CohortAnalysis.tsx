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
        <span className="font-medium">{new Date(s.startedAt).toLocaleString()}</span>
        <span className="text-slate-400">
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
      <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-700" title={`${o.marks} mark(s)`}>
        {label}: {o.agree}✓ / {o.override}✎{' '}
        {o.agreementPct != null ? `(${(o.agreementPct * 100).toFixed(0)}%)` : ''}
      </span>
    );
  };
  const a = row('activity', ov.activity);
  const f = row('affect', ov.affect);
  if (!a && !f) return null;
  return (
    <div
      className="mt-1 flex flex-wrap gap-1"
      title="coder confirmed (✓) / overrode (✎) the model guess"
    >
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
            <span key={f} className="text-[10px] text-amber-700">
              ⚠ {f}
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
          (🤖 lanes) to populate this.
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
