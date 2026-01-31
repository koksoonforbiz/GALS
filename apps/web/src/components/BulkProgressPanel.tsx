interface PageResult {
  pageId: string;
  status: 'OK' | 'NOT_ENOUGH_INFO' | 'ERROR' | 'PENDING' | 'RUNNING';
  jobId?: string;
  message?: string;
  missingInfo?: string[];
}

interface Props {
  results: PageResult[];
  pageTitles: Record<string, string>;
  onRetryFailed: (failedPageIds: string[]) => void;
  onClose: () => void;
}

export default function BulkProgressPanel({ results, pageTitles, onRetryFailed, onClose }: Props) {
  const completed = results.filter((r) => r.status === 'OK').length;
  const failed = results.filter((r) => r.status === 'ERROR').length;
  const notEnough = results.filter((r) => r.status === 'NOT_ENOUGH_INFO').length;
  const pending = results.filter((r) => r.status === 'PENDING' || r.status === 'RUNNING').length;
  const total = results.length;

  const failedIds = results.filter((r) => r.status === 'ERROR').map((r) => r.pageId);

  const statusIcon = (status: string) => {
    switch (status) {
      case 'OK':
        return <span className="text-green-500">&#10003;</span>;
      case 'ERROR':
        return <span className="text-red-500">&#10005;</span>;
      case 'NOT_ENOUGH_INFO':
        return <span className="text-yellow-500">&#9888;</span>;
      case 'RUNNING':
        return <span className="text-blue-500 animate-pulse">&#8987;</span>;
      default:
        return <span className="text-gray-400">&#9711;</span>;
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'OK':
        return 'bg-green-50 border-green-200';
      case 'ERROR':
        return 'bg-red-50 border-red-200';
      case 'NOT_ENOUGH_INFO':
        return 'bg-yellow-50 border-yellow-200';
      case 'RUNNING':
        return 'bg-blue-50 border-blue-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const allDone = pending === 0;
  const progressPct = total > 0 ? Math.round(((completed + failed + notEnough) / total) * 100) : 0;

  return (
    <div className="border border-gray-200 rounded-lg bg-white shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-semibold text-gray-800">
            {allDone ? 'Generation Complete' : 'Generating Content...'}
          </h4>
          <span className="text-xs text-gray-400">
            {completed}/{total} done
            {failed > 0 && ` | ${failed} failed`}
            {notEnough > 0 && ` | ${notEnough} insufficient`}
          </span>
        </div>
        {allDone && (
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">
            Dismiss
          </button>
        )}
      </div>

      {/* Progress bar */}
      {!allDone && (
        <div className="px-4 pt-2">
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Results list */}
      <div className="px-4 py-2 space-y-1 max-h-60 overflow-y-auto">
        {results.map((result) => (
          <div
            key={result.pageId}
            className={`flex items-center gap-2 px-2 py-1.5 rounded border text-xs ${statusColor(result.status)}`}
          >
            {statusIcon(result.status)}
            <span className="flex-1 truncate font-medium">
              {pageTitles[result.pageId] || result.pageId}
            </span>
            <span className="text-gray-500 shrink-0">
              {result.status === 'RUNNING' && 'Generating...'}
              {result.status === 'PENDING' && 'Waiting...'}
              {result.status === 'OK' && 'Done'}
              {result.status === 'NOT_ENOUGH_INFO' && 'Insufficient sources'}
              {result.status === 'ERROR' && (result.message || 'Failed')}
            </span>
          </div>
        ))}
      </div>

      {/* Missing info details */}
      {results.some((r) => r.status === 'NOT_ENOUGH_INFO' && r.missingInfo?.length) && (
        <div className="px-4 py-2 border-t border-gray-100">
          <div className="text-xs font-medium text-yellow-800 mb-1">Missing Information</div>
          {results
            .filter((r) => r.status === 'NOT_ENOUGH_INFO' && r.missingInfo?.length)
            .map((r) => (
              <div key={r.pageId} className="text-xs text-yellow-700 ml-2">
                <strong>{pageTitles[r.pageId]}:</strong> {r.missingInfo!.join('; ')}
              </div>
            ))}
        </div>
      )}

      {/* Footer actions */}
      {allDone && failed > 0 && (
        <div className="px-4 py-3 border-t border-gray-100 flex justify-end">
          <button
            onClick={() => onRetryFailed(failedIds)}
            className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
          >
            Retry {failed} failed page(s)
          </button>
        </div>
      )}
    </div>
  );
}
