import { useState, useEffect } from 'react';
import { api } from '../../../lib/api';
import { Eye, Loader2 } from 'lucide-react';

interface PupilSizeLog {
  id: string;
  studentId: string;
  sessionId: string;
  timestamp: string;
  pupilDiameter: number;
}

export function PupilSizeLogViewer({
  studentId,
  courseId,
}: {
  studentId: string;
  courseId: string;
}) {
  const [logs, setLogs] = useState<PupilSizeLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api
      .get<PupilSizeLog[]>(`/pupil-size/logs/${studentId}/${courseId}`)
      .then(setLogs)
      .catch((err) => {
        setLogs([]);
        setError(err?.message || 'Failed to load pupil size data');
      })
      .finally(() => setIsLoading(false));
  }, [studentId, courseId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 size={18} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-6 text-sm text-red-400">
        Error loading pupil size data: {error}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-gray-500">
        <Eye size={20} className="mx-auto mb-2 text-gray-300" />
        No pupil size data for this student.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
        <Eye size={16} className="text-gray-600" />
        Pupil Size Readings ({logs.length})
      </h3>

      {/* Simple chart placeholder — readings over time */}
      <div className="bg-gray-50 rounded-lg p-3 h-32 flex items-end gap-px overflow-hidden">
        {logs.slice(-100).map((log) => (
          <div
            key={log.id}
            className="bg-blue-400 rounded-t min-w-[2px] flex-1"
            style={{ height: `${Math.min((log.pupilDiameter / 30) * 100, 100)}%` }}
            title={`${log.pupilDiameter}px at ${new Date(log.timestamp).toLocaleTimeString()}`}
          />
        ))}
      </div>

      <div className="overflow-x-auto max-h-48 overflow-y-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500 sticky top-0 bg-white">
              <th className="py-1.5 pr-3 font-medium">Timestamp</th>
              <th className="py-1.5 pr-3 font-medium">Diameter (px)</th>
              <th className="py-1.5 font-medium">Session</th>
            </tr>
          </thead>
          <tbody>
            {logs.slice(0, 200).map((log) => (
              <tr key={log.id} className="border-b border-gray-50">
                <td className="py-1 pr-3">{new Date(log.timestamp).toLocaleString()}</td>
                <td className="py-1 pr-3 font-mono">{log.pupilDiameter.toFixed(2)}</td>
                <td className="py-1 font-mono truncate max-w-[100px]">
                  {log.sessionId.slice(0, 8)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
