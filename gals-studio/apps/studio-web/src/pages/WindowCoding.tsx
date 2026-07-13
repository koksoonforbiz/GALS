import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Code,
  Download,
  Image,
  Keyboard,
  Pause,
  Play,
  TriangleAlert,
} from 'lucide-react';
import { api } from '../lib/api';
import { PlayheadStore, usePlayhead } from '../replay/clock';
import { snapshotAt, nearestByWall, type SnapshotLite, type WebcamSeg } from '../replay/lookup';
import { DomStage } from '../replay/DomStage';
import { WebcamPanel } from '../replay/WebcamPanel';

/**
 * Per-window "perstate-binary" coding view (codebook v2.0). A human coder splits
 * the session into fixed-duration windows from 00:00:00, watches the
 * synchronized replay, and fast-codes five constructs per window with 1/0/?/NV
 * toggles + optional justifications. `neutral` is derived live from the four
 * affect constructs. Codes auto-save to the durable WindowCoding store and
 * export to a CSV trimmed to the first→last coded window.
 */

const CODEBOOK_VERSION = 'v2.0-perstate-binary';
const VALUES = ['1', '0', '?', 'NV'] as const;
type CodeValue = (typeof VALUES)[number];
// Number-key shortcuts: 1/2/3/4 → 1/0/?/NV (in this order).
const KEY_TO_VALUE: Record<string, CodeValue> = { '1': '1', '2': '0', '3': '?', '4': 'NV' };
const VALUE_TO_KEY: Record<CodeValue, string> = { '1': '1', '0': '2', '?': '3', NV: '4' };
type Field = 'behaviourOntask' | 'engagement' | 'confusion' | 'frustration' | 'boredom' | 'neutral';
type JustField =
  | 'justBehaviourOntask'
  | 'justEngagement'
  | 'justConfusion'
  | 'justFrustration'
  | 'justBoredom'
  | 'justNeutral';
type Row = Partial<Record<Field, CodeValue>> & Partial<Record<JustField, string>>;

interface Construct {
  field: Field;
  just: JustField;
  label: string;
  csv: string;
  affect: boolean; // one of the four affect constructs that derive `neutral`
}
const CONSTRUCTS: Construct[] = [
  {
    field: 'behaviourOntask',
    just: 'justBehaviourOntask',
    label: 'behaviour_ontask',
    csv: 'behaviour_ontask',
    affect: false,
  },
  {
    field: 'engagement',
    just: 'justEngagement',
    label: 'engagement',
    csv: 'engagement',
    affect: true,
  },
  { field: 'confusion', just: 'justConfusion', label: 'confusion', csv: 'confusion', affect: true },
  {
    field: 'frustration',
    just: 'justFrustration',
    label: 'frustration',
    csv: 'frustration',
    affect: true,
  },
  { field: 'boredom', just: 'justBoredom', label: 'boredom', csv: 'boredom', affect: true },
];
const AFFECT_FIELDS = CONSTRUCTS.filter((c) => c.affect).map((c) => c.field);

// The 5 constructs plus the (now editable) neutral row — used for row focus and
// number-key coding. neutral has a derived default the coder may overwrite.
const EDIT_ROWS: { field: Field; just: JustField; label: string }[] = [
  ...CONSTRUCTS.map((c) => ({ field: c.field, just: c.just, label: c.label })),
  { field: 'neutral', just: 'justNeutral', label: 'neutral' },
];

// Fixed value colors: 1=green, 0=gray, ?=amber, NV=red.
const VAL_ON: Record<CodeValue, string> = {
  '1': 'bg-emerald-600 text-white border-emerald-600',
  '0': 'bg-slate-500 text-white border-slate-500',
  '?': 'bg-amber-500 text-white border-amber-500',
  NV: 'bg-rose-600 text-white border-rose-600',
};
const VAL_TEXT: Record<CodeValue, string> = {
  '1': 'text-emerald-700',
  '0': 'text-slate-600',
  '?': 'text-amber-700',
  NV: 'text-rose-700',
};

const PRESETS = [10, 20, 30];

const fmtHms = (ms: number) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
};

const csvEsc = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Default neutral from the four affect constructs: neutral = 1 unless some
 * affect is present (=1). "?" or "NV" affect do NOT block neutral = 1. */
