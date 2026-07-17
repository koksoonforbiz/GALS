import { useState, useEffect } from 'react';
import { api } from '../../../lib/api';
import { ScanEye, Loader2 } from 'lucide-react';
import { formatDateTimeSGT } from '../../../lib/formatDateTime';

interface WebgazerLog {
  id: string;
  timestamp: string;
  gazeX: number;
  gazeY: number;
  confidence: number | null;
  pageUrl: string | null;
  sessionId: string;
}

interface CalibrationEvent {
  id: string;
  sessionId: string;
  triggeredBy: string;
  completedAt: string | null;
  accuracy: number | null;
  createdAt: string;
}

export function WebgazerLogViewer({
  studentId,
  courseId,
}: {
  studentId: string;
  courseId: string;
}) {
  const [logs, setLogs] = useState<WebgazerLog[]>([]);
  const [calibrations, setCalibrations] = useState<CalibrationEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    Promise.all([
      api.get<WebgazerLog[]>(`/webgazer/logs/${studentId}/${courseId}`),
      api.get<CalibrationEvent[]>(`/webgazer/calibration/${studentId}/${courseId}`),
    ])
      .then(([l, c]) => {
        setLogs(l);
        setCalibrations(c);
      })
      .catch((err) => {
        setLogs([]);
        setCalibrations([]);
        setError(err?.message || 'Failed to load gaze tracking data');
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
        Error loading gaze tracking data: {error}
      </div>
    );
  }

  if (logs.length === 0 && calibrations.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-gray-500">
        <ScanEye size={20} className="mx-auto mb-2 text-gray-300" />
        No gaze tracking data for this student.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
        <ScanEye size={16} className="text-gray-600" />
        Gaze Data ({logs.length} readings)
      </h3>

      {/* Simple gaze heatmap visualization */}
      <div
        className="relative bg-gray-100 rounded-lg overflow-hidden"
        style={{ width: '100%', aspectRatio: '16/9' }}
      >
        {logs.slice(-500).map((log) => (
          <div
            key={log.id}
            className="absolute w-1 h-1 bg-blue-500 rounded-full opacity-30"
            style={{
              left: `${(log.gazeX / 1920) * 100}%`,
              top: `${(log.gazeY / 1080) * 100}%`,
            }}
          />
        ))}
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
          Gaze Heatmap (1920x1080 normalized)
        </div>
      </div>

      {/* Calibration history */}
      {calibrations.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-700 mb-2">Calibration History</h4>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-1.5 pr-3 font-medium">Date</th>
                <th className="py-1.5 pr-3 font-medium">Triggered By</th>
                <th className="py-1.5 pr-3 font-medium">Accuracy (px)</th>
                <th className="py-1.5 font-medium">Completed</th>
              </tr>
            </thead>
            <tbody>
              {calibrations.map((cal) => (
                <tr key={cal.id} className="border-b border-gray-50">
                  <td className="py-1 pr-3">{formatDateTimeSGT(cal.createdAt)}</td>
                  <td className="py-1 pr-3">
                    <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                      {cal.triggeredBy}
                    </span>
                  </td>
                  <td className="py-1 pr-3 font-mono">
                    {cal.accuracy ? `${cal.accuracy}px` : '-'}
                  </td>
                  <td className="py-1">{cal.completedAt ? 'Yes' : 'No (skipped)'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
