import { useState, useRef } from 'react';

// ─── Types ──────────────────────────────────────────────

interface TimelineData {
  recordingSegments: any[];
  interventions: any[];
  visibilityLogs: any[];
  keyActivityLogs: any[];
  attempts: any[];
  sessionSummary: any;
  syncAnchor: any;
}

interface EventInfo {
  type: string;
  label: string;
  timeMs: number;
  data?: any;
}

// ─── Constants ──────────────────────────────────────────

const TRACK_HEIGHT = 40;
const TRACK_GAP = 8;
const LABEL_WIDTH = 120;
const PIXELS_PER_SECOND = 10;

const INTERVENTION_COLORS: Record<string, string> = {
  PRACTICE_TESTING: '#3B82F6',
  DISTRIBUTED_PRACTICE: '#8B5CF6',
  STEPWISE_LEARNING: '#F97316',
  INTERROGATIVE_ELABORATION: '#14B8A6',
};

const ACTIVITY_COLORS: Record<string, string> = {
  MODULE_OPENED: '#6366F1',
  ASSESSMENT_SUBMITTED: '#10B981',
  DIALOGUE_SESSION_STARTED: '#F59E0B',
  STUDY_MATERIAL_UPLOADED: '#8B5CF6',
  INTERVENTION_TRIGGERED: '#EF4444',
};

// ─── Helpers ────────────────────────────────────────────

function toMs(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'string') {
    const n = Number(val);
    if (!isNaN(n) && n > 1e12) return n; // Unix ms
    return new Date(val).getTime();
  }
  return 0;
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function scoreColor(score: number): string {
  if (score >= 0.7) return '#22C55E';
  if (score >= 0.4) return '#EAB308';
  return '#EF4444';
}

// ─── Component ──────────────────────────────────────────

