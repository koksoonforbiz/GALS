import { useState, useEffect } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';

interface AnalyticsSummaryCardProps {
  sessionId: string;
}

const EMOTION_EMOJI: Record<string, string> = {
  neutral: '😐',
  confused: '😕',
  frustrated: '😤',
  engaged: '🙂',
  bored: '😴',
};

const RISK_COLORS: Record<string, string> = {
  none: 'bg-gray-100 text-gray-600',
  low: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-red-100 text-red-700',
};

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-full bg-gray-200 rounded-full h-2.5">
      <div
        className={`h-2.5 rounded-full ${color}`}
        style={{ width: `${Math.min(100, value * 100)}%` }}
      />
    </div>
  );
}

function getBarColor(value: number): string {
  if (value >= 0.7) return 'bg-green-500';
  if (value >= 0.4) return 'bg-yellow-500';
  return 'bg-red-500';
}

export function AnalyticsSummaryCard({ sessionId }: AnalyticsSummaryCardProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);

  const fetchSummary = () => {
    setLoading(true);
    api
      .get(`/analytics/${sessionId}/summary`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchSummary();
  }, [sessionId]);

  const handleRecompute = async () => {
    setRecomputing(true);
    try {
      await api.post('/analytics/compute', { sessionId, jobType: 'all' });
      fetchSummary();
    } catch {
      // ignore
    } finally {
      setRecomputing(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-500" size={24} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <p className="text-gray-500 text-sm">No analytics data available.</p>
        <button
          onClick={handleRecompute}
          className="mt-2 flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
        >
          <RefreshCw size={14} />
          Compute Analytics
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800">Analytics Summary</h3>
        <button
          onClick={handleRecompute}
          disabled={recomputing}
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
        >
          {recomputing ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
          Recompute
        </button>
      </div>

      <div className="space-y-4">
        {/* Engagement */}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">Engagement</span>
            <span className="font-medium">{(data.engagement.latestScore * 100).toFixed(0)}%</span>
          </div>
          <ProgressBar
            value={data.engagement.latestScore}
            color={getBarColor(data.engagement.latestScore)}
          />
        </div>

        {/* Cognitive Load */}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">Cognitive Load</span>
            <span className="font-medium">
              {(data.cognitiveLoad.latestIndex * 100).toFixed(0)}%
            </span>
          </div>
          <ProgressBar
            value={data.cognitiveLoad.latestIndex}
            color={getBarColor(1 - data.cognitiveLoad.latestIndex)}
          />
        </div>

        {/* Dominant Emotion */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Emotion</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-sm font-medium">
            {EMOTION_EMOJI[data.emotion.dominantEmotion] ?? '😐'} {data.emotion.dominantEmotion}
          </span>
        </div>

        {/* At-Risk Level */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Risk Level</span>
          <span
            className={`px-2 py-0.5 rounded-full text-sm font-medium ${RISK_COLORS[data.atRisk.currentLevel] ?? RISK_COLORS.none}`}
          >
            {data.atRisk.currentLevel}
          </span>
        </div>
      </div>
    </div>
  );
}
