import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Pause, Play, SkipBack, TriangleAlert } from 'lucide-react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { PlayheadStore, usePlayhead, fmtRel, fmtWall } from '../replay/clock';
import { snapshotAt, nearestByWall, type SnapshotLite, type WebcamSeg } from '../replay/lookup';
import { DomStage, AOI_COLORS } from '../replay/DomStage';
import { WebcamPanel } from '../replay/WebcamPanel';
import { SignalTimeline, type Series } from '../replay/SignalTimeline';
import {
  affectScores,
  predictAffect,
  DEFAULT_THRESHOLDS,
  type AffectThresholds,
} from '../replay/affect';

const SPEEDS = [0.5, 1, 2, 4];

export function Replay() {
  const { sessionId = '' } = useParams();
  const [meta, setMeta] = useState<any>(null);
  const [snaps, setSnaps] = useState<SnapshotLite[]>([]);
  const [sparse, setSparse] = useState<any>(null);
  const [streams, setStreams] = useState<{
    emotions: Series;
    aus: Series;
    pupil: { t: number; v: number }[];
  } | null>(null);
  const [coverage, setCoverage] = useState<any>(null);
  const [thresholds, setThresholds] = useState<AffectThresholds>(DEFAULT_THRESHOLDS);
  const [showScreenshot, setShowScreenshot] = useState(false);
  const [aoiVisible, setAoiVisible] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);

  const storeRef = useRef<PlayheadStore | null>(null);
  if (!storeRef.current)
    storeRef.current = new PlayheadStore({ baseWallClockMs: 0, durationMs: 0 });
  const store = storeRef.current;
  const ph = usePlayhead(store);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [m, si, sp, st, cov] = await Promise.all([
          api.replayMeta(sessionId),
          api.replaySnapshotIndex(sessionId),
          api.replaySparse(sessionId),
          api.replayStreams(sessionId, ['emotions', 'aus', 'pupil']),
          api.replayCoverage(sessionId),
        ]);
        if (cancelled) return;
        setMeta(m);
        setSnaps(si.snapshots);
        setSparse(sp);
        setStreams(st);
        setCoverage(cov);
        store.setConfig({ baseWallClockMs: m.baseWallClockMs, durationMs: m.durationMs });
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const absoluteMs = (meta?.baseWallClockMs ?? 0) + ph.offsetMs;

  const emotionFrames = useMemo(() => {
    if (!streams?.emotions) return [];
    const keys = Object.keys(streams.emotions);
    const len = keys.length ? streams.emotions[keys[0]].length : 0;
    const frames: { t: number; probs: Record<string, number> }[] = [];
    for (let i = 0; i < len; i++) {
      const probs: Record<string, number> = {};
      let t = 0;
      for (const k of keys) {
        const pt = streams.emotions[k][i];
        if (pt) {
          probs[k] = pt.v;
          t = pt.t;
        }
      }
      frames.push({ t, probs });
    }
    return frames;
  }, [streams]);

  const affectSeries = useMemo<Series>(() => {
    const out: Series = { engagement: [], boredom: [], confusion: [], frustration: [] };
    for (const f of emotionFrames) {
      const s = affectScores(f.probs);
      out.engagement.push({ t: f.t, v: s.engagement });
      out.boredom.push({ t: f.t, v: s.boredom });
      out.confusion.push({ t: f.t, v: s.confusion });
      out.frustration.push({ t: f.t, v: s.frustration });
    }
    return out;
  }, [emotionFrames]);

  const currentSnapshot = useMemo(() => snapshotAt(snaps, absoluteMs), [snaps, absoluteMs]);
  const currentGaze = useMemo(
    () => (sparse ? nearestByWall(sparse.gaze, absoluteMs) : null),
    [sparse, absoluteMs],
  );
  const lastClick = useMemo(() => {
    if (!sparse) return null;
    let found: any = null;
    for (const c of sparse.clicks) {
      if (c.wallMs <= absoluteMs) found = c;
      else break;
    }
    return found ? { x: found.x, y: found.y, ageMs: absoluteMs - found.wallMs } : null;
  }, [sparse, absoluteMs]);

  const currentEmotion = useMemo(() => {
    if (emotionFrames.length === 0) return null;
    const off = ph.offsetMs;
    let best = emotionFrames[0];
    for (const f of emotionFrames) if (Math.abs(f.t - off) < Math.abs(best.t - off)) best = f;
    return best;
  }, [emotionFrames, ph.offsetMs]);

  const prediction = currentEmotion ? predictAffect(currentEmotion.probs, thresholds) : null;

  if (err)
    return (
      <Panel title="Replay">
        <TriangleAlert size={14} className="inline align-[-2px]" /> {err}
      </Panel>
    );
  if (!meta) return <div className="p-8 text-center text-slate-400">Loading replay…</div>;

  const aoiRegions: string[] = meta.aoiRegions ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
        <Link
          to="/"
          className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-700"
        >
          <ArrowLeft size={14} /> Library
        </Link>
        <div className="font-semibold">
          {meta.session.userDisplayName ?? meta.session.userId.slice(0, 8)}
        </div>
        <button
          onClick={() => store.restart()}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          <SkipBack size={14} />
        </button>
        <button
          onClick={() => store.toggle()}
          className="flex items-center gap-1 rounded bg-slate-900 px-3 py-1 text-sm text-white"
        >
          {ph.playing ? (
            <>
              <Pause size={14} /> Pause
            </>
          ) : (
            <>
              <Play size={14} /> Play
            </>
          )}
        </button>
        <input
          type="range"
          min={0}
          max={meta.durationMs}
          value={ph.offsetMs}
          onChange={(e) => store.seek(Number(e.target.value))}
          className="flex-1"
        />
        <span className="font-mono text-sm tabular-nums">
          {fmtRel(ph.offsetMs)} / {fmtRel(meta.durationMs)}
        </span>
        <span className="font-mono text-xs text-slate-400">{fmtWall(absoluteMs)}</span>
        <select
          value={ph.speed}
          onChange={(e) => store.setSpeed(Number(e.target.value))}
          className="rounded border border-slate-300 px-1 py-1 text-sm"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <Link
          to={`/coding/${sessionId}`}
          className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-1 text-sm text-white"
        >
          Code <ArrowRight size={14} />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_360px]">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              onClick={() => setShowScreenshot((v) => !v)}
              className="rounded border border-slate-300 px-2 py-1"
            >
              {showScreenshot ? 'Show DOM' : 'Show pixels'}
            </button>
            {aoiRegions.map((r) => (
              <button
                key={r}
                onClick={() => setAoiVisible((v) => ({ ...v, [r]: v[r] === false }))}
                className="rounded px-1.5 py-0.5"
                style={{
                  backgroundColor: (AOI_COLORS[r] ?? '#475569') + '22',
                  color: AOI_COLORS[r] ?? '#475569',
                  opacity: aoiVisible[r] === false ? 0.4 : 1,
                }}
              >
                {r}
              </button>
            ))}
          </div>
          <DomStage
            sessionId={sessionId}
            snapshot={currentSnapshot}
            gaze={currentGaze as { x: number; y: number } | null}
            lastClick={lastClick}
            aoiVisible={aoiVisible}
            showScreenshot={showScreenshot}
          />
        </div>

        <div className="space-y-3">
          <Panel title="Camera">
            <WebcamPanel
              segments={(sparse?.webcam ?? []) as WebcamSeg[]}
              absoluteMs={absoluteMs}
              playing={ph.playing}
            />
          </Panel>

          <Panel title="Facial Signals">
            {currentEmotion ? (
              <div className="space-y-1">
                {Object.entries(currentEmotion.probs).map(([k, v]) => (
                  <Bar key={k} label={k} value={v} />
                ))}
                {prediction && (
                  <div className="mt-2 rounded bg-slate-100 px-2 py-1 text-sm">
                    Predicted: <span className="font-semibold">{prediction.state}</span>
                  </div>
                )}
                <div className="mt-2 space-y-1">
                  {(Object.keys(thresholds) as (keyof AffectThresholds)[]).map((k) => (
                    <label key={k} className="flex items-center gap-2 text-xs">
                      <span className="w-24">{k}</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={thresholds[k]}
                        onChange={(e) =>
                          setThresholds((t) => ({ ...t, [k]: Number(e.target.value) }))
                        }
                        className="flex-1"
                      />
                      <span className="w-8 tabular-nums">{thresholds[k].toFixed(2)}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-400">No facial data</div>
            )}
          </Panel>

          <Panel title="Gaze Coverage by Region">
            {coverage && Object.keys(coverage.pdt).length ? (
              Object.entries(coverage.pdt as Record<string, number>)
                .sort((a, b) => b[1] - a[1])
                .map(([r, v]) => <Bar key={r} label={r} value={v} color={AOI_COLORS[r]} />)
            ) : (
              <div className="text-sm text-slate-400">No gaze coverage</div>
            )}
          </Panel>

          <Panel title="Reading Position">
            {currentSnapshot ? (
              <div className="space-y-1 text-sm">
                {currentSnapshot.pdfTotalPages ? (
                  <div>
                    PDF page {currentSnapshot.pdfCurrentPage} / {currentSnapshot.pdfTotalPages}
                  </div>
                ) : null}
                {(() => {
                  const lesson =
                    currentSnapshot.scrollHosts.find((h) => h.region === 'lesson') ??
                    currentSnapshot.scrollHosts[0];
                  if (!lesson) return <div className="text-slate-400">No inner-scroll host</div>;
                  const denom = lesson.scrollHeight - lesson.clientHeight;
                  const pct = denom > 0 ? Math.round((lesson.scrollTop / denom) * 100) : 0;
                  return (
                    <div>
                      Lesson scroll: <span className="font-semibold">{pct}%</span>
                    </div>
                  );
                })()}
                <div className="text-[11px] text-slate-400">
                  window scrollY is diagnostic only (pinned near 0 in docked layout)
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-400">—</div>
            )}
          </Panel>

          <Panel title="Coverage diagnostics">
            <div className="grid grid-cols-2 gap-1 text-xs text-slate-600">
              {Object.entries(meta.counts).map(([k, v]) => (
                <div key={k}>
                  <span className="text-slate-400">{k}</span> {String(v)}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {streams && (
        <SignalTimeline
          durationMs={meta.durationMs}
          baseWallClockMs={meta.baseWallClockMs}
          emotions={streams.emotions}
          affect={affectSeries}
          aus={streams.aus}
          thresholds={thresholds}
          offsetMs={ph.offsetMs}
          events={{
            clicks: sparse?.clicks ?? [],
            chatbot: sparse?.chatbot ?? [],
            dialogue: sparse?.dialogue ?? [],
            interventions: sparse?.interventions ?? [],
            efDetections: sparse?.efDetections ?? [],
            visibility: sparse?.visibility ?? [],
            probes: sparse?.probes ?? [],
          }}
          onSeek={(o) => store.seek(o)}
        />
      )}

      <ActivityList
        sparse={sparse}
        base={meta.baseWallClockMs}
        onSeek={(abs) => store.seekAbsolute(abs)}
      />
    </div>
  );
}

function ActivityList({
  sparse,
  base,
  onSeek,
}: {
  sparse: any;
  base: number;
  onSeek: (abs: number) => void;
}) {
  const rows = useMemo(() => {
    if (!sparse) return [];
    const items: { wallMs: number; type: string; text: string }[] = [];
    for (const m of sparse.chatbot)
      items.push({ wallMs: m.wallMs, type: 'chat', text: `${m.role}: ${m.content?.slice(0, 80)}` });
    for (const m of sparse.dialogue)
      items.push({
        wallMs: m.wallMs,
        type: 'dialogue',
        text: `${m.role}: ${m.content?.slice(0, 80)}`,
      });
    for (const d of sparse.efDetections)
      items.push({ wallMs: d.wallMs, type: 'ef', text: `${d.construct} (${d.label})` });
    for (const iv of sparse.interventions)
      items.push({
        wallMs: iv.wallMs,
        type: 'intervention',
        text: `${iv.type ?? 'intervention'} — ${iv.status ?? ''}`,
      });
    for (const p of sparse.probes)
      items.push({ wallMs: p.wallMs, type: 'probe', text: p.probeType });
    return items.sort((a, b) => a.wallMs - b.wallMs);
  }, [sparse]);

  const BADGE: Record<string, string> = {
    chat: 'bg-sky-100 text-sky-700',
    dialogue: 'bg-sky-100 text-sky-700',
    ef: 'bg-rose-100 text-rose-700',
    intervention: 'bg-violet-100 text-violet-700',
    probe: 'bg-emerald-100 text-emerald-700',
  };

  return (
    <Panel title={`Activity & conversation (${rows.length})`}>
      <div className="max-h-64 overflow-auto">
        {rows.map((r, i) => (
          <button
            key={i}
            onClick={() => onSeek(r.wallMs)}
            className="flex w-full items-center gap-2 border-b border-slate-100 px-1 py-1 text-left text-xs hover:bg-slate-50"
          >
            <span className="font-mono text-slate-400">{fmtRel(r.wallMs - base)}</span>
            <span className={`rounded px-1 ${BADGE[r.type] ?? 'bg-slate-100'}`}>{r.type}</span>
            <span className="truncate">{r.text}</span>
          </button>
        ))}
        {rows.length === 0 && <div className="p-3 text-center text-slate-400">No activity</div>}
      </div>
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
      >
        {title}
        <span>{open ? '−' : '+'}</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

function Bar({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 truncate text-slate-500">{label}</span>
      <div className="h-2 flex-1 rounded bg-slate-100">
        <div
          className="h-2 rounded"
          style={{ width: `${Math.round(value * 100)}%`, backgroundColor: color ?? '#0ea5e9' }}
        />
      </div>
      <span className="w-9 tabular-nums text-slate-400">{Math.round(value * 100)}%</span>
    </div>
  );
}
