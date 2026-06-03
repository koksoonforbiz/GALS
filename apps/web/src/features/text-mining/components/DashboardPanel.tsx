import { useState } from 'react';
import { RefreshCw, Download, Loader2, Pause, Info, MessageSquare, Inbox } from 'lucide-react';
import { ConstructRow } from './ConstructRow';
import { TraceDrawer } from './TraceDrawer';
import { TextMiningSessionScope } from '../hooks/useDashboard';

interface DashboardPanelProps {
  sessionId: string;
  scope: TextMiningSessionScope;
  data: Record<string, unknown>;
  onRefresh: () => void;
  loading: boolean;
}

function getDetectionsCsvPath(scope: TextMiningSessionScope, sessionId: string) {
  return scope === 'activity'
    ? `/api/text-mining/activity-sessions/${sessionId}/detections.csv`
    : `/api/text-mining/sessions/${sessionId}/detections.csv`;
}

export function DashboardPanel({
  sessionId,
  scope,
  data,
  onRefresh,
  loading,
}: DashboardPanelProps) {
  const [drawerConstruct, setDrawerConstruct] = useState<string | null>(null);
  const constructs = (data.constructs ?? {}) as Record<string, Record<string, unknown>>;
  const totalMessages = (data.totalUserMessages as number) ?? 0;
  const isPaused = false; // Would come from teacher settings

  const handleExportCsv = () => {
    const token = localStorage.getItem('token');
    const exportPath = getDetectionsCsvPath(scope, sessionId);
    const a = document.createElement('a');
    a.href = exportPath;
    a.download = `text-mining-${sessionId}.csv`;
    if (token) {
      fetch(exportPath, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => res.blob())
        .then((blob) => {
          a.href = URL.createObjectURL(blob);
          a.click();
        })
        .catch(() => {});
    }
  };

  if (totalMessages === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <Inbox size={32} className="mb-2" aria-hidden="true" />
        <p className="text-sm">
          No dialogue messages yet. Text-mining will begin when the student starts chatting.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <MessageSquare size={20} aria-hidden="true" />
            Text-mining detections
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">From dialogue. Not biometric.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-1.5 text-gray-500 hover:text-gray-700 disabled:opacity-50"
            title="Refresh"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw size={16} aria-hidden="true" />
            )}
          </button>
          <button
            onClick={handleExportCsv}
            className="p-1.5 text-gray-500 hover:text-gray-700"
            title="Export CSV"
          >
            <Download size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {isPaused && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 mb-4 flex items-center gap-2 text-sm text-yellow-800">
          <Pause size={16} aria-hidden="true" />
          Detection paused. Resume in Settings.
        </div>
      )}

      {/* Construct table */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-3 py-2 font-medium text-gray-600">Construct</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600 w-20">Channel</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600 w-24">Latest</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600 w-32">Rolling</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600 w-32">Session</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(constructs).map(([key, value]) => (
              <ConstructRow
                key={key}
                constructKey={key}
                data={value}
                onDrillIn={() => setDrawerConstruct(key)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
        <Info size={12} aria-hidden="true" />
        {totalMessages} user message{totalMessages !== 1 ? 's' : ''} analysed
      </p>

      {/* Trace Drawer */}
      {drawerConstruct && (
        <TraceDrawer
          sessionId={sessionId}
          scope={scope}
          constructKey={drawerConstruct}
          displayName={(constructs[drawerConstruct]?.displayName as string) ?? drawerConstruct}
          onClose={() => setDrawerConstruct(null)}
        />
      )}
    </div>
  );
}
