import { useState, useEffect } from 'react';
import { Camera, Download, Loader2, Inbox } from 'lucide-react';
import { api } from '../../../lib/api';

const EMOTION_COLORS: Record<string, string> = {
  happiness: '#22C55E',
  sadness: '#3B82F6',
  surprise: '#F59E0B',
  fear: '#8B5CF6',
  anger: '#EF4444',
  disgust: '#84CC16',
  contempt: '#F97316',
  neutral: '#9CA3AF',
};

const STATE_COLORS: Record<string, string> = {
  engagement: '#22C55E',
  boredom: '#9CA3AF',
  confusion: '#F59E0B',
  frustration: '#EF4444',
};

interface EmotionTimelineLaneProps {
  sessionId: string;
  sessionStartMs: number;
  sessionEndMs: number;
  pixelsPerSecond: number;
  zoom: number;
}

interface EmotionFrame {
  frameWallMs: string;
  faceDetected: boolean;
  pHappiness: number | null;
  pSadness: number | null;
  pSurprise: number | null;
  pFear: number | null;
  pAnger: number | null;
  pDisgust: number | null;
  pContempt: number | null;
  pNeutral: number | null;
  dominantEmotion: string | null;
}

interface AffectiveWindow {
  windowStartWallMs: string;
  windowEndWallMs: string;
  engagement: number;
  boredom: number;
  confusion: number;
  frustration: number;
  dominantState: string;
}

export function EmotionTimelineLane({
  sessionId,
  sessionStartMs,
  sessionEndMs,
  pixelsPerSecond,
  zoom,
}: EmotionTimelineLaneProps) {
  const [frames, setFrames] = useState<EmotionFrame[]>([]);
  const [windows, setWindows] = useState<AffectiveWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleEmotions, setVisibleEmotions] = useState<Set<string>>(
    new Set([
      'happiness',
      'sadness',
      'surprise',
      'fear',
      'anger',
      'disgust',
      'contempt',
      'neutral',
    ]),
  );

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<EmotionFrame[]>(`/openface3/frames?sessionId=${sessionId}&limit=2000`),
      api.get<AffectiveWindow[]>(`/affective-mapping/windows?sessionId=${sessionId}&limit=1000`),
    ])
      .then(([f, w]) => {
        setFrames(f);
        setWindows(w);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="animate-spin text-blue-500" aria-hidden="true" />
      </div>
    );
  }

  if (frames.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-gray-400">
        <Inbox size={20} aria-hidden="true" />
        <p className="text-xs mt-1">No emotion data for this session.</p>
      </div>
    );
  }

  const durationSec = (sessionEndMs - sessionStartMs) / 1000;
  const svgWidth = Math.max(600, durationSec * pixelsPerSecond * zoom);
  const toX = (ms: number) => ((ms - sessionStartMs) / 1000) * pixelsPerSecond * zoom;
  const emotions = [
    'happiness',
    'sadness',
    'surprise',
    'fear',
    'anger',
    'disgust',
    'contempt',
    'neutral',
  ];
  const LANE_HEIGHT = 120;
  const STATE_HEIGHT = 100;

  const toggleEmotion = (e: string) => {
    const next = new Set(visibleEmotions);
    if (next.has(e)) next.delete(e);
    else next.add(e);
    setVisibleEmotions(next);
  };

  const handleExportFrames = () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch(`/api/openface3/frames?sessionId=${sessionId}&limit=200000`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        const header =
          'frameWallMs,faceDetected,happiness,sadness,surprise,fear,anger,disgust,contempt,neutral,dominant';
        const rows = (data as EmotionFrame[]).map(
          (f) =>
            `${f.frameWallMs},${f.faceDetected},${f.pHappiness ?? ''},${f.pSadness ?? ''},${f.pSurprise ?? ''},${f.pFear ?? ''},${f.pAnger ?? ''},${f.pDisgust ?? ''},${f.pContempt ?? ''},${f.pNeutral ?? ''},${f.dominantEmotion ?? ''}`,
        );
        const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `emotion-frames-${sessionId}.csv`;
        a.click();
      })
      .catch(() => {});
  };

  return (
    <div>
      {/* Universal Emotions Lane */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1">
            <Camera size={14} aria-hidden="true" />
            Universal Emotions (OpenFace 3)
          </h4>
          <button
            onClick={handleExportFrames}
            className="text-gray-400 hover:text-gray-600"
            title="Export frames CSV"
          >
            <Download size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-wrap gap-1 mb-2">
          {emotions.map((e) => (
            <button
              key={e}
              onClick={() => toggleEmotion(e)}
              className={`text-xs px-2 py-0.5 rounded-full border ${visibleEmotions.has(e) ? 'border-gray-300 bg-white' : 'border-transparent bg-gray-100 text-gray-400'}`}
            >
              <span
                className="inline-block w-2 h-2 rounded-full mr-1"
                style={{ backgroundColor: EMOTION_COLORS[e] }}
              />
              {e}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <svg width={svgWidth} height={LANE_HEIGHT} className="bg-gray-50 rounded">
            {emotions
              .filter((e) => visibleEmotions.has(e))
              .map((emotion) => {
                const key =
                  `p${emotion.charAt(0).toUpperCase() + emotion.slice(1)}` as keyof EmotionFrame;
                const points = frames
                  .filter((f) => f.faceDetected && f[key] != null)
                  .map((f) => {
                    const x = toX(Number(f.frameWallMs));
                    const y = LANE_HEIGHT - Number(f[key]) * LANE_HEIGHT;
                    return `${x},${y}`;
                  })
                  .join(' ');
                return points ? (
                  <polyline
                    key={emotion}
                    points={points}
                    fill="none"
                    stroke={EMOTION_COLORS[emotion]}
                    strokeWidth={1.5}
                    opacity={0.8}
                  />
                ) : null;
              })}
          </svg>
        </div>
      </div>

      {/* Affective States Lane */}
      {windows.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Affective States</h4>
          <div className="flex gap-3 mb-2">
            {Object.entries(STATE_COLORS).map(([state, color]) => (
              <span key={state} className="text-xs flex items-center gap-1">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {state}
              </span>
            ))}
          </div>
          <div className="overflow-x-auto">
            <svg width={svgWidth} height={STATE_HEIGHT} className="bg-gray-50 rounded">
              {['engagement', 'boredom', 'confusion', 'frustration'].map((state, si) => {
                const points = windows
                  .map((w) => {
                    const x = toX(Number(w.windowStartWallMs));
                    const val = w[state as keyof AffectiveWindow] as number;
                    const y = STATE_HEIGHT - val * (STATE_HEIGHT - 10) - 5;
                    return `${x},${y}`;
                  })
                  .join(' ');
                return points ? (
                  <polyline
                    key={state}
                    points={points}
                    fill="none"
                    stroke={STATE_COLORS[state]}
                    strokeWidth={2}
                    opacity={0.8 - si * 0.05}
                  />
                ) : null;
              })}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