export function SessionTimeline({ data }: { data: TimelineData }) {
  const [zoom, setZoom] = useState(1);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; events: EventInfo[] } | null>(
    null,
  );
  const [jumpInput, setJumpInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const sessionStartMs = data.syncAnchor
    ? toMs(data.syncAnchor.wallClockMs)
    : data.recordingSegments[0]
      ? toMs(data.recordingSegments[0].startedAt)
      : 0;

  // Compute session duration
  const allTimes: number[] = [];
  data.recordingSegments.forEach((s) => {
    allTimes.push(toMs(s.startedAt));
    if (s.stoppedAt) allTimes.push(toMs(s.stoppedAt));
  });
  data.interventions.forEach((i) => allTimes.push(toMs(i.createdAt)));
  data.keyActivityLogs.forEach((a) => allTimes.push(toMs(a.occurredAt)));
  data.attempts.forEach((a) => allTimes.push(toMs(a.submittedAt)));
  data.visibilityLogs.forEach((v) => allTimes.push(toMs(v.timestamp)));

  const maxMs = allTimes.length > 0 ? Math.max(...allTimes) : sessionStartMs + 60000;
  const sessionDurationMs = maxMs - sessionStartMs;
  const sessionDurationSec = sessionDurationMs / 1000;

  const svgWidth = Math.max(800, sessionDurationSec * PIXELS_PER_SECOND * zoom);
  const trackCount = 5;
  const svgHeight = trackCount * (TRACK_HEIGHT + TRACK_GAP) + 40; // 40 for time axis

  const toX = (ms: number) => ((ms - sessionStartMs) / 1000) * PIXELS_PER_SECOND * zoom;

  // ─── Time axis clicks ───────────────────────────────
  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
    const clickedMs = sessionStartMs + (x / (PIXELS_PER_SECOND * zoom)) * 1000;
    const tolerance = 5000; // ±5s

    const events: EventInfo[] = [];
    data.recordingSegments.forEach((s) => {
      const startMs = toMs(s.startedAt);
      if (Math.abs(startMs - clickedMs) < tolerance) {
        events.push({ type: 'recording', label: 'Recording Start', timeMs: startMs, data: s });
      }
    });
    data.interventions.forEach((i) => {
      const t = toMs(i.createdAt);
      if (Math.abs(t - clickedMs) < tolerance) {
        events.push({ type: 'intervention', label: i.type, timeMs: t, data: i });
      }
    });
    data.keyActivityLogs.forEach((a) => {
      const t = toMs(a.occurredAt);
      if (Math.abs(t - clickedMs) < tolerance) {
        events.push({ type: 'activity', label: a.action, timeMs: t, data: a });
      }
    });
    data.attempts.forEach((a) => {
      const t = toMs(a.submittedAt);
      if (Math.abs(t - clickedMs) < tolerance) {
        events.push({
          type: 'score',
          label: `Score: ${((a.score ?? 0) * 100).toFixed(0)}%`,
          timeMs: t,
          data: a,
        });
      }
    });

    if (events.length > 0) {
      setTooltip({ x: e.clientX, y: e.clientY, events });
    } else {
      setTooltip(null);
    }
  };

  // ─── Jump-to ────────────────────────────────────────
  const handleJump = () => {
    const parts = jumpInput.split(':');
    if (parts.length !== 2) return;
    const min = parseInt(parts[0] ?? '0', 10);
    const sec = parseInt(parts[1] ?? '0', 10);
    if (isNaN(min) || isNaN(sec)) return;
    const targetSec = min * 60 + sec;
    const xPos = targetSec * PIXELS_PER_SECOND * zoom;
    if (scrollRef.current) scrollRef.current.scrollLeft = xPos - 200;
  };

  // ─── Tick marks ─────────────────────────────────────
  const tickInterval = 30; // seconds
  const ticks: number[] = [];
  for (let s = 0; s <= sessionDurationSec; s += tickInterval) {
    ticks.push(s);
  }

  const trackY = (index: number) => 30 + index * (TRACK_HEIGHT + TRACK_GAP);

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Zoom:</span>
          {[1, 2, 5, 10].map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={`px-3 py-1 rounded text-sm ${zoom === z ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {z}x
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Jump to:</span>
          <input
            type="text"
            value={jumpInput}
            onChange={(e) => setJumpInput(e.target.value)}
            placeholder="mm:ss"
            className="w-20 px-2 py-1 text-sm border border-gray-300 rounded"
            onKeyDown={(e) => e.key === 'Enter' && handleJump()}
          />
          <button
            onClick={handleJump}
            className="px-2 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200"
          >
            Go
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex">
        {/* Labels */}
        <div className="flex-shrink-0" style={{ width: LABEL_WIDTH }}>
          {['Video', 'Interventions', 'Tab Visibility', 'Activity', 'Scores'].map((label, i) => (
            <div
              key={label}
              className="text-sm text-gray-600 font-medium flex items-center"
              style={{ height: TRACK_HEIGHT, marginTop: i === 0 ? 30 : TRACK_GAP }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* SVG canvas */}
        <div ref={scrollRef} className="overflow-x-auto flex-1">
          <svg
            width={svgWidth}
            height={svgHeight}
            onClick={handleSvgClick}
            className="cursor-crosshair"
          >
            {/* Time axis */}
            <line x1={0} y1={25} x2={svgWidth} y2={25} stroke="#E5E7EB" strokeWidth={1} />
            {ticks.map((s) => (
              <g key={s}>
                <line
                  x1={s * PIXELS_PER_SECOND * zoom}
                  y1={20}
                  x2={s * PIXELS_PER_SECOND * zoom}
                  y2={25}
                  stroke="#9CA3AF"
                  strokeWidth={1}
                />
                <text x={s * PIXELS_PER_SECOND * zoom + 2} y={16} fill="#6B7280" fontSize={10}>
                  {formatTime(s * 1000)}
                </text>
              </g>
            ))}

            {/* Track 1: Video */}
            {data.recordingSegments.map((seg, i) => {
              const startX = toX(toMs(seg.startedAt));
              const endMs = seg.stoppedAt
                ? toMs(seg.stoppedAt)
                : toMs(seg.startedAt) + (seg.durationMs || 0);
              const endX = toX(endMs);
              const width = Math.max(2, endX - startX);
              return (
                <rect
                  key={i}
                  x={startX}
                  y={trackY(0)}
                  width={width}
                  height={TRACK_HEIGHT}
                  rx={3}
                  fill="#22C55E"
                  opacity={0.7}
                />
              );
            })}
            {/* Gaps between segments */}
            {data.recordingSegments.slice(1).map((seg, i) => {
              const prev = data.recordingSegments[i];
              const prevEnd = prev.stoppedAt
                ? toMs(prev.stoppedAt)
                : toMs(prev.startedAt) + (prev.durationMs || 0);
              const currStart = toMs(seg.startedAt);
              if (currStart <= prevEnd) return null;
              return (
                <rect
                  key={`gap-${i}`}
                  x={toX(prevEnd)}
                  y={trackY(0)}
                  width={Math.max(2, toX(currStart) - toX(prevEnd))}
                  height={TRACK_HEIGHT}
                  rx={3}
                  fill="#EF4444"
                  opacity={0.4}
                />
              );
            })}

            {/* Track 2: Interventions */}
            {data.interventions.map((intv, i) => {
              const x = toX(toMs(intv.createdAt));
              const color = INTERVENTION_COLORS[intv.type] || '#6B7280';
              return (
                <polygon
                  key={i}
                  points={`${x},${trackY(1)} ${x + 8},${trackY(1) + TRACK_HEIGHT / 2} ${x},${trackY(1) + TRACK_HEIGHT} ${x - 8},${trackY(1) + TRACK_HEIGHT / 2}`}
                  fill={color}
                  opacity={0.8}
                />
              );
            })}

            {/* Track 3: Tab Visibility */}
            {data.visibilityLogs
              .filter((v: any) => v.visibleState === 'hidden')
              .map((v: any, i: number) => {
                const startX = toX(toMs(v.timestamp));
                const durationMs = v.hiddenDurationMs || 5000;
                const width = Math.max(2, (durationMs / 1000) * PIXELS_PER_SECOND * zoom);
                return (
                  <rect
                    key={i}
                    x={startX}
                    y={trackY(2)}
                    width={width}
                    height={TRACK_HEIGHT}
                    fill="#E5E7EB"
                    opacity={0.8}
                  />
                );
              })}

            {/* Track 4: Activity Events */}
            {data.keyActivityLogs.map((log: any, i: number) => {
              const x = toX(toMs(log.occurredAt));
              const color = ACTIVITY_COLORS[log.action] || '#6B7280';
              return (
                <g key={i}>
                  <line
                    x1={x}
                    y1={trackY(3)}
                    x2={x}
                    y2={trackY(3) + TRACK_HEIGHT}
                    stroke={color}
                    strokeWidth={2}
                  />
                  <circle cx={x} cy={trackY(3) + 6} r={4} fill={color} />
                </g>
              );
            })}

            {/* Track 5: Scores */}
            {data.attempts.map((a: any, i: number) => {
              const x = toX(toMs(a.submittedAt));
              const score = a.score ?? 0;
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={trackY(4) + TRACK_HEIGHT / 2}
                  r={8}
                  fill={scoreColor(score)}
                  opacity={0.8}
                />
              );
            })}
          </svg>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 max-w-xs"
          style={{ left: tooltip.x + 10, top: tooltip.y + 10 }}
          onClick={() => setTooltip(null)}
        >
          <p className="text-xs text-gray-400 mb-2">Click to dismiss</p>
          {tooltip.events.map((ev, i) => (
            <div key={i} className="text-sm mb-1">
              <span className="font-medium text-gray-700">{ev.label}</span>
              <span className="text-gray-400 ml-2">{formatTime(ev.timeMs - sessionStartMs)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
