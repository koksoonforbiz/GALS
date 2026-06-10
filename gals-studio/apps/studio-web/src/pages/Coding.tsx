import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { DEFAULT_CODEBOOK, type CodeDef, type Dimension } from '@gals-studio/shared/browser';
import { PlayheadStore, usePlayhead, fmtRel } from '../replay/clock';
import { snapshotAt, nearestByWall, type SnapshotLite, type WebcamSeg } from '../replay/lookup';
import { DomStage } from '../replay/DomStage';
import { WebcamPanel } from '../replay/WebcamPanel';
import { WindowSignals } from '../replay/WindowSignals';

const PASSES = ['primary_rater_1', 'primary_rater_2', 'tiebreaker'] as const;
const BUFFER_MS = 5000;
const codebook = DEFAULT_CODEBOOK;
const shortcutMap = new Map<string, CodeDef>(codebook.codes.map((c) => [c.shortcut, c]));

export function Coding() {
  const { sessionId = '' } = useParams();
  const [meta, setMeta] = useState<any>(null);
  const [snaps, setSnaps] = useState<SnapshotLite[]>([]);
  const [sparse, setSparse] = useState<any>(null);
  const [state, setState] = useState<any>(null);
  const [coders, setCoders] = useState<any[]>([]);
  const [coderId, setCoderId] = useState<string>(() => localStorage.getItem('gals.coderId') ?? '');
  const [pass, setPass] = useState<string>(
    () => localStorage.getItem('gals.pass') ?? 'primary_rater_1',
  );
  const [active, setActive] = useState(0);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [filter, setFilter] = useState<'all' | 'uncoded' | 'disagreements'>('all');
  const [showHelp, setShowHelp] = useState(false);
  const [showGroundTruth, setShowGroundTruth] = useState(false);
  const [showScreenshot, setShowScreenshot] = useState(true);
  const [disagreements, setDisagreements] = useState<any[]>([]);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const windowEnterRef = useRef<number>(Date.now());

  const storeRef = useRef<PlayheadStore | null>(null);
  if (!storeRef.current)
    storeRef.current = new PlayheadStore({ baseWallClockMs: 0, durationMs: 0 });
  const store = storeRef.current;
  const ph = usePlayhead(store);

  const windows: any[] = state?.windows ?? [];
  const activeWindow = windows[active];

  useEffect(() => {
    (async () => {
      const [m, si, sp, cs] = await Promise.all([
        api.replayMeta(sessionId),
        api.replaySnapshotIndex(sessionId),
        api.replaySparse(sessionId),
        api.coders(),
      ]);
      setMeta(m);
      setSnaps(si.snapshots);
      setSparse(sp);
      setCoders(cs.coders);
      store.setConfig({ baseWallClockMs: m.baseWallClockMs, durationMs: m.durationMs });
    })();
  }, [sessionId]);

  const refreshState = useCallback(async () => {
    if (!coderId) return;
    const cs = await api.codingState(sessionId, coderId, pass);
    setState(cs);
    const dq = await api.disagreements(sessionId);
    setDisagreements(dq.disagreements);
  }, [sessionId, coderId, pass]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  useEffect(() => {
    localStorage.setItem('gals.coderId', coderId);
    localStorage.setItem('gals.pass', pass);
  }, [coderId, pass]);

  useEffect(() => {
    if (activeWindow)
      localStorage.setItem(`gals.active.${sessionId}.${coderId}.${pass}`, String(active));
    windowEnterRef.current = Date.now();
  }, [active, activeWindow?.id]);

  useEffect(() => {
    if (!activeWindow || !meta) return;
    const endOffset = activeWindow.endWallMs - meta.baseWallClockMs + BUFFER_MS;
    if (ph.playing && ph.offsetMs >= endOffset) store.pause();
  }, [ph.offsetMs, ph.playing, activeWindow, meta]);

  const absoluteMs = (meta?.baseWallClockMs ?? 0) + ph.offsetMs;
  const currentSnapshot = useMemo(() => snapshotAt(snaps, absoluteMs), [snaps, absoluteMs]);
  const currentGaze = useMemo(
    () => (sparse?.gaze ? nearestByWall(sparse.gaze, absoluteMs) : null),
    [sparse, absoluteMs],
  );
  const winAnns = activeWindow ? state?.annotations?.[activeWindow.id] : null;

  const playWindow = useCallback(() => {
    if (!activeWindow || !meta) return;
    store.seek(Math.max(0, activeWindow.startWallMs - meta.baseWallClockMs - BUFFER_MS));
    store.play();
  }, [activeWindow, meta]);

  const gotoWindow = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(idx, windows.length - 1));
      setActive(clamped);
      const w = windows[clamped];
      if (w && meta) store.seek(Math.max(0, w.startWallMs - meta.baseWallClockMs));
    },
    [windows, meta],
  );

  const advanceToNextUncoded = useCallback(() => {
    for (let i = active + 1; i < windows.length; i++) {
      const a = state?.annotations?.[windows[i].id];
      if (!a?.affect || !a?.behavior) {
        gotoWindow(i);
        return;
      }
    }
    gotoWindow(active + 1);
  }, [active, windows, state, gotoWindow]);

  const assign = useCallback(
    async (code: CodeDef) => {
      if (!activeWindow || !coderId) return;
      const codingMs = Date.now() - windowEnterRef.current;
      const base = {
        sessionId,
        windowId: activeWindow.id,
        coderId,
        codingPass: pass,
        dimension: code.dimension,
        code: code.key,
        codingMs,
      };

      if (code.dimension === 'affect' || code.dimension === 'behavior') {
        setState((prev: any) => {
          if (!prev) return prev;
          const next = structuredClone(prev);
          next.annotations[activeWindow.id][code.dimension] = { code: code.key, coderId };
          return next;
        });
        await api.upsertAnnotation(base);
        const a = state?.annotations?.[activeWindow.id];
        const willHaveBoth = code.dimension === 'affect' ? !!a?.behavior : !!a?.affect;
        if (autoAdvance && willHaveBoth) advanceToNextUncoded();
      } else {
        const arr = (state?.annotations?.[activeWindow.id]?.[code.dimension] as any[]) ?? [];
        const ann = arr.find((a) => a.code === code.key);
        if (ann?.id) {
          await api.deleteAnnotation(ann.id);
        } else {
          const mid = (activeWindow.startWallMs + activeWindow.endWallMs) / 2;
          await api.upsertAnnotation({
            ...base,
            atWallMs: code.anchor === 'point' ? mid : undefined,
            startWallMs: code.anchor === 'range' ? activeWindow.startWallMs : undefined,
            endWallMs: code.anchor === 'range' ? activeWindow.endWallMs : undefined,
          });
        }
      }
      void refreshState();
    },
    [
      activeWindow,
      coderId,
      pass,
      autoAdvance,
      state,
      sessionId,
      advanceToNextUncoded,
      refreshState,
    ],
  );

  const clearAffect = useCallback(async () => {
    if (!activeWindow || !coderId) return;
    await api.clearAnnotation({
      sessionId,
      windowId: activeWindow.id,
      coderId,
      codingPass: pass,
      dimension: 'affect',
    });
    void refreshState();
  }, [activeWindow, coderId, pass, sessionId, refreshState]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === '?') {
        setShowHelp((s) => !s);
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        ph.playing ? store.pause() : playWindow();
        return;
      }
      if (e.key === '[' || e.key === 'ArrowLeft') {
        gotoWindow(active - 1);
        return;
      }
      if (e.key === ']' || e.key === 'ArrowRight') {
        gotoWindow(active + 1);
        return;
      }
      if (e.key === 'n') {
        e.preventDefault();
        notesRef.current?.focus();
        return;
      }
      if (e.key === 'u') {
        const u = codebook.codes.find((c) => c.key === 'unclear');
        if (u) void assign(u);
        return;
      }
      if (e.key === '0') {
        void clearAffect();
        return;
      }
      const code = shortcutMap.get(e.key);
      if (code) {
        e.preventDefault();
        void assign(code);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [assign, gotoWindow, active, ph.playing, playWindow, clearAffect]);

  if (!meta || !state) {
    return (
      <div className="p-8 text-center text-slate-400">
        Loading coding studio…
        {meta && coders.length === 0 && (
          <div className="mt-3">
            <CreateCoder
              onCreated={(c) => {
                setCoders([c]);
                setCoderId(c.id);
              }}
            />
          </div>
        )}
      </div>
    );
  }

  const disagreementWinIds = new Set(
    disagreements.filter((d) => !d.resolved).map((d) => d.windowId),
  );
  const visibleWindows = windows.filter((w) => {
    if (filter === 'uncoded')
      return !state.annotations[w.id]?.affect || !state.annotations[w.id]?.behavior;
    if (filter === 'disagreements') return disagreementWinIds.has(w.id);
    return true;
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
        <Link to="/" className="text-slate-400 hover:text-slate-700">
          ← Library
        </Link>
        <span className="font-semibold">
          {meta.session.userDisplayName ?? meta.session.userId.slice(0, 8)}
        </span>
        <span className="text-slate-400">|</span>
        <label>I am:</label>
        <select
          value={coderId}
          onChange={(e) => setCoderId(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        >
          <option value="">— select coder —</option>
          {coders.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.role})
            </option>
          ))}
        </select>
        <CreateCoder
          onCreated={(c) => {
            setCoders((cs) => [...cs, c]);
            setCoderId(c.id);
          }}
        />
        <label>Pass:</label>
        <select
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        >
          {PASSES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <span className="ml-auto text-slate-500">
          {state.progress.codedAffect}/{state.progress.total} affect ·{' '}
          {state.progress.missingAffect} missing
          {disagreementWinIds.size > 0 && (
            <span className="ml-2 text-amber-600">· {disagreementWinIds.size} disagreements</span>
          )}
        </span>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={autoAdvance}
            onChange={(e) => setAutoAdvance(e.target.checked)}
          />{' '}
          auto-advance
        </label>
        <label
          className="flex items-center gap-1"
          title="Hidden by default during primary coding to avoid biasing the rater"
        >
          <input
            type="checkbox"
            checked={showGroundTruth}
            onChange={(e) => setShowGroundTruth(e.target.checked)}
          />{' '}
          QA: show probes
        </label>
        <button
          onClick={() => setShowHelp((s) => !s)}
          className="rounded border border-slate-300 px-2 py-1"
        >
          ?
        </button>
      </div>

      <div className="grid grid-cols-[200px_1fr_280px] gap-2">
        {/* window strip */}
        <div className="max-h-[80vh] overflow-auto rounded-lg border border-slate-200 bg-white">
          <div className="sticky top-0 flex gap-1 border-b border-slate-200 bg-white p-2 text-[11px]">
            {(['all', 'uncoded', 'disagreements'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded px-1.5 py-0.5 ${filter === f ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}
              >
                {f}
              </button>
            ))}
          </div>
          {visibleWindows.map((w) => {
            const a = state.annotations[w.id];
            const idx = windows.indexOf(w);
            return (
              <button
                key={w.id}
                onClick={() => gotoWindow(idx)}
                className={`flex w-full items-center gap-1 border-b border-slate-100 px-2 py-1 text-left text-xs ${idx === active ? 'bg-sky-50 ring-1 ring-inset ring-sky-400' : 'hover:bg-slate-50'}`}
              >
                <span className="w-6 text-slate-400">{w.index}</span>
                <span className="w-12 font-mono text-[10px] text-slate-400">
                  {fmtRel(w.startWallMs - meta.baseWallClockMs)}
                </span>
                {a?.affect && (
                  <span
                    className="h-3 w-3 rounded"
                    style={{ backgroundColor: colorOf(a.affect.code) }}
                    title={a.affect.code}
                  />
                )}
                {a?.behavior && (
                  <span
                    className="h-3 w-3 rounded-sm border border-slate-400"
                    style={{ backgroundColor: colorOf(a.behavior.code) }}
                    title={a.behavior.code}
                  />
                )}
                {(a?.ef_event?.length ?? 0) > 0 && (
                  <span className="text-[9px] text-rose-500">●{a.ef_event.length}</span>
                )}
                {(a?.motivation?.length ?? 0) > 0 && (
                  <span className="text-[9px] text-emerald-500">◆{a.motivation.length}</span>
                )}
                {(sparse?.probes ?? []).some(
                  (p: any) => p.wallMs >= w.startWallMs && p.wallMs <= w.endWallMs,
                ) && (
                  <span className="text-[9px] text-violet-500" title="probe in window">
                    ◉
                  </span>
                )}
                {disagreementWinIds.has(w.id) && <span className="ml-auto text-amber-500">⚔</span>}
              </button>
            );
          })}
        </div>

        {/* dual-pane player */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setShowScreenshot((v) => !v)}
              className="rounded border border-slate-300 px-2 py-1"
              title="Pixels = the exact rendered frame the student saw (slides, canvas, styling). DOM = reconstructed live HTML (interactive, but canvas/slides may be blank)."
            >
              {showScreenshot ? '🖼 Pixels (as seen)' : '⟨⟩ DOM (reconstructed)'}
            </button>
            {showScreenshot && currentSnapshot && !currentSnapshot.hasScreenshot && (
              <span className="text-amber-600">no screenshot at this moment — switch to DOM</span>
            )}
          </div>
          <div className="grid grid-cols-[1fr_240px] gap-2">
            <DomStage
              sessionId={sessionId}
              snapshot={currentSnapshot}
              gaze={currentGaze as { x: number; y: number } | null}
              lastClick={null}
              aoiVisible={{}}
              showScreenshot={showScreenshot}
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
              base={meta.baseWallClockMs}
              offsetMs={ph.offsetMs}
              onSeek={(o) => store.seek(o)}
            />
          )}

          {activeWindow && (
            <WindowSignals
              sessionId={sessionId}
              win={activeWindow}
              base={meta.baseWallClockMs}
              offsetMs={ph.offsetMs}
              gaze={sparse?.gaze ?? []}
              snapshots={snaps}
              efDetections={sparse?.efDetections ?? []}
            />
          )}

          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <button
              onClick={() => gotoWindow(active - 1)}
              className="rounded border border-slate-300 px-2 py-1"
            >
              [ Prev
            </button>
            <button onClick={playWindow} className="rounded bg-slate-900 px-3 py-1 text-white">
              ▶ Play window
            </button>
            <button
              onClick={() => store.pause()}
              className="rounded border border-slate-300 px-2 py-1"
            >
              ⏸
            </button>
            <button
              onClick={() => gotoWindow(active + 1)}
              className="rounded border border-slate-300 px-2 py-1"
            >
              Next ]
            </button>
            {activeWindow && (
              <span className="font-mono text-xs text-slate-400">
                window {activeWindow.index} ·{' '}
                {fmtRel(activeWindow.startWallMs - meta.baseWallClockMs)}–
                {fmtRel(activeWindow.endWallMs - meta.baseWallClockMs)}
              </span>
            )}
            <span className="ml-auto text-emerald-600">
              {winAnns?.affect && winAnns?.behavior ? 'saved ✓' : 'needs affect+behavior'}
            </span>
          </div>

          {pass === 'tiebreaker' && (
            <DisagreementCompare disagreements={disagreements} activeWindowId={activeWindow?.id} />
          )}
          <WindowContext sparse={sparse} win={activeWindow} showGroundTruth={showGroundTruth} />
        </div>

        {/* palette */}
        <div className="max-h-[80vh] overflow-auto rounded-lg border border-slate-200 bg-white p-2">
          {(['affect', 'behavior', 'ef_event', 'motivation'] as Dimension[]).map((dim) => (
            <div key={dim} className="mb-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {dim}
              </div>
              <div className="flex flex-wrap gap-1">
                {codebook.codes
                  .filter((c) => c.dimension === dim)
                  .map((c) => {
                    const selected =
                      (dim === 'affect' && winAnns?.affect?.code === c.key) ||
                      (dim === 'behavior' && winAnns?.behavior?.code === c.key) ||
                      ((dim === 'ef_event' || dim === 'motivation') &&
                        (winAnns?.[dim] as any[])?.some((a) => a.code === c.key));
                    return (
                      <button
                        key={c.key}
                        onClick={() => assign(c)}
                        title={`${c.definition}\n${c.inclusion ?? ''}`}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs"
                        style={{
                          backgroundColor: c.color + (selected ? '44' : '22'),
                          color: c.color,
                          boxShadow: selected ? `0 0 0 2px ${c.color}` : undefined,
                        }}
                      >
                        <kbd className="rounded bg-white/70 px-1 font-mono text-[10px]">
                          {c.shortcut}
                        </kbd>
                        {c.label}
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
          <textarea
            ref={notesRef}
            placeholder="Notes (n)…"
            className="mt-2 w-full rounded border border-slate-300 p-2 text-xs"
            rows={3}
            onBlur={(e) => {
              if (activeWindow && coderId && winAnns?.affect)
                void api.upsertAnnotation({
                  sessionId,
                  windowId: activeWindow.id,
                  coderId,
                  codingPass: pass,
                  dimension: 'affect',
                  code: winAnns.affect.code,
                  notes: e.target.value,
                });
            }}
          />
          {pass === 'tiebreaker' && (
            <button
              onClick={async () => {
                await api.deriveGold(sessionId);
                void refreshState();
              }}
              className="mt-2 w-full rounded bg-emerald-600 px-2 py-1 text-sm text-white"
            >
              Derive gold consensus
            </button>
          )}
        </div>
      </div>

      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
    </div>
  );
}

function colorOf(code: string): string {
  return codebook.codes.find((c) => c.key === code)?.color ?? '#94a3b8';
}

function WindowScrubber({
  win,
  base,
  offsetMs,
  onSeek,
}: {
  win: any;
  base: number;
  offsetMs: number;
  onSeek: (o: number) => void;
}) {
  const startOff = win.startWallMs - base;
  const endOff = win.endWallMs - base;
  const viewStart = Math.max(0, startOff - BUFFER_MS);
  const viewEnd = endOff + BUFFER_MS;
  const span = viewEnd - viewStart || 1;
  const pct = (o: number) => ((o - viewStart) / span) * 100;
  return (
    <div
      className="relative h-8 cursor-pointer rounded bg-slate-100"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek(viewStart + ((e.clientX - rect.left) / rect.width) * span);
      }}
    >
      <div
        className="absolute top-0 h-full bg-sky-200/70"
        style={{ left: `${pct(startOff)}%`, width: `${pct(endOff) - pct(startOff)}%` }}
      />
      <div
        className="absolute top-0 h-full w-0.5 bg-slate-900"
        style={{ left: `${pct(offsetMs)}%` }}
      />
      <span className="absolute left-1 top-1 text-[10px] text-slate-400">
        ±5s context · 20s window shaded
      </span>
    </div>
  );
}

function DisagreementCompare({
  disagreements,
  activeWindowId,
}: {
  disagreements: any[];
  activeWindowId?: string;
}) {
  const here = disagreements.filter((d) => d.windowId === activeWindowId);
  if (here.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs">
      <div className="mb-1 font-semibold text-amber-700">Disagreements in this window</div>
      {here.map((d, i) => (
        <div key={i} className="flex gap-3">
          <span className="font-semibold">{d.dimension}:</span>
          <span style={{ color: colorOf(d.rater1.code) }}>R1 {d.rater1.code}</span>
          <span style={{ color: colorOf(d.rater2.code) }}>R2 {d.rater2.code}</span>
          {d.tiebreaker && <span className="text-emerald-700">→ {d.tiebreaker.code}</span>}
        </div>
      ))}
    </div>
  );
}

function WindowContext({
  sparse,
  win,
  showGroundTruth,
}: {
  sparse: any;
  win: any;
  showGroundTruth?: boolean;
}) {
  if (!sparse || !win) return null;
  const inWin = (ms: number) =>
    ms >= win.startWallMs - BUFFER_MS && ms <= win.endWallMs + BUFFER_MS;
  const msgs = [...(sparse.chatbot ?? []), ...(sparse.dialogue ?? [])].filter((m: any) =>
    inWin(m.wallMs),
  );
  const efs = (sparse.efDetections ?? []).filter((d: any) => inWin(d.wallMs));
  const probes = (sparse.probes ?? []).filter((p: any) => inWin(p.wallMs));
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs">
      <div className="mb-1 font-semibold text-slate-500">Window text channel</div>
      {msgs.length === 0 && efs.length === 0 && (
        <div className="text-slate-400">No chat/EF in this window</div>
      )}
      {msgs.map((m: any, i: number) => (
        <div key={i}>
          <span className="font-semibold">{m.role}:</span> {m.content?.slice(0, 140)}
        </div>
      ))}
      {efs.map((d: any, i: number) => (
        <div key={`e${i}`} className="text-rose-600">
          EF: {d.construct} ({d.label})
        </div>
      ))}
      {probes.length > 0 &&
        (showGroundTruth ? (
          probes.map((p: any, i: number) => (
            <div key={`p${i}`} className="text-violet-600">
              Probe ◉ {p.probeType} (self-report revealed in QA mode)
            </div>
          ))
        ) : (
          <div className="text-violet-400">
            ◉ {probes.length} probe(s) in window — hidden during primary coding (enable QA to view)
          </div>
        ))}
    </div>
  );
}

function CreateCoder({ onCreated }: { onCreated: (c: any) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('trained_rater');
  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded border border-slate-300 px-2 py-1 text-xs"
      >
        + coder
      </button>
    );
  return (
    <span className="flex items-center gap-1">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="name"
        className="rounded border border-slate-300 px-1 py-0.5 text-xs"
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className="rounded border border-slate-300 px-1 py-0.5 text-xs"
      >
        {['trained_rater', 'tiebreaker', 'teacher', 'expert'].map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
      <button
        onClick={async () => {
          if (!name) return;
          const c = await api.createCoder(name, role);
          onCreated(c);
          setOpen(false);
          setName('');
        }}
        className="rounded bg-slate-900 px-2 py-0.5 text-xs text-white"
      >
        add
      </button>
    </span>
  );
}

function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-[480px] rounded-lg bg-white p-5 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-lg font-bold">Keyboard shortcuts</h2>
        <ul className="space-y-1">
          <li>
            <kbd>space</kbd> play/pause window · <kbd>[</kbd> <kbd>]</kbd> / arrows: prev/next
            window
          </li>
          <li>
            <kbd>1</kbd>–<kbd>9</kbd> affect · <kbd>q w e r t y u</kbd> behavior
          </li>
          <li>
            <kbd>a s d f g h j k</kbd> EF events · <kbd>z x c v</kbd> motivation
          </li>
          <li>
            <kbd>u</kbd> unclear · <kbd>0</kbd> clear affect · <kbd>n</kbd> notes · <kbd>?</kbd>{' '}
            this help
          </li>
        </ul>
        <button onClick={onClose} className="mt-4 rounded bg-slate-900 px-3 py-1 text-white">
          Close
        </button>
      </div>
    </div>
  );
}
