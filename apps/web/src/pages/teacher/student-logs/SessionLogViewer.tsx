import { useState } from 'react';
import { useSessionLogs } from './hooks/useSessionLogs';
import { useSessionSummary } from './hooks/useSessionSummary';
import { SummaryTab } from './tabs/SummaryTab';
import { TimelineTab } from './tabs/TimelineTab';
import { ConversationTab } from './tabs/ConversationTab';
import { InterventionTab } from './tabs/InterventionTab';
import { RecordingLogViewer } from '../../../components/teacher/biometrics/RecordingLogViewer';

const TABS = ['Summary', 'Timeline', 'Conversations', 'Interventions', 'Biometrics'] as const;
type Tab = (typeof TABS)[number];

interface Props {
  sessionId: string;
  studentId: string;
  courseId?: string;
}

export function SessionLogViewer({ sessionId, studentId, courseId }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('Summary');
  const { logs, isLoading: logsLoading } = useSessionLogs(sessionId);
  const { summary, isLoading: summaryLoading } = useSessionSummary(sessionId);

  const isLoading = logsLoading || summaryLoading;

  function handleExport() {
    const token = localStorage.getItem('token');
    const url = `/api/activity-log/teacher/sessions/${sessionId}/export`;
    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => res.blob())
      .then((blob) => {
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href;
        a.download = `session-${sessionId}.json`;
        a.click();
        URL.revokeObjectURL(href);
      });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div>
          <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">Session log</h2>
          <p className="text-xs text-gray-400 font-mono mt-0.5">{sessionId}</p>
        </div>
        <button
          onClick={handleExport}
          className="text-xs px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
        >
          Export JSON
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 px-6">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`text-xs py-2.5 mr-5 border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 font-medium'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="text-xs text-gray-400 text-center py-12">Loading…</div>
        ) : (
          <>
            {activeTab === 'Summary' && <SummaryTab summary={summary} />}
            {activeTab === 'Timeline' && <TimelineTab logs={logs} />}
            {activeTab === 'Conversations' && <ConversationTab logs={logs} />}
            {activeTab === 'Interventions' && <InterventionTab logs={logs} />}
            {activeTab === 'Biometrics' && courseId && (
              <div className="space-y-6">
                <RecordingLogViewer studentId={studentId} courseId={courseId} />
                {/* Future: PupilSizeLogViewer, WebgazerLogViewer, PyfeatLogViewer */}
              </div>
            )}
            {activeTab === 'Biometrics' && !courseId && (
              <div className="text-sm text-gray-400 text-center py-8">
                No course associated with this session.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
