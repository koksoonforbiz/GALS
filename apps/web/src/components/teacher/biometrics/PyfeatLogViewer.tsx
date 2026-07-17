import { useState, useEffect } from 'react';
import { api } from '../../../lib/api';
import { Brain, Download, Loader2, CheckCircle, XCircle, Clock, Cog } from 'lucide-react';
import { formatDateTimeSGT } from '../../../lib/formatDateTime';

interface PyfeatJob {
  id: string;
  sessionId: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface PyfeatAuResult {
  id: string;
  frameIndex: number;
  timestamp: number;
  wallTime: string;
  au01: number | null;
  au04: number | null;
  au06: number | null;
  au07: number | null;
  au12: number | null;
  au17: number | null;
  au25: number | null;
  au26: number | null;
  faceConf: number | null;
}

const JOB_STATUS_CONFIG = {
  PENDING: { icon: Clock, color: 'text-gray-500', bg: 'bg-gray-100' },
  PROCESSING: { icon: Cog, color: 'text-blue-600', bg: 'bg-blue-100' },
  COMPLETED: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-100' },
  FAILED: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-100' },
};

const AU_LABELS: Record<string, string> = {
  au01: 'AU01 Inner Brow Raise',
  au04: 'AU04 Brow Lowerer',
  au06: 'AU06 Cheek Raiser',
  au07: 'AU07 Lid Tightener',
  au12: 'AU12 Lip Corner Puller',
  au17: 'AU17 Chin Raiser',
  au25: 'AU25 Lips Part',
  au26: 'AU26 Jaw Drop',
};

export function PyfeatLogViewer({ studentId, courseId }: { studentId: string; courseId: string }) {
  const [jobs, setJobs] = useState<PyfeatJob[]>([]);
  const [selectedJobResults, setSelectedJobResults] = useState<PyfeatAuResult[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api
      .get<PyfeatJob[]>(`/pyfeat/jobs/${studentId}/${courseId}`)
      .then(setJobs)
      .catch((err) => {
        setJobs([]);
        setError(err?.message || 'Failed to load py-feat data');
      })
      .finally(() => setIsLoading(false));
  }, [studentId, courseId]);

  // Auto-refresh while any job is PENDING or PROCESSING
  useEffect(() => {
    const hasPending = jobs.some((j) => j.status === 'PENDING' || j.status === 'PROCESSING');
    if (!hasPending) return;

    const interval = setInterval(async () => {
      try {
        const updated = await api.get<PyfeatJob[]>(`/pyfeat/jobs/${studentId}/${courseId}`);
        setJobs(updated);
      } catch {
        // ignore
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [jobs, studentId, courseId]);

  const viewResults = async (jobId: string) => {
    setSelectedJobId(jobId);
    setIsLoadingResults(true);
    try {
      const results = await api.get<PyfeatAuResult[]>(`/pyfeat/jobs/${jobId}/results`);
      setSelectedJobResults(results);
    } catch {
      setSelectedJobResults([]);
    } finally {
      setIsLoadingResults(false);
    }
  };

  const handleExport = async (jobId: string) => {
    try {
      const url = await api.get<string>(`/pyfeat/jobs/${jobId}/export`);
      window.open(url, '_blank');
    } catch {
      // error
    }
  };

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
        Error loading py-feat data: {error}
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-gray-500">
        <Brain size={20} className="mx-auto mb-2 text-gray-300" />
        No py-feat jobs for this student.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
        <Brain size={16} className="text-gray-600" />
        py-feat AU Extraction Jobs ({jobs.length})
      </h3>

      {/* Job list */}
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="py-1.5 pr-3 font-medium">Session</th>
            <th className="py-1.5 pr-3 font-medium">Created</th>
            <th className="py-1.5 pr-3 font-medium">Status</th>
            <th className="py-1.5 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const StatusIcon = JOB_STATUS_CONFIG[job.status].icon;
            return (
              <tr key={job.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-1.5 pr-3 font-mono">{job.sessionId.slice(0, 8)}...</td>
                <td className="py-1.5 pr-3">{formatDateTimeSGT(job.createdAt)}</td>
                <td className="py-1.5 pr-3">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${JOB_STATUS_CONFIG[job.status].bg} ${JOB_STATUS_CONFIG[job.status].color}`}
                  >
                    <StatusIcon size={10} />
                    {job.status}
                  </span>
                </td>
                <td className="py-1.5 flex gap-2">
                  {job.status === 'COMPLETED' && (
                    <>
                      <button
                        onClick={() => viewResults(job.id)}
                        className="text-blue-600 hover:underline"
                      >
                        View
                      </button>
                      <button
                        onClick={() => handleExport(job.id)}
                        className="text-blue-600 hover:underline flex items-center gap-0.5"
                      >
                        <Download size={10} /> CSV
                      </button>
                    </>
                  )}
                  {job.status === 'FAILED' && (
                    <span className="text-red-500 truncate max-w-[150px]" title={job.error ?? ''}>
                      {job.error?.slice(0, 40)}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* AU results for selected job */}
      {selectedJobId && (
        <div className="border-t border-gray-200 pt-3">
          <h4 className="text-xs font-semibold text-gray-700 mb-2">
            AU Results for job {selectedJobId.slice(0, 8)}...
          </h4>
          {isLoadingResults ? (
            <Loader2 size={16} className="animate-spin text-gray-400" />
          ) : selectedJobResults.length === 0 ? (
            <p className="text-xs text-gray-400">No results found.</p>
          ) : (
            <>
              {/* AU timeline bars */}
              <div className="space-y-1.5 mb-3">
                {Object.entries(AU_LABELS).map(([key, label]) => {
                  const vals = selectedJobResults
                    .map((r) => (r as any)[key])
                    .filter((v: any) => v != null) as number[];
                  if (vals.length === 0) return null;
                  const maxVal = Math.max(...vals, 1);
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-500 w-36 truncate">{label}</span>
                      <div className="flex-1 flex items-end gap-px h-4 bg-gray-50 rounded overflow-hidden">
                        {vals.slice(-60).map((v, i) => (
                          <div
                            key={i}
                            className="bg-indigo-400 flex-1 min-w-[1px] rounded-t"
                            style={{ height: `${(v / maxVal) * 100}%` }}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="text-[10px] text-gray-400">
                Showing {selectedJobResults.length} frames
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
