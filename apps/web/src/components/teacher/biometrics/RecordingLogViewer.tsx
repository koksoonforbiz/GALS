import { useState, useEffect } from 'react';
import { api } from '../../../lib/api';
import { Download, Loader2, Video, CheckCircle, XCircle, Clock, Upload } from 'lucide-react';

interface RecordingSegment {
  id: string;
  studentId: string;
  sessionId: string;
  courseId: string;
  filename: string;
  startWallTime: string;
  endWallTime: string | null;
  durationMs: number | null;
  fileSizeBytes: number | null;
  segmentIndex: number;
  uploadStatus: 'PENDING' | 'UPLOADING' | 'COMPLETED' | 'FAILED';
  pyfeatJobId: string | null;
  createdAt: string;
}

interface RecordingLogViewerProps {
  studentId: string;
  courseId: string;
}

const STATUS_CONFIG = {
  PENDING: { icon: Clock, color: 'text-gray-500', bg: 'bg-gray-100' },
  UPLOADING: { icon: Upload, color: 'text-orange-600', bg: 'bg-orange-100' },
  COMPLETED: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-100' },
  FAILED: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-100' },
};

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  const secs = Math.round(ms / 1000);
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return mins > 0 ? `${mins}m ${remainSecs}s` : `${remainSecs}s`;
}

export function RecordingLogViewer({ studentId, courseId }: RecordingLogViewerProps) {
  const [segments, setSegments] = useState<RecordingSegment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<RecordingSegment[]>(`/recording/segments/${studentId}/${courseId}`)
      .then(setSegments)
      .catch(() => setSegments([]))
      .finally(() => setIsLoading(false));
  }, [studentId, courseId]);

  const handleDownload = async (segmentId: string) => {
    setDownloadingId(segmentId);
    try {
      const url = await api.get<string>(`/recording/segments/${segmentId}/download`);
      window.open(url, '_blank');
    } catch {
      // error
    } finally {
      setDownloadingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-500">
        <Video size={24} className="mx-auto mb-2 text-gray-300" />
        No recording segments found for this student.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
        <Video size={16} className="text-gray-600" />
        Recording Segments ({segments.length})
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="py-2 pr-3 font-medium">File</th>
              <th className="py-2 pr-3 font-medium">Session</th>
              <th className="py-2 pr-3 font-medium">Date</th>
              <th className="py-2 pr-3 font-medium">Duration</th>
              <th className="py-2 pr-3 font-medium">Size</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((seg) => {
              const StatusIcon = STATUS_CONFIG[seg.uploadStatus].icon;
              return (
                <tr key={seg.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 pr-3 font-mono truncate max-w-[200px]" title={seg.filename}>
                    {seg.filename}
                  </td>
                  <td className="py-2 pr-3 font-mono truncate max-w-[120px]" title={seg.sessionId}>
                    {seg.sessionId.slice(0, 8)}...
                  </td>
                  <td className="py-2 pr-3">
                    {new Date(seg.startWallTime).toLocaleDateString()}{' '}
                    {new Date(seg.startWallTime).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="py-2 pr-3">{formatDuration(seg.durationMs)}</td>
                  <td className="py-2 pr-3">{formatBytes(seg.fileSizeBytes)}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_CONFIG[seg.uploadStatus].bg} ${STATUS_CONFIG[seg.uploadStatus].color}`}
                    >
                      <StatusIcon size={10} />
                      {seg.uploadStatus}
                    </span>
                  </td>
                  <td className="py-2">
                    {seg.uploadStatus === 'COMPLETED' && (
                      <button
                        onClick={() => handleDownload(seg.id)}
                        disabled={downloadingId === seg.id}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50"
                      >
                        <Download size={10} />
                        Download
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
