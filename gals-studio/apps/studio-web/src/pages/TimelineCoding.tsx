import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  { code: 'delight', label: 'Delight', color: '#0ea5e9' },
] as const;

/** Coder-drawn activity tiers (Part B) — confirm/override the model guess. Must
 * cover every activity label the /guesses endpoint can surface (it only drops
 * idle + gaze_unknown), else an accepted guess would render in no lane. */
const ACTIVITY_TRACKS = [
  { code: 'reading_lesson', label: 'Reading lesson', color: '#2563eb' },
  { code: 'chatbot', label: 'Chatbot', color: '#0d9488' },
  { code: 'intervention', label: 'Intervention', color: '#7c3aed' },
  { code: 'navigating', label: 'Navigating', color: '#94a3b8' },
  { code: 'divided_attention', label: 'Divided attention', color: '#f43f5e' },
  { code: 'off_task_tab_switch', label: 'Off-task (tab)', color: '#a8a29e' },
] as const;

// Full code→color/label lookup across affect + activity vocabularies (the model
// affect lane can also surface 'neutral' for completeness).
const CODE_META: Record<string, { label: string; color: string }> = {
  ...Object.fromEntries(AFFECT_TRACKS.map((t) => [t.code, { label: t.label, color: t.color }])),
  ...Object.fromEntries(ACTIVITY_TRACKS.map((t) => [t.code, { label: t.label, color: t.color }])),
  neutral: { label: 'Neutral', color: '#cbd5e1' },
};

const LABEL_W = 150;
const ROW_H = 30;
const MIN_INTERVAL_MS = 500;
const MIN_ZOOM = 1; // 1× = whole session fits the viewport
const MAX_ZOOM = 512;

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

// Default FACS-informed AU sets per affect (researcher-editable in AU mode).
type AuMap = {
  engagement: string[];
  boredom: string[];
  confusion: string[];
  frustration: string[];
};
const AU_DEFAULTS: AuMap = {
  engagement: ['au06', 'au12', 'au01', 'au02'], // cheek raise + smile + brow raise
  boredom: [], // AU-based boredom needs eye/blink AUs not captured — researcher picks
  confusion: ['au04', 'au07'], // brow lowerer + lid tightener
  frustration: ['au04', 'au07', 'au23', 'au24'], // + lip tightener/pressor
};

interface Interval {
  id: string;
  code: string;
  dimension?: string;
  startWallMs: number;
  endWallMs: number;
  notes?: string | null;
  intensity?: number | null;
  confidence?: string | null;
  machineGuess?: string | null;
}
type GuessSeg = { code: string; startMs: number; endMs: number };
interface Aoi {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string | null;
}
type Streams = {
  aus: Record<string, { t: number; v: number }[]>;
  emotions: Record<string, { t: number; v: number }[]>;
  pupil: { t: number; v: number }[];
};
type DataRow =
  | { id: string; kind: 'au' | 'emotion'; key: string; color: string; domain: [number, number] }
  | { id: string; kind: 'pupil'; key: 'pupil'; color: string; domain?: undefined }
  | { id: string; kind: 'ef'; key: 'ef'; color: string; domain?: undefined }
  | {
      id: string;
      kind: 'chat' | 'dialogue';
      key: 'chat' | 'dialogue';
      color: string;
      domain?: undefined;
    };

// Coding vocabularies for per-utterance coding.
const EF_CONSTRUCTS = [
  'working_memory',
  'cognitive_flexibility',
  'metacognitive_monitoring',
  'attention_regulation',
  'metacognition_general',
];
const AFFECT_CODES = ['boredom', 'engagement', 'confusion', 'frustration'];
const STRATEGY_CODES = [
  'PRACTICE_TESTING',
  'STEPWISE_LEARNING',
  'INTERROGATIVE_ELABORATION',
  'DISTRIBUTED_PRACTICE',
];
type UtterRef = {
  source: string;
  refWallMs: number;
  role?: string | null;
  preview?: string | null;
};

