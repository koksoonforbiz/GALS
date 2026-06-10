import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { snapshotAt, type SnapshotLite } from './lookup';
import { AOI_COLORS } from './DomStage';

type Pt = { t: number; v: number };
type Series = Record<string, Pt[]>;
interface GazeSample {
  wallMs: number;
  x: number;
  y: number;
  confidence?: number | null;
}
interface EfDetection {
  wallMs: number;
  construct: string;
  label: string;
  severity?: string | null;
  confidence?: number | null;
}
interface Win {
  id: string;
  index: number;
  startWallMs: number;
  endWallMs: number;
}

const BUF = 5000; // match the WindowScrubber ±5s context

const SEV_COLOR: Record<string, string> = {
  high: '#dc2626',
  medium: '#f59e0b',
  low: '#10b981',
};

/**
 * Per-window signal panel for coders: AOI gaze-dwell, pupil size, facial AUs,
 * facial-affect probabilities, and a temporal strip of EF detections — all
 * scoped to the active coding window (±5s context) and time-aligned with the
 * playhead. Stream data is fetched windowed via /streams?from&to; AOI dwell is
 * computed client-side from gaze × snapshot AOIs.
 */
export function WindowSignals({
  sessionId,
  win,
  base,
  offsetMs,
  gaze,
  snapshots,
  efDetections,
}: {
  sessionId: string;
  win: Win;
  base: number;
  offsetMs: number;
  gaze: GazeSample[];
  snapshots: SnapshotLite[];
  efDetections: EfDetection[];
}) {
  const [aus, setAus] = useState<Series | null>(null);
  const [emotions, setEmotions] = useState<Series | null>(null);
  const [pupil, setPupil] = useState<Pt[] | null>(null);
  const [loading, setLoading] = useState(true);

  const t0 = Math.max(0, win.startWallMs - base - BUF);
  const t1 = win.endWallMs - base + BUF;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .replayStreams(sessionId, ['aus', 'pupil', 'emotions'], t0, t1)
      .then((s) => {
        if (cancelled) return;
        setAus(s.aus ?? {});
        setEmotions(s.emotions ?? {});
        setPupil(s.pupil ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setAus({});
        setEmotions({});
        setPupil([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, win.id]);

  // AOI gaze-dwell over the coded window (not the ±5s buffer).
  const aoi = useMemo(() => {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const g of gaze) {
      if (g.wallMs < win.startWallMs || g.wallMs > win.endWallMs) continue;
      const snap = snapshotAt(snapshots, g.wallMs);
      if (!snap) continue;
      total += 1;
      const hit = snap.aois.find(
        (a) => g.x >= a.x && g.x <= a.x + a.width && g.y >= a.y && g.y <= a.y + a.height,
      );
      const key = hit ? hit.region : 'off-AOI';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const rows = Object.entries(counts)
      .map(([region, n]) => ({ region, pct: total ? n / total : 0 }))
      .sort((a, b) => b.pct - a.pct);
    return { rows, total };
  }, [gaze, snapshots, win.id]);

  const efInWin = useMemo(
    () =>
      efDetections.filter(
        (d) => d.wallMs >= win.startWallMs - BUF && d.wallMs <= win.endWallMs + BUF,
      ),
    [efDetections, win.startWallMs, win.endWallMs],
  );

  const playheadPct = clampPct(((offsetMs - t0) / (t1 - t0 || 1)) * 100);
  const span = t1 - t0 || 1;
  const winLeft = clampPct(((win.startWallMs - base - t0) / span) * 100);
  const winRight = clampPct(((win.endWallMs - base - t0) / span) * 100);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-slate-500">Window signals · window {win.index}</span>
        <span className="text-slate-400">±5s context · {aoi.total} gaze samples</span>
      </div>

      {/* Detection temporal strip (EF detections positioned in time) */}
      <Section title="Detections (temporal)">
        <div className="relative h-9 rounded bg-slate-100">
          <div
            className="absolute top-0 h-full bg-sky-200/60"
            style={{ left: `${winLeft}%`, width: `${winRight - winLeft}%` }}
          />
          {efInWin.map((d, i) => (
            <div
              key={i}
              className="absolute top-1 flex flex-col items-center"
              style={{
                left: `${clampPct(((d.wallMs - base - t0) / span) * 100)}%`,
                transform: 'translateX(-50%)',
              }}
              title={`${d.construct} — ${d.label}${d.severity ? ` (${d.severity})` : ''}${d.confidence != null ? ` · conf ${d.confidence.toFixed(2)}` : ''}`}
            >
              <span
                className="h-3 w-3 rounded-full border border-white"
                style={{ background: SEV_COLOR[d.severity ?? ''] ?? '#6366f1' }}
              />
              <span className="mt-0.5 max-w-[80px] truncate text-[9px] text-slate-500">
                {d.construct}
              </span>
            </div>
          ))}
          <div
            className="absolute top-0 h-full w-0.5 bg-slate-900"
            style={{ left: `${playheadPct}%` }}
          />
          {efInWin.length === 0 && (
            <span className="absolute left-1 top-2.5 text-slate-400">
              No EF detections in this window
            </span>
          )}
        </div>
      </Section>

      {/* AOI dwell */}
      <Section title="Attention — AOI gaze dwell">
        {aoi.rows.length === 0 ? (
          <div className="text-slate-400">No gaze in window</div>
        ) : (
          <div className="space-y-0.5">
            {aoi.rows.map((r) => (
              <Bar
                key={r.region}
                label={r.region}
                value={r.pct}
                color={r.region === 'off-AOI' ? '#94a3b8' : (AOI_COLORS[r.region] ?? '#475569')}
              />
            ))}
          </div>
        )}
      </Section>

      {/* Pupil */}
      <Section title="Pupil size">
        {loading ? (
          <Loading />
        ) : pupil && pupil.length ? (
          <div className="flex items-center gap-2">
            <Sparkline
              points={pupil}
              t0={t0}
              t1={t1}
              offsetMs={offsetMs}
              color="#0891b2"
              width={220}
              height={28}
            />
            <span className="tabular-nums text-slate-500">
              now {fmtNum(valueAt(pupil, offsetMs))}
            </span>
          </div>
        ) : (
          <div className="text-slate-400">No pupil data</div>
        )}
      </Section>

      {/* Facial AUs */}
      <Section title={`Facial action units${aus ? ` (${Object.keys(aus).length})` : ''}`}>
        {loading ? (
          <Loading />
        ) : (
          <SeriesGrid
            series={aus ?? {}}
            t0={t0}
            t1={t1}
            offsetMs={offsetMs}
            color="#7c3aed"
            domain={[0, 3]}
          />
        )}
      </Section>

      {/* Facial affect */}
      <Section title="Facial affect (emotion probability)">
        {loading ? (
          <Loading />
        ) : (
          <SeriesGrid
            series={emotions ?? {}}
            t0={t0}
            t1={t1}
            offsetMs={offsetMs}
            color="#e11d48"
            domain={[0, 1]}
          />
        )}
      </Section>
    </div>
  );
}

function SeriesGrid({
  series,
  t0,
  t1,
  offsetMs,
  color,
  domain,
}: {
  series: Series;
  t0: number;
  t1: number;
  offsetMs: number;
  color: string;
  domain: [number, number];
}) {
  const keys = Object.keys(series)
    .filter((k) => series[k]?.length)
    .sort();
  if (keys.length === 0) return <div className="text-slate-400">No data in window</div>;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 lg:grid-cols-3">
      {keys.map((k) => (
        <div key={k} className="flex items-center gap-1">
          <span className="w-16 shrink-0 truncate text-slate-500" title={k}>
            {k}
          </span>
          <Sparkline
            points={series[k]}
            t0={t0}
            t1={t1}
            offsetMs={offsetMs}
            color={color}
            domain={domain}
            width={70}
            height={16}
          />
          <span className="w-8 shrink-0 tabular-nums text-[10px] text-slate-400">
            {fmtNum(valueAt(series[k], offsetMs))}
          </span>
        </div>
      ))}
    </div>
  );
}

function Sparkline({
  points,
  t0,
  t1,
  offsetMs,
  color,
  domain,
  width = 80,
  height = 18,
}: {
  points: Pt[];
  t0: number;
  t1: number;
  offsetMs: number;
  color: string;
  domain?: [number, number];
  width?: number;
  height?: number;
}) {
  if (!points.length) return <svg width={width} height={height} />;
  let ymin = domain ? domain[0] : Infinity;
  let ymax = domain ? domain[1] : -Infinity;
  if (!domain)
    for (const p of points) {
      if (p.v < ymin) ymin = p.v;
      if (p.v > ymax) ymax = p.v;
    }
  const span = t1 - t0 || 1;
  const nx = (t: number) => ((t - t0) / span) * width;
  const ny = (v: number) =>
    ymax > ymin ? height - ((v - ymin) / (ymax - ymin)) * height : height / 2;
  const d = points
    .map((p, i) => `${i ? 'L' : 'M'}${nx(p.t).toFixed(1)},${ny(p.v).toFixed(1)}`)
    .join(' ');
  const phx = clampNum(nx(offsetMs), 0, width);
  return (
    <svg width={width} height={height} className="rounded bg-slate-50">
      <path d={d} fill="none" stroke={color} strokeWidth={1} />
      <line x1={phx} y1={0} x2={phx} y2={height} stroke="#0f172a" strokeWidth={0.75} />
    </svg>
  );
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 truncate text-slate-500">{label}</span>
      <div className="h-2 flex-1 rounded bg-slate-100">
        <div
          className="h-2 rounded"
          style={{ width: `${Math.round(value * 100)}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-9 shrink-0 tabular-nums text-slate-400">{Math.round(value * 100)}%</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </div>
      {children}
    </div>
  );
}

function Loading() {
  return <div className="text-slate-400">Loading…</div>;
}

/** Nearest sample value to a relative-ms time. */
function valueAt(points: Pt[], t: number): number | null {
  if (!points.length) return null;
  let best = points[0];
  for (const p of points) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best.v;
}

function fmtNum(v: number | null): string {
  if (v == null) return '—';
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
}

function clampPct(p: number): number {
  return Math.max(0, Math.min(100, p));
}
function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
