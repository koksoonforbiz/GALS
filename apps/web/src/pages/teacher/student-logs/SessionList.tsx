import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { BarChart2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { MouseEvent } from 'react';

interface Session {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationSecs: number | null;
  liveEventCount?: number;
  recordingSegmentCount?: number;
  recordingBytes?: number;
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
  onDelete: (id: string) => Promise<void>;
}

export function SessionList({ sessions, selectedId, onSelect, onDelete }: Props) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function deleteSession(e: MouseEvent, session: Session) {
    e.stopPropagation();
    const label = format(new Date(session.startedAt), 'MMM d, yyyy HH:mm');
    if (!window.confirm(`Delete logs for session ${label}? This cannot be undone.`)) return;

    setDeletingId(session.id);
    try {
      await onDelete(session.id);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {sessions.map((s) => (
        <li key={s.id}>
          <div
            className={`w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
              selectedId === s.id
                ? 'bg-indigo-50 dark:bg-indigo-900/20 border-l-2 border-indigo-500'
                : ''
            }`}
          >
            <button type="button" onClick={() => onSelect(s.id)} className="w-full text-left">
              <p className="text-xs font-medium text-gray-900 dark:text-gray-100">
                {format(new Date(s.startedAt), 'MMM d, yyyy \u2014 HH:mm')}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {s.durationSecs ? `${Math.round(s.durationSecs / 60)} min` : 'In progress'} ·{' '}
                {s.summary?.totalEvents ?? s.liveEventCount ?? 0} events
              </p>
              {(s.recordingBytes ?? 0) > 0 && (
                <p className="text-xs font-medium text-amber-700 dark:text-amber-300 mt-0.5">
                  {formatBytes(s.recordingBytes ?? 0)} recording · {s.recordingSegmentCount ?? 0}{' '}
                  clips
                </p>
              )}
              {s.summary && (
                <div className="flex gap-2 mt-1.5 flex-wrap">
                  <Chip label={`${s.summary.questionsAnswered} Q`} color="blue" />
                  <Chip label={`${s.summary.interventionsTriggered} int.`} color="purple" />
                </div>
              )}
            </button>
            <Link
              to={`/dashboard/sessions/${s.id}/timeline`}
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 mt-1.5"
            >
              <BarChart2 size={14} />
              Timeline
            </Link>
            <button
              type="button"
              onClick={(e) => deleteSession(e, s)}
              disabled={deletingId === s.id}
              className="mt-2 inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/30"
            >
              <Trash2 size={13} />
              {deletingId === s.id ? 'Deleting…' : 'Delete logs'}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
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
