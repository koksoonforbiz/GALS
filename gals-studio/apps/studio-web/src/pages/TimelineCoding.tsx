import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { PlayheadStore, usePlayhead, fmtRel } from '../replay/clock';
import { snapshotAt, type SnapshotLite, type WebcamSeg } from '../replay/lookup';
import { DomStage } from '../replay/DomStage';
import { WebcamPanel } from '../replay/WebcamPanel';
import { affectScores, type AffectThresholds, type EmotionProbs } from '../replay/affect';

/** Coder-drawn affect tiers — drag on the lane to mark a duration. */
const AFFECT_TRACKS = [
  { code: 'boredom', label: 'Boredom', color: '#f59e0b' },
  { code: 'engagement', label: 'Engagement', color: '#16a34a' },
  { code: 'confusion', label: 'Confusion', color: '#8b5cf6' },
  { code: 'frustration', label: 'Frustration', color: '#dc2626' },
] as const;

const LABEL_W = 150;
const ROW_H = 30;
const MIN_INTERVAL_MS = 500;

let rowSeq = 0;
const newRowId = () => `row${++rowSeq}`;

// Affect scores are modest weighted sums (typically 0.1–0.3), so detection
// thresholds sit far below the live tab's instantaneous-prediction defaults.
const DETECT_DEFAULTS: AffectThresholds = {
  engagement: 0.18,
  boredom: 0.16,
  confusion: 0.2,
  frustration: 0.22,
};
// Allow brief dips below threshold (sensor noise) without splitting one episode.
const DETECT_GAP_MS = 4000;

interface Interval {
  id: string;
  code: string;
  startWallMs: number;
  endWallMs: number;
  notes?: string | null;
}
type Streams = {
  aus: Record<string, { t: number; v: number }[]>;
  emotions: Record<string, { t: number; v: number }[]>;
  pupil: { t: number; v: number }[];
};
type DataRow =
  | { id: string; kind: 'au' | 'emotion'; key: string; color: string; domain: [number, number] }
  | { id: string; kind: 'pupil'; key: 'pupil'; color: string; domain?: undefined }
  | { id: string; kind: 'ef'; key: 'ef'; color: string; domain?: undefined };

