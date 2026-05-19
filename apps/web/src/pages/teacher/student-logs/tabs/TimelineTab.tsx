import { format } from 'date-fns';

const ACTION_COLORS: Record<string, string> = {
  SESSION_START: 'bg-gray-400',
  SESSION_END: 'bg-gray-400',
  ASSESSMENT_STARTED: 'bg-blue-400',
  ASSESSMENT_SUBMITTED: 'bg-blue-600',
  QUESTION_ANSWERED: 'bg-blue-300',
  DIALOGUE_SESSION_STARTED: 'bg-teal-400',
  DIALOGUE_MESSAGE_SENT: 'bg-teal-300',
  DIALOGUE_MESSAGE_RECEIVED: 'bg-teal-200',
  INTERVENTION_TRIGGERED: 'bg-purple-400',
  INTERVENTION_COMPLETED: 'bg-purple-600',
  MASTERY_UPDATED: 'bg-green-400',
  SPACED_REP_CARD_RATED: 'bg-amber-400',
  MODULE_ITEM_VIEWED: 'bg-gray-300',
};

export function TimelineTab({ logs }: { logs: any[] }) {
  return (
    <div className="relative">
      {/* Vertical rule */}
      <div className="absolute left-[5.5rem] top-0 bottom-0 w-px bg-gray-200 dark:bg-gray-700" />

      <ol className="space-y-2">
        {logs.map((log) => {
          const meta = log.metadata as Record<string, unknown> | null;
          return (
            <li key={log.id} className="flex gap-4 items-start">
              {/* Timestamp */}
              <span className="w-20 shrink-0 text-right text-[10px] text-gray-400 font-mono pt-1">
                {format(new Date(log.occurredAt), 'HH:mm:ss')}
              </span>

              {/* Dot */}
              <div
                className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 z-10 ${
                  ACTION_COLORS[log.action] ?? 'bg-gray-300'
                }`}
              />

              {/* Content */}
              <div className="flex-1 min-w-0 pb-2">
                <p className="text-xs font-medium text-gray-800 dark:text-gray-200">
                  {log.action.replace(/_/g, ' ')}
                </p>
                {meta?.summary != null && (
                  <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                    {String(meta.summary)}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
