import { formatTimeSecSGT } from '../../../../lib/formatDateTime';

export function InterventionTab({ logs }: { logs: any[] }) {
  const events = logs.filter((l) => l.action.startsWith('INTERVENTION_'));

  if (events.length === 0) {
    return <p className="text-xs text-gray-400">No intervention events in this session.</p>;
  }

  return (
    <div className="space-y-2">
      {events.map((e) => {
        const meta = e.metadata as Record<string, unknown> | null;
        return (
          <div
            key={e.id}
            className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 flex gap-3 items-start"
          >
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded uppercase shrink-0 ${
                e.action === 'INTERVENTION_TRIGGERED'
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                  : e.action === 'INTERVENTION_COMPLETED'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
              }`}
            >
              {e.action.replace('INTERVENTION_', '')}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-800 dark:text-gray-200">
                {String(meta?.interventionType ?? meta?.summary ?? '\u2014')}
              </p>
              {meta?.triggerReason != null && (
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Trigger: {String(meta.triggerReason)}
                </p>
              )}
            </div>
            <span className="text-[10px] text-gray-400 shrink-0 font-mono">
              {formatTimeSecSGT(e.occurredAt)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