export function TimelineCoding() {
  const { sessionId = '' } = useParams();
  const [meta, setMeta] = useState<any>(null);
  const [snaps, setSnaps] = useState<SnapshotLite[]>([]);
  const [sparse, setSparse] = useState<any>(null);
  const [streams, setStreams] = useState<Streams | null>(null);
  const [coders, setCoders] = useState<any[]>([]);
  const [coderId, setCoderId] = useState(() => localStorage.getItem('gals.coderId') ?? '');
  const [intervals, setIntervals] = useState<Interval[]>([]);
  const [guesses, setGuesses] = useState<{
    activitySegments: GuessSeg[];
    affectSegments: GuessSeg[];
  } | null>(null);
  const [review, setReview] = useState<{
    code: string;
    dimension: string;
    startMs: number;
    endMs: number;
    savedId: string | null;
    machineGuess?: string | null;
  } | null>(null);
  const [looping, setLooping] = useState(true);
  const [showScreenshot, setShowScreenshot] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [dataRows, setDataRows] = useState<DataRow[]>([]);
  const [draft, setDraft] = useState<{
    code: string;
    dimension: string;
    aMs: number;
    bMs: number;
  } | null>(null);
  const [thresholds, setThresholds] = useState<AffectThresholds>(DETECT_DEFAULTS);
  const [detectMinSec, setDetectMinSec] = useState(30);
  const [showDetections, setShowDetections] = useState(true);
  const [method, setMethod] = useState<'emotion' | 'au'>('emotion');
  const [auMap, setAuMap] = useState<AuMap>(() => {
    try {
      const s = localStorage.getItem('gals.auMap');
      if (s) return { ...AU_DEFAULTS, ...JSON.parse(s) };
    } catch {
      /* fall through */
    }
    return AU_DEFAULTS;
  });
  const [auPanelOpen, setAuPanelOpen] = useState(true);
  const [rowHidden, setRowHidden] = useState<Record<string, boolean>>({});
  const [rowMenuOpen, setRowMenuOpen] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [aois, setAois] = useState<Aoi[]>([]);
  const [aoiDraw, setAoiDraw] = useState(false);
  const [utterCodings, setUtterCodings] = useState<Record<string, any>>({});
  const [codingUtter, setCodingUtter] = useState<UtterRef | null>(null);

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
    // model guesses (Part B activity + Part C affect) — best-effort, non-blocking
    api
      .analysisGuesses(sessionId)
      .then((g) =>
        setGuesses({
          activitySegments: g.activitySegments ?? [],
          affectSegments: g.affectSegments ?? [],
        }),
      )
      .catch(() => setGuesses(null));
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
  useEffect(() => {
    localStorage.setItem('gals.auMap', JSON.stringify(auMap));
  }, [auMap]);

  const refreshAois = useCallback(async () => {
    const r = await api.aois(sessionId);
    setAois(r.aois ?? []);
  }, [sessionId]);
  useEffect(() => {
    void refreshAois();
  }, [refreshAois]);

  const createAoi = useCallback(
    async (rect: { x: number; y: number; width: number; height: number }) => {
      const name = window.prompt('Name this AOI', `AOI ${aois.length + 1}`);
      if (name == null) return;
      await api.createAoi(sessionId, { ...rect, name: name.trim() || 'AOI', color: '#e11d48' });
      setAoiDraw(false);
      await refreshAois();
    },
    [sessionId, aois.length, refreshAois],
  );
  const delAoi = useCallback(
    async (id: string) => {
      await api.deleteAoi(id);
      await refreshAois();
    },
    [refreshAois],
  );

  // ── per-utterance coding (chat / dialogue / intervention) ─────────────────
  const refreshUtterCodings = useCallback(async () => {
    if (!coderId) {
      setUtterCodings({});
      return;
    }
    const r = await api.utteranceCodings(sessionId, coderId);
    const map: Record<string, any> = {};
    for (const c of r.codings) map[`${c.source}:${c.refWallMs}`] = c;
    setUtterCodings(map);
  }, [sessionId, coderId]);
  useEffect(() => {
    void refreshUtterCodings();
  }, [refreshUtterCodings]);

  const saveUtterCoding = useCallback(
    async (patch: {
      efConstruct?: string | null;
      affect?: string | null;
      strategy?: string | null;
      notes?: string | null;
    }) => {
      if (!codingUtter || !coderId) return;
      await api.upsertUtteranceCoding(sessionId, {
        coderId,
        source: codingUtter.source,
        refWallMs: codingUtter.refWallMs,
        role: codingUtter.role ?? null,
        preview: codingUtter.preview ?? null,
        ...patch,
      });
      await refreshUtterCodings();
    },
    [codingUtter, coderId, sessionId, refreshUtterCodings],
  );
  const clearUtterCoding = useCallback(async () => {
    if (!codingUtter) return;
    const c = utterCodings[`${codingUtter.source}:${codingUtter.refWallMs}`];
    if (c?.id) await api.deleteUtteranceCoding(c.id);
    setCodingUtter(null);
    await refreshUtterCodings();
  }, [codingUtter, utterCodings, refreshUtterCodings]);

  const openUtter = useCallback(
    (
      source: string,
      u: {
        wallMs: number;
        role?: string | null;
        content?: string;
        type?: string | null;
        status?: string | null;
      },
    ) => {
      const preview =
        source === 'intervention'
          ? `${u.type ?? 'intervention'} ${u.status ?? ''}`.trim()
          : (u.content ?? '').slice(0, 200);
      setCodingUtter({ source, refWallMs: u.wallMs, role: u.role ?? null, preview });
      store.seek(u.wallMs - (meta?.baseWallClockMs ?? 0));
    },
    [store, meta],
  );

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

  // ── video-editor zoom: scale the time axis while keeping the time point under
  // the cursor anchored in place (so zooming doesn't lose your spot). ─────────
  const pendingAnchorRef = useRef<{ offMs: number; clientX: number } | null>(null);
  const zoomAround = useCallback(
    (factor: number, clientX: number) => {
      const el = scrollRef.current;
      if (!el || pxPerMs <= 0) return;
      const rect = el.getBoundingClientRect();
      const xInLane = clientX - rect.left + el.scrollLeft - LABEL_W;
      pendingAnchorRef.current = { offMs: xInLane / pxPerMs, clientX };
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor)));
    },
    [pxPerMs],
  );
  // re-anchor the horizontal scroll after the new zoom has laid out
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = pendingAnchorRef.current;
    if (!el || !a || pxPerMs <= 0) return;
    pendingAnchorRef.current = null;
    const rect = el.getBoundingClientRect();
    el.scrollLeft = a.offMs * pxPerMs + LABEL_W - (a.clientX - rect.left);
  }, [zoom, pxPerMs]);
  // Ctrl/⌘ + wheel zooms anchored at the pointer; plain/shift wheel scrolls
  // (native). Attached non-passively so we can preventDefault the page zoom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomAround(Math.pow(1.0018, -e.deltaY), e.clientX);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAround]);
  // buttons zoom around the centre of the visible track area
  const zoomButton = (factor: number) => {
    const el = scrollRef.current;
    if (!el) return;
    zoomAround(factor, el.getBoundingClientRect().left + LABEL_W + areaW / 2);
  };

  const absoluteMs = base + ph.offsetMs;
  const currentSnapshot = useMemo(() => snapshotAt(snaps, absoluteMs), [snaps, absoluteMs]);
  const currentGaze = useMemo(
    () => (sparse?.gaze ? nearestGaze(sparse.gaze, absoluteMs) : null),
    [sparse, absoluteMs],
  );

  // model affective detections: contiguous runs where the affect score (from the
  // selected method) stays at/above threshold for >= the min duration (relative ms).
  const detections = useMemo(
    () =>
      streams
        ? computeDetections(method, streams, thresholds, detectMinSec * 1000, auMap)
        : ({} as Record<string, { startMs: number; endMs: number }[]>),
    [streams, method, thresholds, detectMinSec, auMap],
  );

  // researcher-AOI gaze dwell over the review segment (or whole session).
  const aoiDwell = useMemo(() => {
    const g: { wallMs: number; x: number; y: number }[] = sparse?.gaze ?? [];
    if (!aois.length || !g.length) return [];
    const lo = review ? base + review.startMs : -Infinity;
    const hi = review ? base + review.endMs : Infinity;
    const counts = aois.map((a) => ({ a, n: 0 }));
    let total = 0;
    for (const p of g) {
      if (p.wallMs < lo || p.wallMs > hi) continue;
      total += 1;
      for (const c of counts) {
        if (p.x >= c.a.x && p.x <= c.a.x + c.a.width && p.y >= c.a.y && p.y <= c.a.y + c.a.height)
          c.n += 1;
      }
    }
    return counts.map((c) => ({
      id: c.a.id,
      name: c.a.name,
      color: c.a.color ?? '#e11d48',
      pct: total ? c.n / total : 0,
    }));
  }, [aois, sparse, review, base]);

  const aoiOverlay = currentSnapshot ? (
    <AoiLayer
      width={currentSnapshot.width}
      height={currentSnapshot.height}
      aois={aois}
      drawing={aoiDraw}
      onCreate={createAoi}
      onDelete={delAoi}
    />
  ) : null;

  const rowConfig = useMemo(
    () => [
      { key: 'webcam', label: '📹 webcam', color: '#334155' },
      { key: 'model_activity', label: '🤖 activity (model)', color: '#2563eb' },
      { key: 'model_affect', label: '🤖 affect (model)', color: '#8b5cf6' },
      ...ACTIVITY_TRACKS.map((t) => ({ key: `act:${t.code}`, label: t.label, color: t.color })),
      ...AFFECT_TRACKS.map((t) => ({ key: t.code, label: t.label, color: t.color })),
      { key: 'interventions', label: '⚡ interventions', color: '#7c3aed' },
      ...dataRows.map((r) => ({ key: r.id, label: dataRowName(r), color: r.color })),
    ],
    [dataRows],
  );

  // loop the segment under review
  useEffect(() => {
    if (!looping || !review || !ph.playing) return;
    if (ph.offsetMs >= review.endMs || ph.offsetMs < review.startMs - 200)
      store.seek(review.startMs);
  }, [ph.offsetMs, ph.playing, looping, review, store]);

  const createInterval = useCallback(
    async (
      code: string,
      startOff: number,
      endOff: number,
      dimension = 'affect',
      machineGuess: string | null = null,
    ) => {
      if (!coderId) return;
      await api.upsertAnnotation({
        sessionId,
        coderId,
        codingPass: 'timeline',
        dimension,
        code,
        startWallMs: Math.round(base + Math.min(startOff, endOff)),
        endWallMs: Math.round(base + Math.max(startOff, endOff)),
        machineGuess,
      });
      await refreshIntervals();
    },
    [coderId, sessionId, base, refreshIntervals],
  );

  // drag-to-create on an affect/activity lane
  const beginDraft =
    (code: string, dimension = 'affect') =>
    (e: React.MouseEvent) => {
      if (!coderId || e.button !== 0) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const startMs = xToOff(e.clientX - rect.left);
      setDraft({ code, dimension, aMs: startMs, bMs: startMs });
      const move = (ev: MouseEvent) =>
        setDraft((d) => (d ? { ...d, bMs: xToOff(ev.clientX - rect.left) } : d));
      const up = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        const endMs = xToOff(ev.clientX - rect.left);
        setDraft(null);
        if (Math.abs(endMs - startMs) >= MIN_INTERVAL_MS)
          void createInterval(code, startMs, endMs, dimension);
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
      dimension: iv.dimension ?? 'affect',
      startMs: iv.startWallMs - base,
      endMs: iv.endWallMs - base,
      savedId: iv.id,
      machineGuess: iv.machineGuess ?? null,
    });
    store.seek(iv.startWallMs - base);
    if (looping) store.play();
  };

  const reviewDetection = (
    code: string,
    startMs: number,
    endMs: number,
    dimension = 'affect',
    machineGuess: string | null = null,
  ) => {
    setReview({ code, dimension, startMs, endMs, savedId: null, machineGuess });
    store.seek(startMs);
    if (looping) store.play();
  };

  const acceptReview = useCallback(async () => {
    if (!review || !coderId) return;
    await createInterval(
      review.code,
      review.startMs,
      review.endMs,
      review.dimension,
      review.machineGuess ?? null,
    );
    setReview(null);
  }, [review, coderId, createInterval]);

  const addDataRow = (row: DataRow) => setDataRows((rows) => [...rows, row]);
  const removeDataRow = (id: string) => setDataRows((rows) => rows.filter((r) => r.id !== id));

  if (!meta) return <div className="p-8 text-center text-slate-400">Loading timeline studio…</div>;

  const interventions: { wallMs: number; type?: string; status?: string }[] =
    sparse?.interventions ?? [];
  const chatMsgs: { wallMs: number; role?: string; content?: string }[] = sparse?.chatbot ?? [];
  const dialogueMsgs: { wallMs: number; role?: string; content?: string }[] =
    sparse?.dialogue ?? [];
  const utterItems = (kind: 'chat' | 'dialogue') => (kind === 'chat' ? chatMsgs : dialogueMsgs);
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
        <button
          onClick={async () => {
            setShowSummary(true);
            try {
              setSummary(await api.sessionSummary(sessionId, coderId || 'none'));
            } catch {
              setSummary(null);
            }
          }}
          className="rounded bg-slate-900 px-2 py-1 text-xs text-white"
        >
          📋 Summary
        </button>
        <a
          href={coderId ? api.utteranceExportUrl(sessionId, coderId) : undefined}
          className={`rounded border border-slate-300 px-2 py-1 text-xs ${coderId ? '' : 'pointer-events-none opacity-50'}`}
          title="Export utterance coding (EF / affect / strategy) as CSV"
        >
          ⬇ Export coding
        </a>
        <div className="relative">
          <button
            onClick={() => setRowMenuOpen((v) => !v)}
            className="rounded border border-slate-300 px-2 py-1 text-xs"
          >
            Rows ▾
          </button>
          {rowMenuOpen && (
            <div className="absolute z-30 mt-1 w-44 rounded border border-slate-200 bg-white p-1 shadow-lg">
              {rowConfig.map((r) => (
                <label
                  key={r.key}
                  className="flex items-center gap-2 px-1 py-0.5 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={!rowHidden[r.key]}
                    onChange={(e) => setRowHidden((h) => ({ ...h, [r.key]: !e.target.checked }))}
                  />
                  <span style={{ color: r.color }}>{r.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <span className="ml-auto flex items-center gap-1 text-xs">
          <span
            className="text-slate-400"
            title="Ctrl/⌘ + scroll over the timeline to zoom at the cursor · Shift + scroll to pan"
          >
            zoom
          </span>
          <button
            onClick={() => zoomButton(0.5)}
            disabled={zoom <= MIN_ZOOM}
            className="rounded border border-slate-300 px-1.5 disabled:opacity-40"
          >
            −
          </button>
          <span className="w-10 text-center tabular-nums">
            {zoom >= 10 ? Math.round(zoom) : zoom.toFixed(1)}×
          </span>
          <button
            onClick={() => zoomButton(2)}
            disabled={zoom >= MAX_ZOOM}
            className="rounded border border-slate-300 px-1.5 disabled:opacity-40"
          >
            +
          </button>
          {zoom > MIN_ZOOM && (
            <button
              onClick={() => zoomButton(MIN_ZOOM / zoom)}
              className="rounded border border-slate-300 px-1.5 text-slate-500"
              title="reset zoom to fit"
            >
              fit
            </button>
          )}
        </span>
      </div>

      {/* player */}
      <div className="grid grid-cols-[1fr_300px] gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              onClick={() => setShowScreenshot((v) => !v)}
              className="rounded border border-slate-300 px-2 py-0.5"
            >
              {showScreenshot ? '🖼 Pixels (as seen)' : '⟨⟩ DOM'}
            </button>
            {currentSnapshot?.pdfTotalPages ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">
                PDF p.{currentSnapshot.pdfCurrentPage ?? '?'}/{currentSnapshot.pdfTotalPages}
              </span>
            ) : null}
            {!showScreenshot && currentSnapshot?.pdfTotalPages ? (
              <span className="text-slate-400">— PDF page only renders in Pixels view</span>
            ) : null}
            <button
              onClick={() => setAoiDraw((v) => !v)}
              className={`rounded border px-2 py-0.5 ${aoiDraw ? 'border-rose-400 bg-rose-50 text-rose-600' : 'border-slate-300'}`}
            >
              {aoiDraw ? '✏ drawing AOI… (drag on view)' : '＋ AOI'}
            </button>
            <span className="ml-auto text-slate-400">🔒 locked to student view</span>
          </div>
          <DomStage
            sessionId={sessionId}
            snapshot={currentSnapshot}
            gaze={currentGaze}
            lastClick={null}
            aoiVisible={{}}
            showScreenshot={showScreenshot}
            locked
            overlay={aoiOverlay}
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
          {codingUtter && (
            <UtteranceCodingPanel
              utter={codingUtter}
              base={base}
              existing={utterCodings[`${codingUtter.source}:${codingUtter.refWallMs}`]}
              onSave={saveUtterCoding}
              onClear={clearUtterCoding}
              onClose={() => setCodingUtter(null)}
            />
          )}
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
              {review.machineGuess != null && (
                <div className="mt-0.5 text-[11px] text-slate-500">
                  model guess:{' '}
                  <span style={{ color: colorFor(review.machineGuess) }}>
                    {labelFor(review.machineGuess)}
                  </span>
                  {review.savedId != null &&
                    (review.machineGuess === review.code ? (
                      <span className="ml-1 text-emerald-600">✓ confirmed</span>
                    ) : (
                      <span className="ml-1 text-amber-600">✎ overridden</span>
                    ))}
                </div>
              )}
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
              {review.savedId && (
                <RegionCoding
                  interval={intervals.find((i) => i.id === review.savedId)}
                  onSave={async (patch) => {
                    await api.updateAnnotation(review.savedId!, patch);
                    await refreshIntervals();
                  }}
                />
              )}
            </div>
          ) : (
            <div className="rounded border border-dashed border-slate-300 p-2 text-xs text-slate-400">
              Detected affect segments (≥{detectMinSec}s over threshold) are shaded on each lane —
              click one to review, then ✓ accept. Or drag a lane to mark your own.
            </div>
          )}

          {aois.length > 0 && (
            <div className="rounded border border-slate-200 bg-white p-2 text-xs">
              <div className="mb-1 font-semibold text-slate-500">
                AOI gaze dwell {review ? '(this segment)' : '(whole session)'}
              </div>
              {aoiDwell.map((d) => (
                <div key={d.id} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 truncate" style={{ color: d.color }}>
                    {d.name}
                  </span>
                  <div className="h-2 flex-1 rounded bg-slate-100">
                    <div
                      className="h-2 rounded"
                      style={{ width: `${Math.round(d.pct * 100)}%`, backgroundColor: d.color }}
                    />
                  </div>
                  <span className="w-8 shrink-0 tabular-nums text-slate-400">
                    {Math.round(d.pct * 100)}%
                  </span>
                </div>
              ))}
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
          method
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as 'emotion' | 'au')}
            className="rounded border border-slate-300 px-1 py-0.5"
          >
            <option value="emotion">rule-based (emotion)</option>
            <option value="au">AU-based</option>
          </select>
        </label>
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

      {/* AU → affect mapping (AU-based method only) */}
      {method === 'au' && streams && (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
          <button
            onClick={() => setAuPanelOpen((v) => !v)}
            className="mb-1 flex w-full items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
          >
            <span>{auPanelOpen ? '▾' : '▸'}</span>
            AU → affect mapping{' '}
            {auPanelOpen ? '— click action units to include in each affect' : '(click to edit)'}
          </button>
          <div className={`space-y-1 ${auPanelOpen ? '' : 'hidden'}`}>
            {(['engagement', 'boredom', 'confusion', 'frustration'] as const).map((aff) => {
              const auKeys = Object.keys(streams.aus)
                .filter((k) => streams.aus[k]?.length)
                .sort();
              return (
                <div key={aff} className="flex flex-wrap items-center gap-1">
                  <span className="w-20 shrink-0 font-medium" style={{ color: colorFor(aff) }}>
                    {labelFor(aff)}
                  </span>
                  {auKeys.length === 0 && <span className="text-slate-400">no AU data</span>}
                  {auKeys.map((au) => {
                    const on = auMap[aff].includes(au);
                    return (
                      <button
                        key={au}
                        onClick={() =>
                          setAuMap((m) => ({
                            ...m,
                            [aff]: on ? m[aff].filter((x) => x !== au) : [...m[aff], au],
                          }))
                        }
                        className="rounded px-1 py-0.5 font-mono text-[10px]"
                        style={{
                          background: on ? colorFor(aff) + '33' : '#f1f5f9',
                          color: on ? colorFor(aff) : '#94a3b8',
                          outline: on ? `1px solid ${colorFor(aff)}` : 'none',
                        }}
                      >
                        {au}
                      </button>
                    );
                  })}
                  {auMap[aff].length === 0 && (
                    <span className="text-slate-300">(none → no detection)</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* timeline */}
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto" ref={scrollRef}>
          <div style={{ minWidth: LABEL_W + areaW }}>
            {/* ruler */}
            <Row label={<span className="text-[10px] text-slate-400">time</span>}>
              <Ruler durationMs={durationMs} offToX={offToX} fullW={fullW} />
            </Row>

            {/* webcam coverage */}
            {!rowHidden['webcam'] && (
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
            )}

            {/* model guess lanes (read-only) — click a segment to review & accept/override */}
            {guesses && !rowHidden['model_activity'] && (
              <Row label="🤖 activity (model)">
                <Lane fullW={fullW} onClickSeekPx={(x) => store.seek(xToOff(x))}>
                  {guesses.activitySegments.map((s, i) => (
                    <GuessSegment
                      key={`ga${i}`}
                      seg={s}
                      offToX={offToX}
                      onPick={() => reviewDetection(s.code, s.startMs, s.endMs, 'activity', s.code)}
                    />
                  ))}
                  <Playhead x={offToX(ph.offsetMs)} />
                </Lane>
              </Row>
            )}
            {guesses && !rowHidden['model_affect'] && (
              <Row label="🤖 affect (model)">
                <Lane fullW={fullW} onClickSeekPx={(x) => store.seek(xToOff(x))}>
                  {guesses.affectSegments.map((s, i) => (
                    <GuessSegment
                      key={`gf${i}`}
                      seg={s}
                      offToX={offToX}
                      onPick={() => reviewDetection(s.code, s.startMs, s.endMs, 'affect', s.code)}
                    />
                  ))}
                  <Playhead x={offToX(ph.offsetMs)} />
                </Lane>
              </Row>
            )}

            {/* activity coder tiers (Part B) — drag to mark; accept a model guess to pre-fill */}
            {ACTIVITY_TRACKS.filter((tr) => !rowHidden[`act:${tr.code}`]).map((tr) => (
              <Row
                key={`act-${tr.code}`}
                label={
                  <span className="flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded" style={{ background: tr.color }} />
                    {tr.label}
                  </span>
                }
              >
                <Lane fullW={fullW} onMouseDownLane={beginDraft(tr.code, 'activity')}>
                  {intervals
                    .filter((iv) => iv.dimension === 'activity' && iv.code === tr.code)
                    .map((iv) => {
                      const a = iv.startWallMs - base;
                      const w = Math.max(3, offToX(iv.endWallMs - iv.startWallMs));
                      const overridden = iv.machineGuess != null && iv.machineGuess !== iv.code;
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
                          title={`${tr.label} ${fmtRel(a)}–${fmtRel(iv.endWallMs - base)}${iv.machineGuess ? ` · model said ${labelFor(iv.machineGuess)}${overridden ? ' (overridden)' : ' (confirmed)'}` : ''}`}
                        >
                          {overridden ? '✎' : w > 28 ? fmtRel(iv.endWallMs - iv.startWallMs) : ''}
                        </div>
                      );
                    })}
                  {draft && draft.dimension === 'activity' && draft.code === tr.code && (
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

            {/* affect coder tiers */}
            {AFFECT_TRACKS.filter((tr) => !rowHidden[tr.code]).map((tr) => (
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
                    .filter((iv) => iv.dimension !== 'activity' && iv.code === tr.code)
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
                  {draft && draft.dimension !== 'activity' && draft.code === tr.code && (
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
            {!rowHidden['interventions'] && (
              <Row label="⚡ interventions">
                <Lane fullW={fullW} onClickSeekPx={(x) => store.seek(xToOff(x))}>
                  {interventions.map((iv, i) => {
                    const a = iv.wallMs - base;
                    const c = utterCodings[`intervention:${iv.wallMs}`];
                    const coded = c && (c.efConstruct || c.affect || c.strategy);
                    const active =
                      codingUtter?.source === 'intervention' && codingUtter.refWallMs === iv.wallMs;
                    return (
                      <div
                        key={i}
                        onClick={(e) => {
                          e.stopPropagation();
                          openUtter('intervention', iv);
                        }}
                        className="absolute top-1 h-5 w-2 -translate-x-1/2 cursor-pointer rounded"
                        style={{
                          left: offToX(a),
                          background: coded
                            ? c.affect
                              ? colorFor(c.affect)
                              : '#7c3aed'
                            : '#c4b5fd',
                          outline: active
                            ? '2px solid #0f172a'
                            : coded
                              ? '1px solid white'
                              : undefined,
                        }}
                        title={`${iv.type ?? 'intervention'} ${iv.status ?? ''} @ ${fmtRel(a)} — click to code`}
                      />
                    );
                  })}
                  <Playhead x={offToX(ph.offsetMs)} />
                </Lane>
              </Row>
            )}

            {/* on-demand data rows */}
            {dataRows
              .filter((row) => !rowHidden[row.id])
              .map((row) => (
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
                    {row.kind === 'chat' || row.kind === 'dialogue' ? (
                      <UtteranceTrack
                        items={utterItems(row.kind)}
                        source={row.kind}
                        base={base}
                        offToX={offToX}
                        codings={utterCodings}
                        active={codingUtter}
                        onPick={openUtter}
                      />
                    ) : (
                      <DataTrack
                        row={row}
                        streams={streams}
                        ef={sparse?.efDetections ?? []}
                        base={base}
                        offToX={offToX}
                        fullW={fullW}
                      />
                    )}
                    <Playhead x={offToX(ph.offsetMs)} />
                  </Lane>
                </Row>
              ))}

            {/* add row */}
            <div className="flex items-center gap-2 px-2 py-2" style={{ paddingLeft: LABEL_W }}>
              <AddRowMenu
                streams={streams}
                hasEf={(sparse?.efDetections ?? []).length > 0}
                hasChat={chatMsgs.length > 0}
                hasDialogue={dialogueMsgs.length > 0}
                onAdd={addDataRow}
              />
            </div>
          </div>
        </div>
      </div>

      {showSummary && <SummaryModal summary={summary} onClose={() => setShowSummary(false)} />}
    </div>
  );
}

function SummaryModal({ summary, onClose }: { summary: any; onClose: () => void }) {
  const fmt = (ms: number) => fmtRel(ms);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-[560px] overflow-auto rounded-lg bg-white p-4 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">Session summary</h2>
          <button onClick={onClose} className="rounded border border-slate-300 px-2 py-0.5 text-xs">
            close
          </button>
        </div>
        {!summary ? (
          <div className="text-slate-400">Loading…</div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="font-semibold">{summary.session.userDisplayName ?? 'student'}</div>
              <div className="text-xs text-slate-500">
                {new Date(summary.session.startedAt).toLocaleString()} →{' '}
                {summary.session.endedAt
                  ? new Date(summary.session.endedAt).toLocaleTimeString()
                  : '— (no end)'}
              </div>
            </div>

            {summary.abandoned?.likely && (
              <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
                <span className="font-semibold">⚠ Possibly abandoned</span> —{' '}
                {summary.abandoned.signals.join('; ')}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="total time" value={fmt(summary.time.totalMs)} />
              <Stat label="active (visible)" value={fmt(summary.time.activeMs)} />
              <Stat label="hidden/away" value={fmt(summary.time.hiddenMs)} />
            </div>

            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Learning interventions — {summary.interventions.completed}/
                {summary.interventions.total} completed
                {summary.interventions.avgScore != null && (
                  <> · avg score {Math.round(summary.interventions.avgScore)}</>
                )}
              </div>
              <table className="w-full text-xs">
                <thead className="text-left text-slate-400">
                  <tr>
                    <th className="py-0.5">type</th>
                    <th>status</th>
                    <th>score</th>
                    <th>at</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.interventions.items.map((iv: any, i: number) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="py-0.5">{iv.type}</td>
                      <td
                        className={
                          (iv.status ?? '').toUpperCase() === 'COMPLETED'
                            ? 'text-emerald-600'
                            : 'text-amber-600'
                        }
                      >
                        {iv.status}
                      </td>
                      <td>{iv.score ?? '—'}</td>
                      <td className="font-mono text-slate-400">{fmt(iv.atMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Coding — {summary.coding.marks} affect mark(s)
              </div>
              {summary.coding.byAffect.length === 0 ? (
                <div className="text-xs text-slate-400">No affect marks coded yet</div>
              ) : (
                summary.coding.byAffect.map((c: any) => (
                  <div key={c.code} className="flex items-center gap-2 text-xs">
                    <span className="w-24" style={{ color: colorFor(c.code) }}>
                      {labelFor(c.code)}
                    </span>
                    <span>{c.count} mark(s)</span>
                    <span className="text-slate-400">· {fmt(c.totalMs)} total</span>
                    {c.avgIntensity != null && (
                      <span className="text-slate-400">
                        · avg intensity {c.avgIntensity.toFixed(1)}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="text-xs text-slate-400">
              Chatbot messages: {summary.engagement?.chatbotMessages ?? 0}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 p-2">
      <div className="font-mono text-base">{value}</div>
      <div className="text-[10px] text-slate-400">{label}</div>
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

/** A read-only model-guess segment; click to review and accept/override. */
function GuessSegment({
  seg,
  offToX,
  onPick,
}: {
  seg: GuessSeg;
  offToX: (o: number) => number;
  onPick: () => void;
}) {
  const w = Math.max(2, offToX(seg.endMs - seg.startMs));
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
      className="absolute top-1 flex h-5 cursor-pointer items-center justify-center overflow-hidden rounded text-[9px] text-white"
      style={{ left: offToX(seg.startMs), width: w, background: `${colorFor(seg.code)}cc` }}
      title={`model: ${labelFor(seg.code)} ${fmtRel(seg.startMs)}–${fmtRel(seg.endMs)} — click to review & accept/override`}
    >
      {w > 44 ? labelFor(seg.code) : ''}
    </div>
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
  hasChat,
  hasDialogue,
  onAdd,
}: {
  streams: Streams | null;
  hasEf: boolean;
  hasChat: boolean;
  hasDialogue: boolean;
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
          Text-mining (EF)
        </button>
      )}
      {hasChat && (
        <button
          onClick={() => {
            onAdd({ id: newRowId(), kind: 'chat', key: 'chat', color: '#0ea5e9' });
            setOpen(false);
          }}
          className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-700"
        >
          Chat utterances
        </button>
      )}
      {hasDialogue && (
        <button
          onClick={() => {
            onAdd({ id: newRowId(), kind: 'dialogue', key: 'dialogue', color: '#0d9488' });
            setOpen(false);
          }}
          className="rounded bg-teal-100 px-1.5 py-0.5 text-teal-700"
        >
          Dialogue (interrog. elab.)
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

type AffectScoresT = {
  engagement: number;
  boredom: number;
  confusion: number;
  frustration: number;
};

/** Researcher-configured mapping: each affect's score is the mean of the pyfeat
 * AU probabilities (already 0–1) of the AUs assigned to it. The per-affect
 * threshold slider is then the cutoff applied to this mean. */
function auAffectScores(au: Record<string, number>, auMap: AuMap): AffectScoresT {
  const n = (k: string) => Math.max(0, Math.min(1, au[k] ?? 0));
  const score = (keys: string[]) =>
    keys.length ? keys.reduce((s, k) => s + n(k), 0) / keys.length : 0;
  return {
    engagement: score(auMap.engagement),
    boredom: score(auMap.boredom),
    confusion: score(auMap.confusion),
    frustration: score(auMap.frustration),
  };
}

/** Per-frame {t, scores} from whichever stream the chosen method uses. */
function scoredFrames(
  method: 'emotion' | 'au',
  streams: Streams,
  auMap: AuMap,
): { t: number; scores: AffectScoresT }[] {
  const src = method === 'au' ? streams.aus : streams.emotions;
  const keys =
    method === 'au'
      ? Object.keys(src)
      : ['happiness', 'sadness', 'surprise', 'fear', 'anger', 'disgust', 'contempt', 'neutral'];
  const len = Math.max(0, ...keys.map((k) => src[k]?.length ?? 0));
  const frames: { t: number; scores: AffectScoresT }[] = [];
  let lastT = 0;
  for (let i = 0; i < len; i++) {
    const vals: Record<string, number> = {};
    let t = lastT;
    for (const k of keys) {
      const pt = src[k]?.[i];
      if (pt) {
        vals[k] = pt.v;
        t = pt.t;
      }
    }
    lastT = t;
    frames.push({
      t,
      scores: method === 'au' ? auAffectScores(vals, auMap) : affectScores(vals as EmotionProbs),
    });
  }
  return frames;
}

/**
 * Duration-based affect detections: a detection is a contiguous run where the
 * affect score (from the chosen method) stays at/above its threshold for at
 * least `minMs` (brief sub-threshold dips up to DETECT_GAP_MS are bridged).
 */
function computeDetections(
  method: 'emotion' | 'au',
  streams: Streams,
  thresholds: AffectThresholds,
  minMs: number,
  auMap: AuMap,
): Record<string, { startMs: number; endMs: number }[]> {
  const affects = ['engagement', 'boredom', 'confusion', 'frustration'] as const;
  const out: Record<string, { startMs: number; endMs: number }[]> = {
    engagement: [],
    boredom: [],
    confusion: [],
    frustration: [],
  };
  const frames = scoredFrames(method, streams, auMap);
  if (frames.length === 0) return out;
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
  const close = (aff: string) => {
    if (runStart[aff] != null && lastAbove[aff] - (runStart[aff] as number) >= minMs) {
      out[aff].push({ startMs: runStart[aff] as number, endMs: lastAbove[aff] });
    }
    runStart[aff] = null;
  };
  for (const f of frames) {
    for (const aff of affects) {
      if (f.scores[aff] >= thresholds[aff]) {
        if (runStart[aff] == null) runStart[aff] = f.t;
        lastAbove[aff] = f.t;
      } else if (runStart[aff] != null && f.t - lastAbove[aff] > DETECT_GAP_MS) {
        close(aff);
      }
    }
  }
  for (const aff of affects) close(aff);
  return out;
}

/** Draw/show researcher AOIs in snapshot-pixel space over the (locked) replay. */
function AoiLayer({
  width,
  height,
  aois,
  drawing,
  onCreate,
  onDelete,
}: {
  width: number;
  height: number;
  aois: Aoi[];
  drawing: boolean;
  onCreate: (rect: { x: number; y: number; width: number; height: number }) => void;
  onDelete: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );
  const toLocal = (cx: number, cy: number) => {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: ((cx - r.left) / (r.width || 1)) * width,
      y: ((cy - r.top) / (r.height || 1)) * height,
    };
  };
  const start = (e: React.MouseEvent) => {
    if (!drawing || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const p = toLocal(e.clientX, e.clientY);
    setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    const move = (ev: MouseEvent) => {
      const q = toLocal(ev.clientX, ev.clientY);
      setDraft((d) => (d ? { ...d, x1: q.x, y1: q.y } : d));
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const q = toLocal(ev.clientX, ev.clientY);
      setDraft(null);
      const x = Math.min(p.x, q.x),
        y = Math.min(p.y, q.y),
        w = Math.abs(q.x - p.x),
        h = Math.abs(q.y - p.y);
      if (w > 8 && h > 8) onCreate({ x, y, width: w, height: h });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return (
    <div
      ref={ref}
      className="absolute left-0 top-0"
      style={{
        width,
        height,
        pointerEvents: drawing ? 'auto' : 'none',
        cursor: drawing ? 'crosshair' : 'default',
      }}
      onMouseDown={start}
    >
      {aois.map((a) => (
        <div
          key={a.id}
          className="absolute"
          style={{
            left: a.x,
            top: a.y,
            width: a.width,
            height: a.height,
            border: `2px solid ${a.color ?? '#e11d48'}`,
            background: `${a.color ?? '#e11d48'}1f`,
            pointerEvents: 'auto',
          }}
        >
          <span
            className="absolute left-0 top-0 flex items-center gap-1 bg-white/85 px-1 text-[10px] font-semibold"
            style={{ color: a.color ?? '#e11d48' }}
          >
            {a.name}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(a.id);
              }}
              className="text-slate-400 hover:text-rose-600"
              title="delete AOI"
            >
              ✕
            </button>
          </span>
        </div>
      ))}
      {draft && (
        <div
          className="absolute border-2 border-dashed border-rose-500 bg-rose-500/10"
          style={{
            left: Math.min(draft.x0, draft.x1),
            top: Math.min(draft.y0, draft.y1),
            width: Math.abs(draft.x1 - draft.x0),
            height: Math.abs(draft.y1 - draft.y0),
          }}
        />
      )}
    </div>
  );
}

/** Coding form for a saved affect region: intensity, confidence, notes. */
/** Code a single utterance/intervention: EF construct, affect, learning strategy, notes. */
function UtteranceCodingPanel({
  utter,
  base,
  existing,
  onSave,
  onClear,
  onClose,
}: {
  utter: UtterRef;
  base: number;
  existing?: {
    efConstruct?: string | null;
    affect?: string | null;
    strategy?: string | null;
    notes?: string | null;
  };
  onSave: (patch: {
    efConstruct?: string | null;
    affect?: string | null;
    strategy?: string | null;
    notes?: string | null;
  }) => Promise<void>;
  onClear: () => Promise<void>;
  onClose: () => void;
}) {
  const [ef, setEf] = useState(existing?.efConstruct ?? '');
  const [aff, setAff] = useState(existing?.affect ?? '');
  const [strat, setStrat] = useState(existing?.strategy ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setEf(existing?.efConstruct ?? '');
    setAff(existing?.affect ?? '');
    setStrat(existing?.strategy ?? '');
    setNotes(existing?.notes ?? '');
    setSaved(false);
  }, [utter.source, utter.refWallMs]);
  const label =
    utter.source === 'intervention'
      ? 'Intervention'
      : utter.source === 'chat'
        ? 'Chat utterance'
        : 'Dialogue utterance';
  const sel = (val: string, set: (v: string) => void, opts: string[]) => (
    <select
      value={val}
      onChange={(e) => {
        set(e.target.value);
        setSaved(false);
      }}
      className="flex-1 rounded border border-slate-300 px-1 py-0.5"
    >
      <option value="">—</option>
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
  return (
    <div className="rounded border-2 border-sky-400 bg-white p-2 text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold text-sky-700">
          Code {label} · {fmtRel(utter.refWallMs - base)}
        </span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
          ✕
        </button>
      </div>
      <div className="mb-2 max-h-20 overflow-auto rounded bg-slate-50 p-1 text-slate-600">
        {utter.role ? <b>{utter.role}: </b> : null}
        {utter.preview || '(no text)'}
      </div>
      <label className="mb-1 flex items-center gap-2">
        <span className="w-14 text-slate-500">EF</span>
        {sel(ef, setEf, EF_CONSTRUCTS)}
      </label>
      <label className="mb-1 flex items-center gap-2">
        <span className="w-14 text-slate-500">affect</span>
        {sel(aff, setAff, AFFECT_CODES)}
      </label>
      <label className="mb-1 flex items-center gap-2">
        <span className="w-14 text-slate-500">strategy</span>
        {sel(strat, setStrat, STRATEGY_CODES)}
      </label>
      <textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        placeholder="notes…"
        rows={2}
        className="mb-1 w-full rounded border border-slate-300 p-1"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={async () => {
            await onSave({
              efConstruct: ef || null,
              affect: aff || null,
              strategy: strat || null,
              notes: notes || null,
            });
            setSaved(true);
          }}
          className="rounded bg-slate-900 px-2 py-0.5 text-white"
        >
          {saved ? 'saved ✓' : 'save'}
        </button>
        <button
          onClick={() => void onClear()}
          className="ml-auto rounded border border-rose-300 px-2 py-0.5 text-rose-600"
        >
          clear
        </button>
      </div>
    </div>
  );
}

function RegionCoding({
  interval,
  onSave,
}: {
  interval?: Interval;
  onSave: (patch: {
    intensity?: number | null;
    confidence?: string | null;
    notes?: string | null;
  }) => Promise<void>;
}) {
  const [intensity, setIntensity] = useState(interval?.intensity ?? 3);
  const [confidence, setConfidence] = useState(interval?.confidence ?? 'medium');
  const [notes, setNotes] = useState(interval?.notes ?? '');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setIntensity(interval?.intensity ?? 3);
    setConfidence(interval?.confidence ?? 'medium');
    setNotes(interval?.notes ?? '');
    setSaved(false);
  }, [interval?.id]);
  if (!interval) return null;
  return (
    <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        code this region
      </div>
      <label className="flex items-center gap-2">
        intensity
        <input
          type="range"
          min={1}
          max={5}
          value={intensity}
          onChange={(e) => {
            setIntensity(Number(e.target.value));
            setSaved(false);
          }}
          className="flex-1"
        />
        <span className="w-4 tabular-nums">{intensity}</span>
      </label>
      <label className="flex items-center gap-2">
        confidence
        <select
          value={confidence}
          onChange={(e) => {
            setConfidence(e.target.value);
            setSaved(false);
          }}
          className="rounded border border-slate-300 px-1 py-0.5"
        >
          {['low', 'medium', 'high'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        placeholder="notes…"
        rows={2}
        className="w-full rounded border border-slate-300 p-1"
      />
      <button
        onClick={async () => {
          await onSave({ intensity, confidence, notes: notes || null });
          setSaved(true);
        }}
        className="rounded bg-slate-900 px-2 py-0.5 text-white"
      >
        {saved ? 'saved ✓' : 'save coding'}
      </button>
    </div>
  );
}

function colorFor(code: string): string {
  return CODE_META[code]?.color ?? '#475569';
}
function labelFor(code: string): string {
  return CODE_META[code]?.label ?? code;
}
function dataRowName(row: DataRow): string {
  if (row.kind === 'pupil') return 'pupil size';
  if (row.kind === 'ef') return 'Text-mining (EF)';
  if (row.kind === 'chat') return '💬 Chat utterances';
  if (row.kind === 'dialogue') return '🗣 Dialogue (interrog. elab.)';
  return `${row.kind === 'au' ? 'AU' : 'emotion'}: ${row.key}`;
}

/** Markers for chat/dialogue utterances; coded ones are solid, clickable to code. */
function UtteranceTrack({
  items,
  source,
  base,
  offToX,
  codings,
  active,
  onPick,
}: {
  items: { wallMs: number; role?: string; content?: string }[];
  source: 'chat' | 'dialogue';
  base: number;
  offToX: (o: number) => number;
  codings: Record<
    string,
    { efConstruct?: string | null; affect?: string | null; strategy?: string | null }
  >;
  active: UtterRef | null;
  onPick: (source: string, u: { wallMs: number; role?: string | null; content?: string }) => void;
}) {
  return (
    <>
      {items.map((u, i) => {
        const c = codings[`${source}:${u.wallMs}`];
        const coded = !!(c && (c.efConstruct || c.affect || c.strategy));
        const isActive = active?.source === source && active.refWallMs === u.wallMs;
        const isUser = (u.role ?? '').toLowerCase() === 'user';
        return (
          <div
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              onPick(source, u);
            }}
            className="absolute w-2 -translate-x-1/2 cursor-pointer rounded"
            style={{
              left: offToX(u.wallMs - base),
              top: isUser ? 2 : 14,
              height: 12,
              background: coded
                ? c?.affect
                  ? colorFor(c.affect)
                  : '#0f172a'
                : isUser
                  ? '#0ea5e9'
                  : '#cbd5e1',
              opacity: coded ? 1 : 0.6,
              outline: isActive ? '2px solid #0f172a' : coded ? '1px solid white' : undefined,
            }}
            title={`${isUser ? 'student' : (u.role ?? 'assistant')} @ ${fmtRel(u.wallMs - base)}\n${(u.content ?? '').slice(0, 120)}${coded ? '\n[coded]' : ''} — click to code`}
          />
        );
      })}
    </>
  );
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
