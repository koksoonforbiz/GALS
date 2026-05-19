import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';

interface StudentActivity {
  studentId: string;
  studentName: string;
  studentEmail: string;
  sessionCount: number;
  messageCount: number;
  sourceCount: number;
  lastActiveAt: string | null;
}

interface Props {
  courseId: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function DialogueActivityPanel({ courseId }: Props) {
  const [activity, setActivity] = useState<StudentActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<StudentActivity[]>(`/dialogue/courses/${courseId}/activity`)
      .then(setActivity)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [courseId]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (activity.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-6">No student dialogue activity yet.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left">
            <th className="py-2 pr-4 text-xs font-medium text-gray-500">Student Name</th>
            <th className="py-2 pr-4 text-xs font-medium text-gray-500 text-center">Sessions</th>
            <th className="py-2 pr-4 text-xs font-medium text-gray-500 text-center">Messages</th>
            <th className="py-2 pr-4 text-xs font-medium text-gray-500 text-center">
              Sources Uploaded
            </th>
            <th className="py-2 text-xs font-medium text-gray-500">Last Active</th>
          </tr>
        </thead>
        <tbody>
          {activity.map((row) => (
            <tr key={row.studentId} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="py-2.5 pr-4">
                <div className="font-medium text-gray-900">{row.studentName}</div>
                <div className="text-xs text-gray-400">{row.studentEmail}</div>
              </td>
              <td className="py-2.5 pr-4 text-center text-gray-700">{row.sessionCount}</td>
              <td className="py-2.5 pr-4 text-center text-gray-700">{row.messageCount}</td>
              <td className="py-2.5 pr-4 text-center text-gray-700">{row.sourceCount}</td>
              <td className="py-2.5 text-gray-500 text-xs">
                {row.lastActiveAt ? timeAgo(row.lastActiveAt) : 'Never'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
