import { Circle } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AffectThresholds } from './affect';

export interface Series {
  [key: string]: { t: number; v: number }[];
}

export interface TimelineEvents {
  clicks: { wallMs: number }[];
  chatbot: { wallMs: number }[];
  dialogue: { wallMs: number }[];
  interventions: { wallMs: number }[];
  efDetections: { wallMs: number }[];
  visibility: { wallMs: number; visibleState?: string; hiddenDurationMs?: number | null }[];
  probes: { wallMs: number }[];
}

const W = 1000;
const H = 220;
const PLOT_H = 150;
const LANE_TOP = 160;

const EMOTION_COLORS: Record<string, string> = {
  happiness: '#16a34a',
  sadness: '#3b82f6',
  surprise: '#a855f7',
  fear: '#8b5cf6',
  anger: '#dc2626',
  disgust: '#65a30d',
  contempt: '#db2777',
  neutral: '#94a3b8',
};
const AFFECT_COLORS: Record<string, string> = {
  engagement: '#16a34a',
  boredom: '#6b7280',
  confusion: '#f59e0b',
  frustration: '#dc2626',
};

/** Human-friendly tick step ladder. */
function tickStepMs(durationMs: number): number {
  const ladder = [5e3, 10e3, 30e3, 60e3, 2 * 60e3, 5 * 60e3, 10 * 60e3, 30 * 60e3, 60 * 60e3];
  for (const step of ladder) if (durationMs / step <= 12) return step;
  return 60 * 60e3;
}

