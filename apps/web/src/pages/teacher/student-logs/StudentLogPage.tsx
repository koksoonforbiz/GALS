import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { SessionList } from './SessionList';
import { SessionLogViewer } from './SessionLogViewer';
import { useStudentSessions } from './hooks/useStudentSessions';

export function StudentLogPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    searchParams.get('session'),
  );

  const { sessions, isLoading, error } = useStudentSessions(studentId!);

  function selectSession(id: string) {
    setSelectedSessionId(id);
    setSearchParams({ session: id });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        Loading sessions…
      </div>
    );
  }

  if (error) {
    return <div className="p-6 text-red-500 text-sm">Failed to load sessions: {error}</div>;
  }

  return (
    <div className="flex h-full min-h-screen divide-x divide-gray-200 dark:divide-gray-700">
      {/* Left panel — session list */}
      <div className="w-72 shrink-0 overflow-y-auto border-r border-gray-200 dark:border-gray-700">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">Sessions</h2>
          <p className="text-xs text-gray-500 mt-0.5">{sessions.length} total</p>
        </div>
        <SessionList sessions={sessions} selectedId={selectedSessionId} onSelect={selectSession} />
      </div>

      {/* Right panel — log viewer */}
      <div className="flex-1 overflow-y-auto">
        {selectedSessionId ? (
          <SessionLogViewer sessionId={selectedSessionId} studentId={studentId!} />
        ) : (
          <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
            Select a session to view details
          </div>
        )}
      </div>
    </div>
  );
}
