import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronRight, Loader2, MessageSquare, Camera } from 'lucide-react';
import { SessionTextMiningTab } from '../../features/text-mining/pages/SessionTextMiningTab';
import { SessionEmotionTab } from '../../features/openface3/pages/SessionEmotionTab';
import { api } from '../../lib/api';
import { StatCard } from '../../components/dashboard/StatCard';
import { SessionTimeline } from '../../components/dashboard/SessionTimeline';

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function toMs(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'string') {
    const n = Number(val);
    if (!isNaN(n) && n > 1e12) return n;
    return new Date(val).getTime();
  }
  return 0;
}

export function SessionTimelinePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    api
      .get(`/activity-log/teacher/sessions/${sessionId}/timeline-data`)
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => setError(err.message || 'Failed to load timeline data'))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  // Compute summary stats
  const summary = data.sessionSummary;
  const durationSecs = summary?.totalActiveTimeSecs ?? 0;

  const totalRecordingMs = data.recordingSegments.reduce((acc: number, s: any) => {
    const start = toMs(s.startedAt);
    const end = s.stoppedAt ? toMs(s.stoppedAt) : start + (s.durationMs || 0);
    return acc + (end - start);
  }, 0);

  const sessionStartMs = data.syncAnchor
    ? toMs(data.syncAnchor.wallClockMs)
    : data.recordingSegments[0]
      ? toMs(data.recordingSegments[0].startedAt)
      : 0;

  const allTimes = [
    ...data.recordingSegments.map((s: any) =>
      s.stoppedAt ? toMs(s.stoppedAt) : toMs(s.startedAt),
    ),
    ...data.keyActivityLogs.map((a: any) => toMs(a.occurredAt)),
  ];
  const sessionEndMs = allTimes.length > 0 ? Math.max(...allTimes) : sessionStartMs;
  const totalSessionMs = sessionEndMs - sessionStartMs;
  const recordingCoverage = totalSessionMs > 0 ? (totalRecordingMs / totalSessionMs) * 100 : 0;

  const totalVisibleMs = data.visibilityLogs.reduce((acc: number, v: any) => {
    if (v.visibleState === 'hidden' && v.hiddenDurationMs) {
      return acc - v.hiddenDurationMs;
    }
    return acc;
  }, totalSessionMs);
  const tabVisiblePct =
    totalSessionMs > 0 ? Math.max(0, (totalVisibleMs / totalSessionMs) * 100) : 100;

  const scores = data.attempts.filter((a: any) => a.score != null).map((a: any) => a.score);
  const avgScore =
    scores.length > 0 ? scores.reduce((a: number, b: number) => a + b, 0) / scores.length : 0;

  return (
    <div className="p-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link to="/teacher" className="hover:text-gray-700">
          Dashboard
        </Link>
        <ChevronRight size={14} />
        <Link to="/teacher/students" className="hover:text-gray-700">
          Sessions
        </Link>
        <ChevronRight size={14} />
        <span className="text-gray-800 font-medium">Timeline</span>
      </nav>

      <h1 className="text-2xl font-bold text-gray-800 mb-6">Session Timeline</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <StatCard label="Session Duration" value={formatDuration(durationSecs)} />
        <StatCard label="Recording Coverage" value={`${recordingCoverage.toFixed(1)}%`} />
        <StatCard label="Tab Visible" value={`${tabVisiblePct.toFixed(1)}%`} />
        <StatCard label="Interventions" value={data.interventions.length} />
        <StatCard label="Assessments" value={data.attempts.length} />
        <StatCard
          label="Avg Score"
          value={scores.length > 0 ? `${(avgScore * 100).toFixed(0)}%` : 'N/A'}
        />
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
        <SessionTimeline data={data} />
      </div>

      {/* Emotion & Affective States */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
        <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-100">
          <Camera size={16} className="text-purple-500" aria-hidden="true" />
          <h3 className="font-semibold text-gray-700">Emotion & Affective States</h3>
        </div>
        {sessionId && (
          <SessionEmotionTab
            sessionId={sessionId}
            sessionStartMs={sessionStartMs}
            sessionEndMs={sessionEndMs > sessionStartMs ? sessionEndMs : sessionStartMs + 60000}
          />
        )}
      </div>

      {/* Text-mining tab */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-100">
          <MessageSquare size={16} className="text-blue-500" aria-hidden="true" />
          <h3 className="font-semibold text-gray-700">Text-mining</h3>
        </div>
        {sessionId && <SessionTextMiningTab sessionId={sessionId} />}
      </div>
    </div>
  );
}