function deriveNeutral(row: Row | undefined): CodeValue {
  return AFFECT_FIELDS.some((f) => row?.[f] === '1') ? '0' : '1';
}
/** Effective neutral shown/exported: the coder's override if set, else the default. */
function neutralOf(row: Row | undefined): CodeValue {
  return row?.neutral ?? deriveNeutral(row);
}
const isCoded = (row: Row | undefined) =>
  !!row && (CONSTRUCTS.some((c) => row[c.field] != null) || row.neutral != null);
const isFull = (row: Row | undefined) => !!row && CONSTRUCTS.every((c) => row[c.field] != null);

export function WindowCoding() {
  const { sessionId = '' } = useParams();
  const [meta, setMeta] = useState<any>(null);
  const [snaps, setSnaps] = useState<SnapshotLite[]>([]);
  const [sparse, setSparse] = useState<any>(null);

  const [coderId, setCoderId] = useState<string>(() => localStorage.getItem('gals.wc.coder') ?? '');
  const [durationSec, setDurationSec] = useState<number>(10);
  const [customDur, setCustomDur] = useState<string>('');
  const [rows, setRows] = useState<Record<number, Row>>({});
  const [active, setActive] = useState(0);
  const [focusedRow, setFocusedRow] = useState(0);
  const [showScreenshot, setShowScreenshot] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [flashCoder, setFlashCoder] = useState(false);
  const coderRef = useRef<HTMLInputElement>(null);

  // Coding requires a coder id (codes are keyed + persisted by it). Rather than
  // silently no-op a click/keypress, surface the coder field so it's obvious.
  const requireCoder = useCallback(() => {
    if (coderId.trim()) return true;
    coderRef.current?.focus();
    coderRef.current?.scrollIntoView({ block: 'center' });
    setFlashCoder(true);
    window.setTimeout(() => setFlashCoder(false), 1400);
    return false;
  }, [coderId]);

  const storeRef = useRef<PlayheadStore | null>(null);
  if (!storeRef.current)
    storeRef.current = new PlayheadStore({ baseWallClockMs: 0, durationMs: 0 });
  const store = storeRef.current;
  const ph = usePlayhead(store);

  // ── session load ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [m, si, sp] = await Promise.all([
        api.replayMeta(sessionId),
        api.replaySnapshotIndex(sessionId),
        api.replaySparse(sessionId),
      ]);
      setMeta(m);
      setSnaps(si.snapshots ?? []);
      setSparse(sp);
      store.setConfig({ baseWallClockMs: m.baseWallClockMs, durationMs: m.durationMs });
    })();
  }, [sessionId]);

  // remember chosen duration per (session, coder); default 10s
  const durKey = useMemo(() => `gals.wc.dur.${sessionId}.${coderId}`, [sessionId, coderId]);
  useEffect(() => {
    const saved = Number(localStorage.getItem(durKey));
    setDurationSec(saved && saved > 0 ? saved : 10);
  }, [durKey]);

  // ── load stored codes for coder + duration ────────────────────────────────
  const loadRows = useCallback(async () => {
    if (!coderId) {
      setRows({});
      return;
    }
    setLoading(true);
    try {
      const r = await api.windowCodingLoad(sessionId, coderId, durationSec);
      const map: Record<number, Row> = {};
      for (const row of r.rows ?? []) {
        const clean: Row = {};
        for (const c of CONSTRUCTS) if (row[c.field]) (clean as any)[c.field] = row[c.field];
        if (row.neutral) (clean as any).neutral = row.neutral;
        for (const j of [
          'justBehaviourOntask',
          'justEngagement',
          'justConfusion',
          'justFrustration',
          'justBoredom',
          'justNeutral',
        ] as JustField[])
          if (row[j]) (clean as any)[j] = row[j];
        map[row.windowStartMs] = clean;
      }
      setRows(map);
    } finally {
      setLoading(false);
    }
  }, [sessionId, coderId, durationSec]);
  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    localStorage.setItem('gals.wc.coder', coderId);
  }, [coderId]);

  // ── window grid ───────────────────────────────────────────────────────────
  const windowMs = durationSec * 1000;
  const windows = useMemo(() => {
    if (!meta) return [] as { index: number; startMs: number; endMs: number }[];
    const count = Math.max(1, Math.ceil(meta.durationMs / windowMs));
    return Array.from({ length: count }, (_, i) => ({
      index: i,
      startMs: i * windowMs,
      endMs: Math.min((i + 1) * windowMs, meta.durationMs),
    }));
  }, [meta, windowMs]);

  const activeIdx = Math.min(active, Math.max(0, windows.length - 1));
  const activeWindow = windows[activeIdx];
  const activeRow = activeWindow ? rows[activeWindow.startMs] : undefined;

  const codedCount = useMemo(() => Object.values(rows).filter(isCoded).length, [rows]);

  // ── replay sync ───────────────────────────────────────────────────────────
  const absoluteMs = (meta?.baseWallClockMs ?? 0) + ph.offsetMs;
  const currentSnapshot = useMemo(() => snapshotAt(snaps, absoluteMs), [snaps, absoluteMs]);
  const currentGaze = useMemo(
    () => (sparse?.gaze ? nearestByWall(sparse.gaze, absoluteMs) : null),
    [sparse, absoluteMs],
  );

  const gotoWindow = useCallback(
    (idx: number) => {
      if (windows.length === 0) return;
      const clamped = Math.max(0, Math.min(idx, windows.length - 1));
      setActive(clamped);
      setFocusedRow(0);
      store.seek(windows[clamped].startMs);
    },
    [windows],
  );

  const playWindow = useCallback(() => {
    if (!activeWindow) return;
    store.seek(activeWindow.startMs);
    store.play();
  }, [activeWindow]);
  const togglePlay = useCallback(() => {
    ph.playing ? store.pause() : playWindow();
  }, [ph.playing, playWindow]);

  // pause at the end of the window while "play window" is running
  useEffect(() => {
    if (activeWindow && ph.playing && ph.offsetMs >= activeWindow.endMs) store.pause();
  }, [ph.offsetMs, ph.playing, activeWindow]);

  // ── persistence ───────────────────────────────────────────────────────────
  const saveRow = useCallback(
    (startMs: number, row: Row) => {
      if (!coderId) return;
      void api.windowCodingSave(sessionId, {
        coderId,
        windowStartMs: startMs,
        windowDurationSec: durationSec,
        codebookVersion: CODEBOOK_VERSION,
        values: {
          behaviourOntask: row.behaviourOntask ?? null,
          engagement: row.engagement ?? null,
          confusion: row.confusion ?? null,
          frustration: row.frustration ?? null,
          boredom: row.boredom ?? null,
          neutral: row.neutral ?? null,
        },
        justifications: {
          justBehaviourOntask: row.justBehaviourOntask ?? null,
          justEngagement: row.justEngagement ?? null,
          justConfusion: row.justConfusion ?? null,
          justFrustration: row.justFrustration ?? null,
          justBoredom: row.justBoredom ?? null,
          justNeutral: row.justNeutral ?? null,
        },
      });
    },
    [coderId, sessionId, durationSec],
  );

  const setValue = useCallback(
    (ci: number, val: CodeValue) => {
      const w = windows[activeIdx];
      if (!w) return;
      if (!requireCoder()) return;
      const field = EDIT_ROWS[ci].field;
      const cur = rows[w.startMs] ?? {};
      const nextVal = cur[field] === val ? undefined : val;
      const nextRow: Row = { ...cur };
      if (nextVal === undefined) delete nextRow[field];
      else nextRow[field] = nextVal;
      setRows((p) => ({ ...p, [w.startMs]: nextRow }));
      setFocusedRow(ci);
      saveRow(w.startMs, nextRow);
      // No auto-advance: the coder reviews and moves on manually (Next window / →).
    },
    [windows, activeIdx, requireCoder, rows, saveRow],
  );

  const setJust = useCallback(
    (just: JustField, text: string) => {
      const w = windows[activeIdx];
      if (!w) return;
      setRows((p) => ({ ...p, [w.startMs]: { ...(p[w.startMs] ?? {}), [just]: text } }));
    },
    [windows, activeIdx],
  );
  const commitJust = useCallback(() => {
    const w = windows[activeIdx];
    if (!w || !coderId) return;
    saveRow(w.startMs, rows[w.startMs] ?? {});
  }, [windows, activeIdx, coderId, rows, saveRow]);

  // ── duration change (clears existing codes) ───────────────────────────────
  const changeDuration = useCallback(
    async (next: number) => {
      if (!Number.isFinite(next) || next <= 0 || next === durationSec) return;
      const hasCodes = Object.values(rows).some(isCoded);
      if (hasCodes) {
        const ok = window.confirm(
          `Changing the window duration to ${next}s will CLEAR all ${codedCount} coded window(s) for coder “${coderId}”. This cannot be undone.\n\nContinue?`,
        );
        if (!ok) return;
        if (coderId) await api.windowCodingClear(sessionId, coderId);
      }
      setRows({});
      setActive(0);
      setFocusedRow(0);
      setDurationSec(next);
      localStorage.setItem(`gals.wc.dur.${sessionId}.${coderId}`, String(next));
      store.seek(0);
    },
    [durationSec, rows, codedCount, coderId, sessionId],
  );

  // ── keyboard (bound once; reads latest via ref) ───────────────────────────
  const kb = useRef<any>({});
  kb.current = { setValue, gotoWindow, focusedRow, setFocusedRow, activeIdx, togglePlay, coderId };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = kb.current;
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') t.blur();
        return;
      }
      if (KEY_TO_VALUE[e.key]) {
        e.preventDefault();
        h.setValue(h.focusedRow, KEY_TO_VALUE[e.key]);
        return;
      }
      const N = EDIT_ROWS.length;
      switch (e.key) {
        case 'Tab':
          e.preventDefault();
          h.setFocusedRow((h.focusedRow + (e.shiftKey ? N - 1 : 1)) % N);
          break;
        case 'ArrowDown':
          e.preventDefault();
          h.setFocusedRow((h.focusedRow + 1) % N);
          break;
        case 'ArrowUp':
          e.preventDefault();
          h.setFocusedRow((h.focusedRow + N - 1) % N);
          break;
        case 'Enter':
        case 'ArrowRight':
          e.preventDefault();
          h.gotoWindow(h.activeIdx + 1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          h.gotoWindow(h.activeIdx - 1);
          break;
        case ' ':
          e.preventDefault();
          h.togglePlay();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── CSV export (trimmed to first→last coded window) ───────────────────────
  const exportCsv = () => {
    if (!coderId) {
      alert('Enter a coder ID before exporting.');
      return;
    }
    const codedIdx = windows.filter((w) => isCoded(rows[w.startMs])).map((w) => w.index);
    if (codedIdx.length === 0) {
      alert('No coded windows to export.');
      return;
    }
    const first = Math.min(...codedIdx);
    const last = Math.max(...codedIdx);
    const header = [
      'timestamp',
      'behaviour_ontask',
      'engagement',
      'confusion',
      'frustration',
      'boredom',
      'neutral',
      'just_behaviour_ontask',
      'just_engagement',
      'just_confusion',
      'just_frustration',
      'just_boredom',
      'just_neutral',
    ];
    const lines = [header];
    for (let i = first; i <= last; i++) {
      const w = windows[i];
      const row = rows[w.startMs];
      // gap windows inside the coded range stay blank; coded windows show the
      // coder's neutral override if any, else the derived default.
      const neutral = isCoded(row) ? neutralOf(row) : '';
      lines.push([
        fmtHms(w.startMs),
        row?.behaviourOntask ?? '',
        row?.engagement ?? '',
        row?.confusion ?? '',
        row?.frustration ?? '',
        row?.boredom ?? '',
        neutral,
        row?.justBehaviourOntask ?? '',
        row?.justEngagement ?? '',
        row?.justConfusion ?? '',
        row?.justFrustration ?? '',
        row?.justBoredom ?? '',
        row?.justNeutral ?? '',
      ]);
    }
    const csv = '﻿' + lines.map((r) => r.map(csvEsc).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${sessionId}_${coderId}_${durationSec}s_coding.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  };

  if (!meta) {
    return <div className="p-8 text-center text-slate-400">Loading window-coding studio…</div>;
  }

  const neutralValue = neutralOf(activeRow);
  const neutralOverridden = activeRow?.neutral != null;

  return (
    <div className="space-y-2">
      {/* top control bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
        <Link to="/" className="text-slate-400 hover:text-slate-700">
          <ArrowLeft size={14} className="inline align-[-2px]" /> Library
        </Link>
        <span className="font-semibold">
          {meta.session.userDisplayName ?? meta.session.userId?.slice(0, 8)}
        </span>
        <span className="text-slate-400">·</span>
        <label className="flex items-center gap-1">
          <span className="text-[11px] uppercase tracking-wide text-slate-400">Coder ID</span>
          <input
            ref={coderRef}
            value={coderId}
            onChange={(e) => setCoderId(e.target.value)}
            placeholder="required"
            className={`w-28 rounded border px-2 py-1 transition-all ${
              coderId
                ? 'border-slate-300'
                : `border-rose-300 bg-rose-50 ${flashCoder ? 'ring-2 ring-rose-500 animate-pulse' : ''}`
            }`}
          />
        </label>

        {/* window duration */}
        <div className="flex items-center gap-1">
          <span className="text-[11px] uppercase tracking-wide text-slate-400">Window</span>
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => changeDuration(p)}
              className={`rounded px-2 py-1 text-xs ${durationSec === p ? 'bg-slate-900 text-white' : 'bg-slate-100 hover:bg-slate-200'}`}
            >
              {p}s
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={600}
            value={customDur}
            onChange={(e) => setCustomDur(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void changeDuration(Number(customDur));
                setCustomDur('');
              }
            }}
            onBlur={() => {
              if (customDur) {
                void changeDuration(Number(customDur));
                setCustomDur('');
              }
            }}
            placeholder="custom"
            className="w-16 rounded border border-slate-300 px-1 py-1 text-xs"
          />
        </div>

        <span className="ml-auto font-mono text-xs text-slate-500">
          {codedCount}/{windows.length} windows coded
        </span>
        <button
          onClick={() => setShowHelp((s) => !s)}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
          title="Keyboard shortcuts"
        >
          <Keyboard size={13} className="inline align-[-2px]" />
        </button>
        <button
          onClick={exportCsv}
          disabled={codedCount === 0 || !coderId}
          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
        >
          <Download size={13} /> Export CSV
        </button>
      </div>

      {!coderId && (
        <div className="flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">
          <TriangleAlert size={13} /> Enter a coder ID to start coding — codes save per coder and
          are restored on reload.
        </div>
      )}

      {/* timeline ribbon of window ticks */}
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">
          Timeline
        </span>
        <div className="flex flex-1 gap-[2px] overflow-x-auto">
          {windows.map((w) => {
            const row = rows[w.startMs];
            const coded = isCoded(row);
            const full = isFull(row);
            return (
              <button
                key={w.index}
                title={`${fmtHms(w.startMs)}${coded ? ' · coded' : ''}`}
                onClick={() => gotoWindow(w.index)}
                className={`h-4 w-[6px] shrink-0 rounded-sm ${
                  full ? 'bg-emerald-500' : coded ? 'bg-amber-400' : 'bg-slate-200'
                } ${w.index === activeIdx ? 'ring-2 ring-sky-500' : ''}`}
              />
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-[170px_1fr_360px] gap-2">
        {/* window list */}
        <div className="max-h-[80vh] overflow-auto rounded-lg border border-slate-200 bg-white">
          {windows.map((w) => {
            const row = rows[w.startMs];
            const coded = isCoded(row);
            const full = isFull(row);
            return (
              <button
                key={w.index}
                onClick={() => gotoWindow(w.index)}
                className={`flex w-full items-center gap-2 border-b border-slate-100 px-2 py-1 text-left text-xs ${
                  w.index === activeIdx
                    ? 'bg-sky-50 ring-1 ring-inset ring-sky-400'
                    : 'hover:bg-slate-50'
                }`}
              >
                <span className="w-8 text-slate-400">{w.index}</span>
                <span className="flex-1 font-mono text-[11px] text-slate-500">
                  {fmtHms(w.startMs)}
                </span>
                <span
                  className={`h-3 w-3 rounded-full ${full ? 'bg-emerald-500' : coded ? 'bg-amber-400' : 'bg-slate-200'}`}
                />
              </button>
            );
          })}
        </div>

        {/* replay player */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setShowScreenshot((v) => !v)}
              className="rounded border border-slate-300 px-2 py-1"
              title="Pixels = exact rendered frame the student saw. DOM = reconstructed HTML."
            >
              <span className="inline-flex items-center gap-1">
                {showScreenshot ? (
                  <>
                    <Image size={12} /> Pixels (as seen)
                  </>
                ) : (
                  <>
                    <Code size={12} /> DOM (reconstructed)
                  </>
                )}
              </span>
            </button>
            {loading && <span className="text-slate-400">loading codes…</span>}
          </div>
          <div className="grid grid-cols-[1fr_240px] gap-2">
            <DomStage
              sessionId={sessionId}
              snapshot={currentSnapshot}
              gaze={currentGaze as { x: number; y: number } | null}
              lastClick={null}
              aoiVisible={{}}
              showScreenshot={showScreenshot}
              locked
            />
            <WebcamPanel
              segments={(sparse?.webcam ?? []) as WebcamSeg[]}
              absoluteMs={absoluteMs}
              playing={ph.playing}
            />
          </div>

          {activeWindow && (
            <WindowScrubber
              win={activeWindow}
              offsetMs={ph.offsetMs}
              onSeek={(o) => store.seek(o)}
            />
          )}

          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <button
              onClick={() => gotoWindow(activeIdx - 1)}
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            >
              ← Prev
            </button>
            <button
              onClick={playWindow}
              className="flex items-center gap-1 rounded bg-slate-900 px-3 py-1 text-white"
            >
              <Play size={14} /> Play window
            </button>
            <button
              onClick={() => store.pause()}
              className="rounded border border-slate-300 px-2 py-1"
            >
              <Pause size={14} />
            </button>
            <button
              onClick={() => gotoWindow(activeIdx + 1)}
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            >
              Next window →
            </button>
            {activeWindow && (
              <span className="ml-auto font-mono text-xs text-slate-400">
                window {activeWindow.index} · {fmtHms(activeWindow.startMs)}–
                {fmtHms(activeWindow.endMs)}
              </span>
            )}
          </div>
        </div>

        {/* coding grid */}
        <div
          className={`max-h-[80vh] overflow-auto rounded-lg border bg-white p-2 ${
            coderId ? 'border-slate-200' : 'border-rose-200'
          }`}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Window {activeWindow?.index ?? 0} · {activeWindow ? fmtHms(activeWindow.startMs) : ''}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
              {!coderId ? (
                <button
                  onClick={requireCoder}
                  className="inline-flex items-center gap-1 font-semibold text-rose-600"
                >
                  <TriangleAlert size={12} /> enter coder ID to code
                </button>
              ) : isFull(activeRow) ? (
                <>
                  <Check size={12} className="text-emerald-600" /> complete
                </>
              ) : isCoded(activeRow) ? (
                'partial'
              ) : (
                'uncoded'
              )}
            </span>
          </div>

          <div className={coderId ? '' : 'opacity-50'}>
            {CONSTRUCTS.map((c, ci) => {
              const val = activeRow?.[c.field];
              const focused = ci === focusedRow;
              return (
                <div
                  key={c.field}
                  onClick={() => setFocusedRow(ci)}
                  className={`mb-1.5 rounded border p-1.5 ${focused ? 'border-sky-400 bg-sky-50/60' : 'border-transparent'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-32 shrink-0 font-mono text-[11px] text-slate-600">
                      {c.label}
                    </span>
                    <div className="flex gap-1">
                      {VALUES.map((v) => (
                        <button
                          key={v}
                          onClick={(e) => {
                            e.stopPropagation();
                            setValue(ci, v);
                          }}
                          title={`shortcut: ${VALUE_TO_KEY[v]}`}
                          className={`w-10 rounded border py-0.5 text-xs font-semibold ${
                            val === v
                              ? VAL_ON[v]
                              : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50'
                          }`}
                        >
                          {v}
                          <span className="ml-0.5 align-super text-[8px] opacity-50">
                            {VALUE_TO_KEY[v]}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    value={activeRow?.[c.just] ?? ''}
                    onChange={(e) => setJust(c.just, e.target.value)}
                    onBlur={() => commitJust()}
                    placeholder="justification (optional)"
                    className="mt-1 w-44 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] transition-all focus:w-full"
                  />
                </div>
              );
            })}

            {/* neutral: derived default (1 unless an affect = 1), coder-overridable */}
            <div
              onClick={() => setFocusedRow(CONSTRUCTS.length)}
              className={`mb-1.5 rounded border p-1.5 ${
                focusedRow === CONSTRUCTS.length
                  ? 'border-sky-400 bg-sky-50/60'
                  : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="w-32 shrink-0 font-mono text-[11px] text-slate-600">
                  neutral{' '}
                  <span className="text-[9px] text-slate-400">
                    {neutralOverridden ? '(override)' : '(auto)'}
                  </span>
                </span>
                <div className="flex gap-1">
                  {VALUES.map((v) => {
                    const override = activeRow?.neutral === v;
                    const isDefault = !neutralOverridden && neutralValue === v;
                    return (
                      <button
                        key={v}
                        onClick={(e) => {
                          e.stopPropagation();
                          setValue(CONSTRUCTS.length, v);
                        }}
                        title={`shortcut: ${VALUE_TO_KEY[v]}${isDefault ? ' · current auto value' : ''}`}
                        className={`w-10 rounded border py-0.5 text-xs font-semibold ${
                          override
                            ? VAL_ON[v]
                            : isDefault
                              ? `border-dashed border-slate-400 bg-white ${VAL_TEXT[v]}`
                              : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50'
                        }`}
                      >
                        {v}
                        <span className="ml-0.5 align-super text-[8px] opacity-50">
                          {VALUE_TO_KEY[v]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-1 text-[10px] leading-snug text-slate-400">
                {neutralOverridden
                  ? 'coder override — click the selected value again to clear'
                  : `auto = ${neutralValue} · neutral is 1 unless an affect is coded 1 (a “?” or “NV” affect still allows 1)`}
              </div>
              <input
                value={activeRow?.justNeutral ?? ''}
                onChange={(e) => setJust('justNeutral', e.target.value)}
                onBlur={() => commitJust()}
                placeholder="justification (optional)"
                className="mt-1 w-44 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] transition-all focus:w-full"
              />
            </div>

            <div className="mt-2 rounded bg-slate-50 p-1.5 text-[10px] leading-relaxed text-slate-400">
              <span className="font-semibold text-slate-500">Keys:</span> 1 / 2 / 3 / 4 → 1 / 0 / ?
              / NV on the focused row · Tab or ↑↓ move rows · Enter or → next window · ← prev ·
              Space play/pause
            </div>
          </div>

          {/* Explicit navigation — coding never auto-advances, so the coder can
              review before moving on. */}
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => gotoWindow(activeIdx - 1)}
              disabled={activeIdx <= 0}
              className="rounded border border-slate-300 px-2 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              onClick={() => gotoWindow(activeIdx + 1)}
              disabled={activeIdx >= windows.length - 1}
              className="flex flex-1 items-center justify-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
              title="Move to the next window (Enter or →)"
            >
              Next window →
            </button>
          </div>
        </div>
      </div>

      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="w-[460px] rounded-lg bg-white p-5 text-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 text-lg font-bold">Window coding — shortcuts</h2>
            <ul className="space-y-1 text-slate-600">
              <li>
                <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> — set 1 / 0 / ? / NV on the
                focused row
              </li>
              <li>
                <kbd>Tab</kbd> / <kbd>↑</kbd> <kbd>↓</kbd> — move between rows (incl. neutral)
              </li>
              <li>
                <kbd>Enter</kbd> / <kbd>→</kbd> — next window · <kbd>←</kbd> — previous window
              </li>
              <li>
                <kbd>Space</kbd> — play / pause the window · <kbd>Esc</kbd> — leave a justification
                box
              </li>
            </ul>
            <p className="mt-3 text-xs text-slate-400">
              neutral defaults to 1 unless one of the affect states is coded 1 (a “?” or “NV” affect
              still allows neutral = 1); the coder can overwrite it. Codes auto-save per coder (
              {CODEBOOK_VERSION}).
            </p>
            <button
              onClick={() => setShowHelp(false)}
              className="mt-4 rounded bg-slate-900 px-3 py-1 text-white"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WindowScrubber({
  win,
  offsetMs,
  onSeek,
}: {
  win: { startMs: number; endMs: number };
  offsetMs: number;
  onSeek: (o: number) => void;
}) {
  const span = win.endMs - win.startMs || 1;
  const pct = Math.max(0, Math.min(100, ((offsetMs - win.startMs) / span) * 100));
  return (
    <div
      className="relative h-8 cursor-pointer rounded bg-slate-100"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek(win.startMs + ((e.clientX - rect.left) / rect.width) * span);
      }}
    >
      <div className="absolute top-0 h-full w-0.5 bg-slate-900" style={{ left: `${pct}%` }} />
      <span className="absolute left-1 top-1 text-[10px] text-slate-400">
        {fmtHms(win.startMs)}–{fmtHms(win.endMs)}
      </span>
    </div>
  );
}
