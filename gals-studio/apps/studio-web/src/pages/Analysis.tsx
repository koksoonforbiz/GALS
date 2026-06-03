import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type Tab = 'reliability' | 'dynamics' | 'attention' | 'reading' | 'groundtruth' | 'export';
const TABS: Tab[] = ['reliability', 'dynamics', 'attention', 'reading', 'groundtruth', 'export'];

export function Analysis() {
  const [tab, setTab] = useState<Tab>('reliability');
  const [sessions, setSessions] = useState<any[]>([]);
  const [session, setSession] = useState<string>('');

  useEffect(() => {
    api.sessions().then((r) => {
      setSessions(r.sessions);
      setSession((s) => s || r.sessions[0]?.id || '');
    });
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-bold">Analysis</h1>
        <nav className="flex gap-1">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded px-3 py-1 text-sm capitalize ${tab === t ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}>{t}</button>
          ))}
        </nav>
        {tab !== 'reliability' && tab !== 'export' && (
          <select value={session} onChange={(e) => setSession(e.target.value)} className="ml-auto rounded border border-slate-300 px-2 py-1 text-sm">
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.userDisplayName ?? s.id.slice(0, 8)}</option>)}
          </select>
        )}
      </div>

      {tab === 'reliability' && <Reliability sessions={sessions} />}
      {tab === 'dynamics' && session && <Dynamics session={session} />}
      {tab === 'attention' && session && <Attention session={session} />}
      {tab === 'reading' && session && <Reading session={session} />}
      {tab === 'groundtruth' && session && <GroundTruth session={session} />}
      {tab === 'export' && <Export sessions={sessions} />}
    </div>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={`rounded-lg border p-3 ${tone ?? 'border-slate-200 bg-white'}`}>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function Reliability({ sessions }: { sessions: any[] }) {
  const [scope, setScope] = useState('all');
  const [dimension, setDimension] = useState('affect');
  const [data, setData] = useState<any>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.reliability(scope, dimension).then(setData);
  }, [scope, dimension]);

  if (!data) return <div className="text-slate-400">Loading…</div>;
  const kappaTone = data.cautionHighKappa ? 'border-amber-400 bg-amber-50' : data.kappa >= 0.6 ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50';
  const gap = data.pabak - data.kappa;

  return (
    <div className="space-y-3">
      <div className="flex gap-2 text-sm">
        <select value={scope} onChange={(e) => setScope(e.target.value)} className="rounded border border-slate-300 px-2 py-1">
          <option value="all">All sessions</option>
          {sessions.map((s) => <option key={s.id} value={s.id}>{s.userDisplayName ?? s.id.slice(0, 8)}</option>)}
        </select>
        <select value={dimension} onChange={(e) => setDimension(e.target.value)} className="rounded border border-slate-300 px-2 py-1">
          <option value="affect">affect</option>
          <option value="behavior">behavior</option>
        </select>
        <button onClick={async () => { await api.saveReliability({ scope, dimension, save: true }); setSaved(true); setTimeout(() => setSaved(false), 2000); }} className="rounded bg-slate-900 px-3 py-1 text-white">
          {saved ? 'Saved ✓' : 'Compute & save'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Card label="Cohen's κ" value={fmt(data.kappa)} tone={kappaTone} sub={data.cautionHighKappa ? '⚠ >0.85 caution' : data.kappa >= 0.6 ? 'substantial' : 'below floor'} />
        <Card label="PABAK" value={fmt(data.pabak)} sub={gap > 0.2 ? `+${fmt(gap)} vs κ — prevalence-skewed` : 'close to κ'} />
        <Card label="Krippendorff α" value={fmt(data.krippendorffAlpha)} />
        <Card label="% agreement" value={`${Math.round(data.percentAgreement * 100)}%`} />
        <Card label="N windows" value={String(data.nWindows)} />
        <Card label="Disagreements" value={String(data.nDisagreements)} />
      </div>

      {data.cautionHighKappa && (
        <div className="rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-800">
          κ &gt; 0.85 — treat with skepticism (likely collapsed categories). Always read PABAK alongside κ.
        </div>
      )}

      <ConfusionMatrix cm={data.confusionMatrix} />

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <h3 className="mb-2 text-sm font-semibold text-slate-500">Per-code agreement (which codes drag reliability down)</h3>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-400"><tr><th>code</th><th>agreement</th><th>n</th></tr></thead>
          <tbody>
            {Object.entries(data.perCode as Record<string, any>).sort((a, b) => a[1].agreement - b[1].agreement).map(([code, c]) => (
              <tr key={code} className="border-t border-slate-100"><td>{code}</td><td>{Math.round(c.agreement * 100)}%</td><td>{c.total}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ConfusionMatrix({ cm }: { cm: { labels: string[]; matrix: number[][] } }) {
  if (!cm.labels.length) return <div className="text-slate-400">No paired windows.</div>;
  const max = Math.max(1, ...cm.matrix.flat());
  return (
    <div className="overflow-auto rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="mb-2 text-sm font-semibold text-slate-500">Confusion matrix (rater 1 rows × rater 2 cols)</h3>
      <table className="text-xs">
        <thead><tr><th></th>{cm.labels.map((l) => <th key={l} className="px-1 text-slate-400">{l.slice(0, 6)}</th>)}</tr></thead>
        <tbody>
          {cm.matrix.map((row, i) => (
            <tr key={i}>
              <td className="pr-2 text-slate-400">{cm.labels[i].slice(0, 10)}</td>
              {row.map((v, j) => (
                <td key={j} className="h-8 w-8 text-center" style={{ backgroundColor: `rgba(14,165,233,${v / max})`, color: v / max > 0.5 ? 'white' : '#0f172a' }}>{v || ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Dynamics({ session }: { session: string }) {
  const [data, setData] = useState<any>(null);
  const [res, setRes] = useState(2);
  useEffect(() => { api.dynamics(session, { resolutionWindows: res }).then(setData); }, [session, res]);
  if (!data) return <div className="text-slate-400">Loading…</div>;

  const colorOf = (c: string) => AFFECT_COLOR[c] ?? '#94a3b8';
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <h3 className="mb-2 text-sm font-semibold text-slate-500">Gold affect track ({data.track.filter((t: any) => t).length}/{data.track.length} windows)</h3>
        <div className="flex h-6 w-full overflow-hidden rounded">
          {data.track.map((c: string | null, i: number) => (
            <div key={i} className="flex-1" style={{ backgroundColor: c ? colorOf(c) : '#e2e8f0' }} title={`#${i}: ${c ?? 'uncoded'}`} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <h3 className="mb-2 text-sm font-semibold text-slate-500">Prevalence</h3>
          {Object.entries(data.prevalence.counts as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 text-xs">
              <span className="w-32 truncate">{k}</span>
              <div className="h-3 flex-1 rounded bg-slate-100"><div className="h-3 rounded" style={{ width: `${(data.prevalence.proportions[k] * 100).toFixed(0)}%`, backgroundColor: colorOf(k) }} /></div>
              <span className="w-16 text-right text-slate-400">{v} ({Math.round(data.prevalence.proportions[k] * 100)}%)</span>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <h3 className="mb-2 text-sm font-semibold text-slate-500">Dwell (mean seconds per state)</h3>
          {Object.entries(data.dwell.summary as Record<string, any>).map(([k, s]) => (
            <div key={k} className="flex justify-between text-xs"><span>{k}</span><span className="text-slate-400">{s.meanDwellSec.toFixed(0)}s × {s.nRuns} runs</span></div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-500">Cascade detector</h3>
          <label className="ml-auto text-xs">resolution windows
            <input type="number" min={1} max={5} value={res} onChange={(e) => setRes(Number(e.target.value))} className="ml-1 w-12 rounded border border-slate-300 px-1" />
          </label>
        </div>
        {data.unresolved.length === 0 ? (
          <div className="text-sm text-emerald-600">No unresolved confusion→frustration→boredom cascades.</div>
        ) : (
          data.unresolved.map((e: any, i: number) => (
            <div key={i} className="rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-700">
              ⚠ windows {e.startWindow}–{e.endWindow}: {e.sequence.join(' → ')}
            </div>
          ))
        )}
        <div className="mt-1 text-[11px] text-slate-400">Resolved (productive) confusion is excluded — only escalating, unresolved episodes are flagged.</div>
      </div>

      <TransitionMatrix t={data.transitions} colorOf={colorOf} />
    </div>
  );
}

function TransitionMatrix({ t, colorOf }: { t: any; colorOf: (c: string) => string }) {
  if (!t.states.length) return null;
  return (
    <div className="overflow-auto rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="mb-2 text-sm font-semibold text-slate-500">Transition matrix (P next | current)</h3>
      <table className="text-xs">
        <thead><tr><th></th>{t.states.map((s: string) => <th key={s} className="px-1 text-slate-400">{s.slice(0, 6)}</th>)}</tr></thead>
        <tbody>
          {t.states.map((from: string) => (
            <tr key={from}>
              <td className="pr-2" style={{ color: colorOf(from) }}>{from.slice(0, 10)}</td>
              {t.states.map((to: string) => {
                const p = t.probabilities[from][to];
                return <td key={to} className="h-8 w-10 text-center" style={{ backgroundColor: `rgba(139,92,246,${p})`, color: p > 0.5 ? 'white' : '#0f172a' }}>{p ? p.toFixed(2) : ''}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Attention({ session }: { session: string }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api.attention(session).then(setData).catch(() => setData({ error: true })); }, [session]);
  if (!data) return <div className="text-slate-400">Loading…</div>;
  if (data.error) return <div className="text-rose-500">No attention data.</div>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Card label="Session allocation score" value={fmt(data.sessionAllocation)} sub="TV distance from expected (0=match, 1=disjoint)" />
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <h3 className="mb-1 text-sm font-semibold text-slate-500">Session PDT</h3>
          {Object.entries(data.pdt as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([r, v]) => (
            <div key={r} className="flex items-center gap-2 text-xs"><span className="w-20">{r}</span><div className="h-3 flex-1 rounded bg-slate-100"><div className="h-3 rounded bg-sky-500" style={{ width: `${Math.round(v * 100)}%` }} /></div><span>{Math.round(v * 100)}%</span></div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <h3 className="mb-2 text-sm font-semibold text-slate-500">Epochs ({data.epochs.length}) · allocation_score per epoch</h3>
        <table className="w-full text-xs">
          <thead className="text-left text-slate-400"><tr><th>epoch</th><th>allocation</th><th>dominant region</th></tr></thead>
          <tbody>
            {data.epochs.map((e: any, i: number) => {
              const dom = Object.entries(e.pdt as Record<string, number>).sort((a, b) => b[1] - a[1])[0];
              return <tr key={i} className="border-t border-slate-100"><td>{e.type}</td><td>{fmt(e.allocationScore)}</td><td>{dom ? `${dom[0]} ${Math.round(dom[1] * 100)}%` : '—'}</td></tr>;
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <h3 className="mb-2 text-sm font-semibold text-slate-500">Gaze on-screen by quartile (sustained-attention proxy)</h3>
        <div className="flex gap-2">
          {data.quartiles.map((q: number, i: number) => (
            <div key={i} className="flex-1 text-center text-xs"><div className="text-slate-400">Q{i + 1}</div><div className="text-lg font-bold">{Math.round(q * 100)}%</div></div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Reading({ session }: { session: string }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api.reading(session).then(setData); }, [session]);
  if (!data) return <div className="text-slate-400">Loading…</div>;
  return (
    <div className="space-y-3">
      {data.windowScrollOnly && (
        <div className="rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-800">
          Low-confidence: only window scroll available (older bundle). Window scrollY is unreliable in the docked layout.
        </div>
      )}
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-400"><tr><th>content</th><th>furthest %</th><th>last %</th><th>pages</th><th>dwell</th></tr></thead>
          <tbody>
            {data.items.map((it: any, i: number) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="max-w-xs truncate">{it.pageUrl}</td>
                <td>{Math.round(it.pctRead * 100)}%</td>
                <td>{Math.round(it.lastPositionPct * 100)}%</td>
                <td>{it.pagesVisited.length || '—'}</td>
                <td>{Math.round(it.dwellSec)}s</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 text-[11px] text-slate-400">Derived from scrollHosts + PDF pages. Window scrollY is never used for progress.</div>
      </div>
    </div>
  );
}

function GroundTruth({ session }: { session: string }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api.groundTruth(session).then(setData).catch(() => setData({ error: true })); }, [session]);
  if (!data) return <div className="text-slate-400">Loading…</div>;
  if (data.error) return <div className="text-rose-500">No ground-truth data.</div>;

  const cv = data.convergentValidity;
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <h3 className="mb-2 text-sm font-semibold text-slate-500">ESM trajectory ({data.esmTrajectory.length} probes)</h3>
        {data.esmTrajectory.length === 0 ? (
          <div className="text-sm text-slate-400">No ESM/SAM probes in this session.</div>
        ) : (
          <Line series={data.esmTrajectory} keys={['valence', 'arousal', 'engagement']} />
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <h3 className="mb-2 text-sm font-semibold text-slate-500">Convergent validity (across all sessions; expected r ≈ 0.30–0.50)</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Scatter title="AEQ-S boredom ↔ coded boredom" v={cv.aeqBoredom_vs_codedBoredom} />
          <Scatter title="PANAS NA ↔ coded frustration" v={cv.panasNA_vs_codedFrustration} />
          <Scatter title="IMI interest ↔ ESM engagement" v={cv.imiInterest_vs_esmEngagement} />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <h3 className="mb-2 text-sm font-semibold text-slate-500">Scored questionnaires</h3>
        {data.questionnaires.length === 0 ? <div className="text-sm text-slate-400">None.</div> :
          data.questionnaires.map((q: any, i: number) => (
            <div key={i} className="text-xs"><span className="font-semibold">{q.instrument} ({q.phase}):</span> {JSON.stringify(q.scoredSubscales)}</div>
          ))}
      </div>
    </div>
  );
}

function Line({ series, keys }: { series: any[]; keys: string[] }) {
  const W = 600, H = 120;
  const ts = series.map((s) => s.t);
  const tMin = Math.min(...ts), tMax = Math.max(...ts) || 1;
  const colors: Record<string, string> = { valence: '#16a34a', arousal: '#dc2626', engagement: '#0ea5e9' };
  const x = (t: number) => ((t - tMin) / (tMax - tMin || 1)) * W;
  const y = (v: number) => H - Math.max(0, Math.min(1, v / 10)) * H; // assume 0-10 scale
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 140 }}>
      {keys.map((k) => {
        const pts = series.filter((s) => s[k] != null);
        const d = pts.length ? 'M' + pts.map((s) => `${x(s.t).toFixed(1)},${y(s[k]).toFixed(1)}`).join(' L') : '';
        return <path key={k} d={d} fill="none" stroke={colors[k]} strokeWidth={1.5} />;
      })}
      {keys.map((k, i) => <text key={k} x={4} y={12 + i * 12} fontSize={9} fill={colors[k]}>{k}</text>)}
    </svg>
  );
}

function Scatter({ title, v }: { title: string; v: { points: { x: number; y: number }[]; r: number } }) {
  const W = 180, H = 140;
  const xs = v.points.map((p) => p.x), ys = v.points.map((p) => p.y);
  const xMin = Math.min(...xs, 0), xMax = Math.max(...xs, 1);
  const yMin = Math.min(...ys, 0), yMax = Math.max(...ys, 1);
  const px = (x: number) => ((x - xMin) / (xMax - xMin || 1)) * (W - 20) + 10;
  const py = (y: number) => H - 10 - ((y - yMin) / (yMax - yMin || 1)) * (H - 20);
  return (
    <div>
      <div className="text-xs font-medium">{title}</div>
      <div className="text-xs text-slate-400">r = {Number.isFinite(v.r) ? v.r.toFixed(2) : 'n/a'} · n = {v.points.length}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full border border-slate-100" style={{ height: 120 }}>
        {v.points.map((p, i) => <circle key={i} cx={px(p.x)} cy={py(p.y)} r={3} fill="#8b5cf6" />)}
      </svg>
    </div>
  );
}

function Export({ sessions }: { sessions: any[] }) {
  const [scope, setScope] = useState('all');
  const kinds = [
    ['long', 'Windowed long-format (R/pandas)'],
    ['gold', 'Gold labels (one row per window)'],
    ['summary', 'Session-level summary'],
    ['reliability', 'Reliability runs'],
    ['probes', 'Probes'],
    ['questionnaires', 'Questionnaires'],
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span>Scope:</span>
        <select value={scope} onChange={(e) => setScope(e.target.value)} className="rounded border border-slate-300 px-2 py-1">
          <option value="all">All sessions</option>
          {sessions.map((s) => <option key={s.id} value={s.id}>{s.userDisplayName ?? s.id.slice(0, 8)}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {kinds.map(([kind, label]) => (
          <a key={kind} href={api.exportCsv(kind, scope)} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 hover:bg-slate-50">
            <span className="text-sm">{label}</span>
            <span className="rounded bg-slate-900 px-2 py-1 text-xs text-white">Download CSV</span>
          </a>
        ))}
      </div>
      <div className="text-xs text-slate-400">Headless equivalent: <code>studio-analyze --scope {scope} --out ./analysis-out</code></div>
    </div>
  );
}

const AFFECT_COLOR: Record<string, string> = {
  engaged_concentration: '#16a34a', confusion: '#f59e0b', frustration: '#dc2626', boredom: '#6b7280',
  delight: '#0ea5e9', surprise: '#8b5cf6', anxiety: '#db2777', neutral: '#94a3b8', unclear: '#cbd5e1',
};

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : '—';
}