function fmtTick(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function SignalTimeline(props: {
  durationMs: number;
  baseWallClockMs: number;
  emotions: Series;
  affect: Series;
  aus: Series;
  thresholds: AffectThresholds;
  offsetMs: number;
  events: TimelineEvents;
  onSeek: (offsetMs: number) => void;
}) {
  const {
    durationMs,
    emotions,
    affect,
    aus,
    offsetMs,
    events,
    onSeek,
    baseWallClockMs,
    thresholds,
  } = props;
  const [showEmotions, setShowEmotions] = useState(true);
  const [showAffect, setShowAffect] = useState(true);
  const [showAus, setShowAus] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const x = (t: number) => (durationMs ? (t / durationMs) * W : 0);
  const y = (v: number) => PLOT_H - v * PLOT_H;

  const toggle = (key: string) =>
    setHidden((h) => {
      const next = new Set(h);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const path = (pts: { t: number; v: number }[]) =>
    pts.length ? 'M' + pts.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' L') : '';

  const ticks = useMemo(() => {
    const step = tickStepMs(durationMs);
    const out: number[] = [];
    for (let t = 0; t <= durationMs; t += step) out.push(t);
    return out;
  }, [durationMs]);

  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    onSeek((px / W) * durationMs);
  };

  const lane = (items: { wallMs: number }[], yPos: number, color: string) =>
    items.map((it, i) => {
      const t = it.wallMs - baseWallClockMs;
      if (t < 0 || t > durationMs) return null;
      return (
        <line
          key={i}
          x1={x(t)}
          x2={x(t)}
          y1={yPos}
          y2={yPos + 8}
          stroke={color}
          strokeWidth={1.5}
        />
      );
    });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
        <Group label="Emotions" on={showEmotions} set={setShowEmotions} />
        <Group label="Affect" on={showAffect} set={setShowAffect} />
        <Group label="AUs" on={showAus} set={setShowAus} />
        <div className="flex flex-wrap gap-1">
          {showEmotions &&
            Object.keys(emotions).map((k) => (
              <Chip
                key={k}
                label={k}
                color={EMOTION_COLORS[k]}
                off={hidden.has(`e:${k}`)}
                onClick={() => toggle(`e:${k}`)}
              />
            ))}
          {showAffect &&
            Object.keys(affect).map((k) => (
              <Chip
                key={k}
                label={k}
                color={AFFECT_COLORS[k]}
                off={hidden.has(`a:${k}`)}
                onClick={() => toggle(`a:${k}`)}
              />
            ))}
          {showAus &&
            Object.keys(aus).map((k) => (
              <Chip
                key={k}
                label={k}
                color="#0891b2"
                off={hidden.has(`u:${k}`)}
                onClick={() => toggle(`u:${k}`)}
              />
            ))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair"
        onClick={onClick}
        style={{ height: 240 }}
      >
        <rect x={0} y={0} width={W} height={PLOT_H} fill="#f8fafc" />
        {/* threshold guide lines */}
        {showAffect &&
          Object.entries(thresholds).map(([k, thr]) => (
            <line
              key={k}
              x1={0}
              x2={W}
              y1={y(thr)}
              y2={y(thr)}
              stroke={AFFECT_COLORS[k] ?? '#cbd5e1'}
              strokeDasharray="3 3"
              strokeWidth={0.5}
              opacity={0.5}
            />
          ))}
        {/* ticks */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={x(t)} x2={x(t)} y1={0} y2={PLOT_H} stroke="#e2e8f0" strokeWidth={0.5} />
            <text x={x(t) + 2} y={PLOT_H - 2} fontSize={8} fill="#94a3b8">
              {fmtTick(t)}
            </text>
          </g>
        ))}
        {/* emotion polylines */}
        {showEmotions &&
          Object.entries(emotions).map(([k, pts]) =>
            hidden.has(`e:${k}`) ? null : (
              <path
                key={k}
                d={path(pts)}
                fill="none"
                stroke={EMOTION_COLORS[k]}
                strokeWidth={0.8}
                opacity={0.8}
              />
            ),
          )}
        {showAffect &&
          Object.entries(affect).map(([k, pts]) =>
            hidden.has(`a:${k}`) ? null : (
              <path key={k} d={path(pts)} fill="none" stroke={AFFECT_COLORS[k]} strokeWidth={1.4} />
            ),
          )}
        {showAus &&
          Object.entries(aus).map(([k, pts]) =>
            hidden.has(`u:${k}`) ? null : (
              <path
                key={k}
                d={path(normalizeAu(pts))}
                fill="none"
                stroke="#0891b2"
                strokeWidth={0.6}
                opacity={0.6}
              />
            ),
          )}
        {/* event lanes */}
        {lane(events.clicks, LANE_TOP, '#f59e0b')}
        {lane(events.chatbot, LANE_TOP + 12, '#0ea5e9')}
        {lane(events.dialogue, LANE_TOP + 12, '#0ea5e9')}
        {lane(events.interventions, LANE_TOP + 24, '#8b5cf6')}
        {lane(events.efDetections, LANE_TOP + 36, '#dc2626')}
        {lane(events.probes, LANE_TOP + 48, '#16a34a')}
        {/* playhead */}
        <line x1={x(offsetMs)} x2={x(offsetMs)} y1={0} y2={H} stroke="#0f172a" strokeWidth={1} />
      </svg>
      <div className="flex gap-4 text-[10px] text-slate-400">
        <span className="flex items-center gap-1">
          <Circle size={10} className="fill-current text-orange-500" /> clicks
        </span>
        <span className="flex items-center gap-1">
          <Circle size={10} className="fill-current text-blue-500" /> chat
        </span>
        <span className="flex items-center gap-1">
          <Circle size={10} className="fill-current text-purple-500" /> interventions
        </span>
        <span className="flex items-center gap-1">
          <Circle size={10} className="fill-current text-red-500" /> EF
        </span>
        <span className="flex items-center gap-1">
          <Circle size={10} className="fill-current text-green-500" /> probes
        </span>
      </div>
    </div>
  );
}

// AUs can exceed [0,1]; scale by /5 for display.
function normalizeAu(pts: { t: number; v: number }[]): { t: number; v: number }[] {
  return pts.map((p) => ({ t: p.t, v: Math.max(0, Math.min(1, p.v / 5)) }));
}

function Group({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1 font-medium">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );
}

function Chip({
  label,
  color,
  off,
  onClick,
}: {
  label: string;
  color: string;
  off: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-1.5 py-0.5 text-[10px] ${off ? 'opacity-30' : ''}`}
      style={{ backgroundColor: color + '22', color }}
    >
      {label}
    </button>
  );
}
