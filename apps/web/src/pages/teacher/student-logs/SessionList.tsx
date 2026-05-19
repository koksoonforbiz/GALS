import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { BarChart2 } from 'lucide-react';

interface Session {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationSecs: number | null;
  liveEventCount?: number;
  summary: {
    totalEvents: number;
    totalActiveTimeSecs: number;
    questionsAnswered: number;
    interventionsTriggered: number;
  } | null;
}

interface Props {
  sessions: Session[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function SessionList({ sessions, selectedId, onSelect }: Props) {
  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {sessions.map((s) => (
        <li key={s.id}>
          <button
            onClick={() => onSelect(s.id)}
            className={`w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
              selectedId === s.id
                ? 'bg-indigo-50 dark:bg-indigo-900/20 border-l-2 border-indigo-500'
                : ''
            }`}
          >
            <p className="text-xs font-medium text-gray-900 dark:text-gray-100">
              {format(new Date(s.startedAt), 'MMM d, yyyy \u2014 HH:mm')}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {s.durationSecs ? `${Math.round(s.durationSecs / 60)} min` : 'In progress'} ·{' '}
              {s.summary?.totalEvents ?? s.liveEventCount ?? 0} events
            </p>
            {s.summary && (
              <div className="flex gap-2 mt-1.5 flex-wrap">
                <Chip label={`${s.summary.questionsAnswered} Q`} color="blue" />
                <Chip label={`${s.summary.interventionsTriggered} int.`} color="purple" />
              </div>
            )}
            <Link
              to={`/dashboard/sessions/${s.id}/timeline`}
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 mt-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              <BarChart2 size={14} />
              Timeline
            </Link>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    purple: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    green: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  };
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${colors[color] ?? ''}`}>
      {label}
    </span>
  );
}