export function TimelineCoding() {
  const { sessionId = '' } = useParams();
  const [meta, setMeta] = useState<any>(null);
  const [snaps, setSnaps] = useState<SnapshotLite[]>([]);
  const [sparse, setSparse] = useState<any>(null);
  const [streams, setStreams] = useState<Streams | null>(null);
  const [coders, setCoders] = useState<any[]>([]);
  const [coderId, setCoderId] = useState(() => localStorage.getItem('gals.coderId') ?? '');
  const [intervals, setIntervals] = useState<Interval[]>([]);
  const [review, setReview] = useState<{
    code: string;
    startMs: number;
    endMs: number;
    savedId: string | null;
  } | null>(null);
  const [looping, setLooping] = useState(true);
  const [showScreenshot, setShowScreenshot] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [dataRows, setDataRows] = useState<DataRow[]>([]);
  const [draft, setDraft] = useState<{ code: string; aMs: number; bMs: number } | null>(null);
  const [thresholds, setThresholds] = useState<AffectThresholds>(DETECT_DEFAULTS);
  const [detectMinSec, setDetectMinSec] = useState(30);
  const [showDetections, setShowDetections] = useState(true);

  const storeRef = useRef<PlayheadStore | null>(null);
  if (!storeRef.current)
    storeRef.current = new PlayheadStore({ baseWallClockMs: 0, durationMs: 0 });
  const store = storeRef.current;
  const ph = usePlayhead(store);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [areaW, setAreaW] = useState(900);

  useEffect(() => {
    (async () => {
      const [m, si, sp, cs, st] = await Promise.all([
        api.replayMeta(sessionId),
        api.replaySnapshotIndex(sessionId),
        api.replaySparse(sessionId),
        api.coders(),
        api.replayStreams(sessionId, ['aus', 'emotions', 'pupil']),
      ]);
      setMeta(m);
      setSnaps(si.snapshots);
      setSparse(sp);
      setCoders(cs.coders);
      setStreams({ aus: st.aus ?? {}, emotions: st.emotions ?? {}, pupil: st.pupil ?? [] });
      store.setConfig({ baseWallClockMs: m.baseWallClockMs, durationMs: m.durationMs });
    })();
  }, [sessionId]);

  const refreshIntervals = useCallback(async () => {
    if (!coderId) return;
    const r = await api.timelineIntervals(sessionId, coderId);
    setIntervals(r.intervals.filter((i: Interval) => i.startWallMs != null && i.endWallMs != null));
  }, [sessionId, coderId]);

  useEffect(() => {
    void refreshIntervals();
  }, [refreshIntervals]);
  useEffect(() => {
    if (coderId) localStorage.setItem('gals.coderId', coderId);
  }, [coderId]);

  // measure the visible track area (scroll viewport minus the label column)
  useEffect(() => {
    if (!scrollRef.current) return;
    const measure = () =>
      setAreaW(Math.max(200, (scrollRef.current?.clientWidth ?? 1050) - LABEL_W));
    const ro = new ResizeObserver(measure);
    ro.observe(scrollRef.current);
    measure();
    return () => ro.disconnect();
  }, [meta]);

  const durationMs = meta?.durationMs ?? 0;
  const base = meta?.baseWallClockMs ?? 0;
  const pxPerMs = durationMs > 0 ? (areaW * zoom) / durationMs : 0;
  const fullW = durationMs * pxPerMs;
  const xToOff = (xContent: number) => (pxPerMs > 0 ? xContent / pxPerMs : 0);
  const offToX = (off: number) => off * pxPerMs;

  const absoluteMs = base + ph.offsetMs;
  const currentSnapshot = useMemo(() => snapshotAt(snaps, absoluteMs), [snaps, absoluteMs]);
  const currentGaze = useMemo(
    () => (sparse?.gaze ? nearestGaze(sparse.gaze, absoluteMs) : null),
    [sparse, absoluteMs],
  );

  // model affective detections: contiguous runs where the emotion-derived affect
  // score stays at/above threshold for >= the min duration (values in relative ms).
  const detections = useMemo(
    () =>
      streams
        ? computeDetections(streams.emotions, thresholds, detectMinSec * 1000)
        : ({} as Record<string, { startMs: number; endMs: number }[]>),
    [streams, thresholds, detectMinSec],
  );

  // loop the segment under review
  useEffect(() => {
    if (!looping || !review || !ph.playing) return;
    if (ph.offsetMs >= review.endMs || ph.offsetMs < review.startMs - 200)
      store.seek(review.startMs);
  }, [ph.offsetMs, ph.playing, looping, review, store]);

  const createInterval = useCallback(
    async (code: string, startOff: number, endOff: number) => {
      if (!coderId) return;
      await api.upsertAnnotation({
        sessionId,
        coderId,
        codingPass: 'timeline',
        dimension: 'affect',
        code,
        startWallMs: Math.round(base + Math.min(startOff, endOff)),
        endWallMs: Math.round(base + Math.max(startOff, endOff)),
      });
      await refreshIntervals();
    },
    [coderId, sessionId, base, refreshIntervals],
  );

  // drag-to-create on an affect lane
  const beginDraft = (code: string) => (e: React.MouseEvent) => {
    if (!coderId || e.button !== 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const startMs = xToOff(e.clientX - rect.left);
    setDraft({ code, aMs: startMs, bMs: startMs });
    const move = (ev: MouseEvent) =>
      setDraft((d) => (d ? { ...d, bMs: xToOff(ev.clientX - rect.left) } : d));
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const endMs = xToOff(ev.clientX - rect.left);
      setDraft(null);
      if (Math.abs(endMs - startMs) >= MIN_INTERVAL_MS) void createInterval(code, startMs, endMs);
      else store.seek(startMs); // a click (not a drag) just seeks
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const delInterval = useCallback(
    async (id: string) => {
      await api.deleteAnnotation(id);
      setReview((r) => (r?.savedId === id ? null : r));
      await refreshIntervals();
    },
    [refreshIntervals],
  );

  const reviewInterval = (iv: Interval) => {
    setReview({
      code: iv.code,
      startMs: iv.startWallMs - base,
      endMs: iv.endWallMs - base,
      savedId: iv.id,
    });
    store.seek(iv.startWallMs - base);
    if (looping) store.play();
  };

  const reviewDetection = (code: string, startMs: number, endMs: number) => {
    setReview({ code, startMs, endMs, savedId: null });
    store.seek(startMs);
    if (looping) store.play();
  };

  const acceptReview = useCallback(async () => {
    if (!review || !coderId) return;
    await createInterval(review.code, review.startMs, review.endMs);
    setReview(null);
  }, [review, coderId, createInterval]);

  const addDataRow = (row: DataRow) => setDataRows((rows) => [...rows, row]);
  const removeDataRow = (id: string) => setDataRows((rows) => rows.filter((r) => r.id !== id));

  if (!meta) return <div className="p-8 text-center text-slate-400">Loading timeline studio…</div>;

  const interventions: { wallMs: number; type?: string; status?: string }[] =
    sparse?.interventions ?? [];
  const webcamSegs: WebcamSeg[] = (sparse?.webcam ?? []).filter(
    (s: WebcamSeg) => s.status === 'ok',
  );

  return (
    <div className="space-y-2">
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
        <Link to="/" className="text-slate-400 hover:text-slate-700">
          ← Library
        </Link>
        <span className="font-semibold">
          {meta.session.userDisplayName ?? meta.session.userId.slice(0, 8)}
        </span>
        <span className="text-slate-400">· timeline coding</span>
        <span className="mx-1 text-slate-300">|</span>
        <label>Coder:</label>
        <select
          value={coderId}
          onChange={(e) => setCoderId(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        >
          <option value="">— select —</option>
          {coders.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.role})
            </option>
          ))}
        </select>
        <Link
          to={`/coding/${sessionId}`}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        >
          window coding →
        </Link>
        <span className="ml-auto flex items-center gap-1 text-xs">
          zoom
          <button
            onClick={() => setZoom((z) => Math.max(1, z / 2))}
            className="rounded border border-slate-300 px-1.5"
          >
            −
          </button>
          <span className="w-8 text-center tabular-nums">{zoom}×</span>
          <button
            onClick={() => setZoom((z) => Math.min(64, z * 2))}
            className="rounded border border-slate-300 px-1.5"
          >
            +
          </button>
        </span>
      </div>

      {/* player */}
      <div className="grid grid-cols-[1fr_300px] gap-2">
        <div className="space-y-1">
          <button
            onClick={() => setShowScreenshot((v) => !v)}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs"
          >
            {showScreenshot ? '🖼 Pixels' : '⟨⟩ DOM'}
          </button>
          <DomStage
            sessionId={sessionId}
            snapshot={currentSnapshot}
            gaze={currentGaze}
            lastClick={null}
            aoiVisible={{}}
            showScreenshot={showScreenshot}
          />
        </div>
        <div className="space-y-2">
          <WebcamPanel
            segments={webcamSegs as WebcamSeg[]}
            absoluteMs={absoluteMs}
            playing={ph.playing}
          />
          <div className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-sm">
            <button
              onClick={() => store.toggle()}
              className="rounded bg-slate-900 px-3 py-1 text-white"
            >
              {ph.playing ? '⏸' : '▶'}
            </button>
            <button
              onClick={() => store.restart()}
              className="rounded border border-slate-300 px-2 py-1"
            >
              ⏮
            </button>
            <span className="font-mono text-xs tabular-nums">
              {fmtRel(ph.offsetMs)} / {fmtRel(durationMs)}
            </span>
          </div>
          {review ? (
            <div
              className="rounded border-2 bg-white p-2 text-xs"
              style={{ borderColor: colorFor(review.code) }}
            >
              <div className="font-semibold" style={{ color: colorFor(review.code) }}>
                {review.savedId ? 'Coded' : 'Detected'} {labelFor(review.code)} ·{' '}
                {fmtRel(review.endMs - review.startMs)}
              </div>
              <div className="text-slate-500">
                {fmtRel(review.startMs)} – {fmtRel(review.endMs)}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    store.seek(review.startMs);
                    store.play();
                  }}
                  className="rounded bg-slate-900 px-2 py-0.5 text-white"
                >
                  ▶ play segment
                </button>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={looping}
                    onChange={(e) => setLooping(e.target.checked)}
                  />{' '}
                  loop
                </label>
                {review.savedId ? (
                  <button
                    onClick={() => void delInterval(review.savedId!)}
                    className="ml-auto rounded border border-rose-300 px-2 py-0.5 text-rose-600"
                  >
                    delete
                  </button>
                ) : (
                  <button
                    onClick={() => void acceptReview()}
                    disabled={!coderId}
                    className="ml-auto rounded bg-emerald-600 px-2 py-0.5 text-white disabled:opacity-50"
                  >
                    ✓ accept as {labelFor(review.code)} mark
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded border border-dashed border-slate-300 p-2 text-xs text-slate-400">
              Detected affect segments (≥{detectMinSec}s over threshold) are shaded on each lane —
              click one to review, then ✓ accept. Or drag a lane to mark your own.
            </div>
          )}
        </div>
      </div>

      {!coderId && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Select a coder above to start marking.
        </div>
      )}

      {/* affect-detection settings */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
        <span className="font-semibold text-slate-500">Affect detection</span>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={showDetections}
            onChange={(e) => setShowDetections(e.target.checked)}
          />{' '}
          show on lanes
        </label>
        <label className="flex items-center gap-1">
          min duration
          <input
            type="number"
            min={1}
            max={600}
            value={detectMinSec}
            onChange={(e) => setDetectMinSec(Math.max(1, Number(e.target.value) || 1))}
            className="w-14 rounded border border-slate-300 px-1 py-0.5"
          />
          s
        </label>
        <span className="text-slate-300">|</span>
        <span className="text-slate-400">thresholds:</span>
        {(Object.keys(thresholds) as (keyof AffectThresholds)[]).map((k) => (
          <label key={k} className="flex items-center gap-1">
            <span style={{ color: colorFor(k) }}>{labelFor(k)}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={thresholds[k]}
              onChange={(e) => setThresholds((t) => ({ ...t, [k]: Number(e.target.value) }))}
              className="w-16"
            />
            <span className="w-7 tabular-nums text-slate-400">{thresholds[k].toFixed(2)}</span>
          </label>
        ))}
        <span className="ml-auto text-slate-400">
          {Object.values(detections).reduce((n, arr) => n + (arr as unknown[]).length, 0)} detected
          ≥{detectMinSec}s
        </span>
      </div>

      {/* timeline */}
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto" ref={scrollRef}>
          <div style={{ minWidth: LABEL_W + areaW }}>
            {/* ruler */}
            <Row label={<span className="text-[10px] text-slate-400">time</span>}>
              <Ruler durationMs={durationMs} offToX={offToX} fullW={fullW} />
            </Row>

            {/* webcam coverage */}
            <Row label="📹 webcam">
              <Lane fullW={fullW} onClickSeekPx={(x) => store.seek(xToOff(x))}>
                {webcamSegs.map((s, i) => {
                  const a = s.startWallMs - base;
                  const b = (s.endWallMs ?? s.startWallMs) - base;
                  return (
                    <div
                      key={i}
                      className="absolute top-1 h-4 rounded bg-slate-700/70"
                      style={{ left: offToX(a), width: Math.max(2, offToX(b - a)) }}
                      title={`video ${fmtRel(a)}–${fmtRel(b)}`}
                    />
                  );
                })}
                <Playhead x={offToX(ph.offsetMs)} />
              </Lane>
            </Row>

            {/* affect coder tiers */}
            {AFFECT_TRACKS.map((tr) => (
              <Row
                key={tr.code}
                label={
                  <span className="flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded" style={{ background: tr.color }} />
                    {tr.label}
                  </span>
                }
              >
                <Lane fullW={fullW} onMouseDownLane={beginDraft(tr.code)}>
                  {showDetections &&
                    (detections[tr.code] ?? []).map((d, i) => (
                      <div
                        key={`det${i}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          reviewDetection(tr.code, d.startMs, d.endMs);
                        }}
                        className="absolute inset-y-0 cursor-pointer"
                        style={{
                          left: offToX(d.startMs),
                          width: Math.max(2, offToX(d.endMs - d.startMs)),
                          background: `${tr.color}26`,
                          borderLeft: `2px solid ${tr.color}`,
                          borderRight: `2px solid ${tr.color}`,
                        }}
                        title={`detected ${tr.label} ${fmtRel(d.startMs)}–${fmtRel(d.endMs)} (${fmtRel(d.endMs - d.startMs)}) — click to review & code`}
                      />
                    ))}
                  {intervals
                    .filter((iv) => iv.code === tr.code)
                    .map((iv) => {
                      const a = iv.startWallMs - base;
                      const w = Math.max(3, offToX(iv.endWallMs - iv.startWallMs));
                      return (
                        <div
                          key={iv.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            reviewInterval(iv);
                          }}
                          className="absolute top-1 flex h-5 cursor-pointer items-center justify-center rounded text-[9px] text-white"
                          style={{
                            left: offToX(a),
                            width: w,
                            background: tr.color,
                            outline: review?.savedId === iv.id ? '2px solid #0f172a' : undefined,
                          }}
                          title={`${tr.label} ${fmtRel(a)}–${fmtRel(iv.endWallMs - base)} (${fmtRel(iv.endWallMs - iv.startWallMs)})`}
                        >
                          {w > 28 ? fmtRel(iv.endWallMs - iv.startWallMs) : ''}
                        </div>
                      );
                    })}
                  {draft && draft.code === tr.code && (
                    <div
                      className="absolute top-1 h-5 rounded opacity-50"
                      style={{
                        left: offToX(Math.min(draft.aMs, draft.bMs)),
                        width: Math.max(1, offToX(Math.abs(draft.bMs - draft.aMs))),
                        background: tr.color,
                      }}
                    />
                  )}
                  <Playhead x={offToX(ph.offsetMs)} />
                </Lane>
              </Row>
            ))}

            {/* learning interventions (data) */}
            <Row label="⚡ interventions">
              <Lane fullW={fullW} onClickSeekPx={(x) => store.seek(xToOff(x))}>
                {interventions.map((iv, i) => {
                  const a = iv.wallMs - base;
                  return (
                    <div
                      key={i}
                      onClick={(e) => {
                        e.stopPropagation();
                        store.seek(a);
                      }}
                      className="absolute top-1 h-5 w-1.5 -translate-x-1/2 cursor-pointer rounded bg-violet-600"
                      style={{ left: offToX(a) }}
                      title={`${iv.type ?? 'intervention'} ${iv.status ?? ''} @ ${fmtRel(a)}`}
                    />
                  );
                })}
                <Playhead x={offToX(ph.offsetMs)} />
              </Lane>
            </Row>

            {/* on-demand data rows */}
            {dataRows.map((row) => (
              <Row
                key={row.id}
                label={
                  <span className="flex w-full items-center gap-1">
                    <span className="truncate" title={dataRowName(row)}>
                      {dataRowName(row)}
                    </span>
                    <button
                      onClick={() => removeDataRow(row.id)}
                      className="ml-auto text-slate-300 hover:text-rose-500"
                      title="remove row"
                    >
                      ✕
                    </button>
                  </span>
                }
              >
                <Lane fullW={fullW} onClickSeekPx={(x) => store.seek(xToOff(x))}>
                  <DataTrack
                    row={row}
                    streams={streams}
                    ef={sparse?.efDetections ?? []}
                    base={base}
                    offToX={offToX}
                    fullW={fullW}
                  />
                  <Playhead x={offToX(ph.offsetMs)} />
                </Lane>
              </Row>
            ))}

            {/* add row */}
            <div className="flex items-center gap-2 px-2 py-2" style={{ paddingLeft: LABEL_W }}>
              <AddRowMenu
                streams={streams}
                hasEf={(sparse?.efDetections ?? []).length > 0}
                onAdd={addDataRow}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── timeline primitives ────────────────────────────────────────────────── */

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-stretch border-b border-slate-100" style={{ minHeight: ROW_H }}>
      <div
        className="flex shrink-0 items-center border-r border-slate-100 px-2 text-xs font-medium text-slate-600"
        style={{ width: LABEL_W }}
      >
        {label}
      </div>
      <div className="relative flex-1">{children}</div>
    </div>
  );
}

function Lane({
  fullW,
  children,
  onMouseDownLane,
  onClickSeekPx,
}: {
  fullW: number;
  children?: React.ReactNode;
  onMouseDownLane?: (e: React.MouseEvent) => void;
  onClickSeekPx?: (xContentPx: number) => void;
}) {
  return (
    <div
      className="relative h-full cursor-crosshair select-none"
      style={{ width: fullW || '100%', minHeight: ROW_H }}
      onMouseDown={onMouseDownLane}
      onClick={
        onClickSeekPx
          ? (e) => onClickSeekPx(e.clientX - e.currentTarget.getBoundingClientRect().left)
          : undefined
      }
    >
      {children}
    </div>
  );
}

function Playhead({ x }: { x: number }) {
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-slate-900"
      style={{ left: x }}
    />
  );
}

function Ruler({
  durationMs,
  offToX,
  fullW,
}: {
  durationMs: number;
  offToX: (o: number) => number;
  fullW: number;
}) {
  const pxPerSec = (fullW || 1) / (durationMs / 1000 || 1);
  const stepSec = niceStep(80 / (pxPerSec || 1));
  const ticks: number[] = [];
  for (let s = 0; s * 1000 <= durationMs; s += stepSec) ticks.push(s);
  return (
    <div className="relative h-5" style={{ width: fullW || '100%' }}>
      {ticks.map((s) => (
        <div
          key={s}
          className="absolute top-0 h-full border-l border-slate-200 pl-0.5 text-[9px] text-slate-400"
          style={{ left: offToX(s * 1000) }}
        >
          {fmtRel(s * 1000)}
        </div>
      ))}
    </div>
  );
}

function DataTrack({
  row,
  streams,
  ef,
  base,
  offToX,
  fullW,
}: {
  row: DataRow;
  streams: Streams | null;
  ef: any[];
  base: number;
  offToX: (o: number) => number;
  fullW: number;
}) {
  if (row.kind === 'ef') {
    const inj = ef as { wallMs: number; construct: string; label: string; severity?: string }[];
    return (
      <>
        {inj.map((d, i) => (
          <div
            key={i}
            className="absolute top-2 h-3 w-2 -translate-x-1/2 rounded-sm"
            style={{ left: offToX(d.wallMs - base), background: sevColor(d.severity) }}
            title={`${d.construct} — ${d.label}${d.severity ? ` (${d.severity})` : ''}`}
          />
        ))}
      </>
    );
  }
  const series =
    row.kind === 'pupil'
      ? (streams?.pupil ?? [])
      : ((row.kind === 'au' ? streams?.aus[row.key] : streams?.emotions[row.key]) ?? []);
  if (!series.length)
    return <span className="absolute left-1 top-1.5 text-[10px] text-slate-300">no data</span>;
  const h = ROW_H - 4;
  let ymin = row.domain ? row.domain[0] : Infinity;
  let ymax = row.domain ? row.domain[1] : -Infinity;
  if (!row.domain)
    for (const p of series) {
      if (p.v < ymin) ymin = p.v;
      if (p.v > ymax) ymax = p.v;
    }
  const ny = (v: number) => (ymax > ymin ? h - ((v - ymin) / (ymax - ymin)) * h : h / 2) + 2;
  const d = series
    .map((p, i) => `${i ? 'L' : 'M'}${offToX(p.t).toFixed(1)},${ny(p.v).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="absolute inset-0" width={fullW || '100%'} height={ROW_H}>
      <path d={d} fill="none" stroke={row.color} strokeWidth={1} />
    </svg>
  );
}

function AddRowMenu({
  streams,
  hasEf,
  onAdd,
}: {
  streams: Streams | null;
  hasEf: boolean;
  onAdd: (r: DataRow) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!streams) return null;
  const auKeys = Object.keys(streams.aus)
    .filter((k) => streams.aus[k]?.length)
    .sort();
  const emoKeys = Object.keys(streams.emotions)
    .filter((k) => streams.emotions[k]?.length)
    .sort();
  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded border border-slate-300 px-2 py-1 text-xs"
      >
        + Add data row
      </button>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-slate-400">add:</span>
      {streams.pupil.length > 0 && (
        <button
          onClick={() => {
            onAdd({ id: newRowId(), kind: 'pupil', key: 'pupil', color: '#0891b2' });
            setOpen(false);
          }}
          className="rounded bg-cyan-100 px-1.5 py-0.5 text-cyan-700"
        >
          pupil
        </button>
      )}
      {hasEf && (
        <button
          onClick={() => {
            onAdd({ id: newRowId(), kind: 'ef', key: 'ef', color: '#6366f1' });
            setOpen(false);
          }}
          className="rounded bg-indigo-100 px-1.5 py-0.5 text-indigo-700"
        >
          EF detections
        </button>
      )}
      <Picker
        label="AU"
        keys={auKeys}
        onPick={(k) => {
          onAdd({ id: newRowId(), kind: 'au', key: k, color: '#7c3aed', domain: [0, 3] });
          setOpen(false);
        }}
      />
      <Picker
        label="emotion"
        keys={emoKeys}
        onPick={(k) => {
          onAdd({ id: newRowId(), kind: 'emotion', key: k, color: '#e11d48', domain: [0, 1] });
          setOpen(false);
        }}
      />
      <button onClick={() => setOpen(false)} className="text-slate-400">
        cancel
      </button>
    </div>
  );
}

function Picker({
  label,
  keys,
  onPick,
}: {
  label: string;
  keys: string[];
  onPick: (k: string) => void;
}) {
  if (keys.length === 0) return null;
  return (
    <select
      defaultValue=""
      onChange={(e) => e.target.value && onPick(e.target.value)}
      className="rounded border border-slate-300 px-1 py-0.5"
    >
      <option value="">{label}…</option>
      {keys.map((k) => (
        <option key={k} value={k}>
          {k}
        </option>
      ))}
    </select>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

/**
 * Derive duration-based affect detections from the emotion-probability series:
 * a detection is a contiguous run where the emotion-derived affect score stays
 * at/above its threshold for at least `minMs` (timestamps are relative ms).
 */
function computeDetections(
  emotions: Record<string, { t: number; v: number }[]>,
  thresholds: AffectThresholds,
  minMs: number,
): Record<string, { startMs: number; endMs: number }[]> {
  const keys = [
    'happiness',
    'sadness',
    'surprise',
    'fear',
    'anger',
    'disgust',
    'contempt',
    'neutral',
  ] as const;
  const len = Math.max(0, ...keys.map((k) => emotions[k]?.length ?? 0));
  const affects = ['engagement', 'boredom', 'confusion', 'frustration'] as const;
  const out: Record<string, { startMs: number; endMs: number }[]> = {
    engagement: [],
    boredom: [],
    confusion: [],
    frustration: [],
  };
  if (len === 0) return out;
  const runStart: Record<string, number | null> = {
    engagement: null,
    boredom: null,
    confusion: null,
    frustration: null,
  };
  const lastAbove: Record<string, number> = {
    engagement: 0,
    boredom: 0,
    confusion: 0,
    frustration: 0,
  };
  let lastT = 0;
  const close = (aff: string) => {
    if (runStart[aff] != null && lastAbove[aff] - (runStart[aff] as number) >= minMs) {
      out[aff].push({ startMs: runStart[aff] as number, endMs: lastAbove[aff] });
    }
    runStart[aff] = null;
  };
  for (let i = 0; i < len; i++) {
    const probs: EmotionProbs = {};
    let t = lastT;
    for (const k of keys) {
      const pt = emotions[k]?.[i];
      if (pt) {
        (probs as Record<string, number>)[k] = pt.v;
        t = pt.t;
      }
    }
    lastT = t;
    const scores = affectScores(probs);
    for (const aff of affects) {
      if (scores[aff] >= thresholds[aff]) {
        if (runStart[aff] == null) runStart[aff] = t;
        lastAbove[aff] = t;
      } else if (runStart[aff] != null && t - lastAbove[aff] > DETECT_GAP_MS) {
        close(aff); // sustained dip — end the episode at its last above-threshold frame
      }
    }
  }
  for (const aff of affects) close(aff);
  return out;
}

function colorFor(code: string): string {
  return AFFECT_TRACKS.find((t) => t.code === code)?.color ?? '#475569';
}
function labelFor(code: string): string {
  return AFFECT_TRACKS.find((t) => t.code === code)?.label ?? code;
}
function dataRowName(row: DataRow): string {
  if (row.kind === 'pupil') return 'pupil size';
  if (row.kind === 'ef') return 'EF detections';
  return `${row.kind === 'au' ? 'AU' : 'emotion'}: ${row.key}`;
}
function sevColor(sev?: string): string {
  return sev === 'high'
    ? '#dc2626'
    : sev === 'medium'
      ? '#f59e0b'
      : sev === 'low'
        ? '#10b981'
        : '#6366f1';
}
function niceStep(targetSec: number): number {
  const steps = [5, 10, 15, 30, 60, 120, 300, 600, 1200];
  for (const s of steps) if (s >= targetSec) return s;
  return 1800;
}
function nearestGaze(
  arr: { wallMs: number; x: number; y: number }[],
  absMs: number,
): { x: number; y: number } | null {
  if (!arr.length) return null;
  let lo = 0,
    hi = arr.length - 1,
    ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].wallMs <= absMs) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const a = arr[ans],
    b = arr[Math.min(ans + 1, arr.length - 1)];
  const p = Math.abs(a.wallMs - absMs) <= Math.abs(b.wallMs - absMs) ? a : b;
  return { x: p.x, y: p.y };
}
