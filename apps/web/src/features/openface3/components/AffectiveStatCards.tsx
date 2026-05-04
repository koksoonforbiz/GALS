import { useState, useEffect } from 'react';
import { Loader2, Inbox } from 'lucide-react';
import { api } from '../../../lib/api';

interface AffectiveStatCardsProps {
  sessionId: string;
}

const STATE_COLORS: Record<string, string> = {
  engagement: 'bg-green-100 text-green-700',
  boredom: 'bg-gray-100 text-gray-700',
  confusion: 'bg-yellow-100 text-yellow-700',
  frustration: 'bg-red-100 text-red-700',
};

export function AffectiveStatCards({ sessionId }: AffectiveStatCardsProps) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get(`/affective-mapping/windows/session/${sessionId}/summary`)
      .then((res) => setData(res as Record<string, unknown>))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 size={20} className="animate-spin text-blue-500" aria-hidden="true" />
      </div>
    );
  }

  if (!data || (data.totalWindows as number) === 0) {
    return (
      <div className="flex flex-col items-center py-6 text-gray-400">
        <Inbox size={20} aria-hidden="true" />
        <p className="text-xs mt-1">No affective state data yet.</p>
      </div>
    );
  }

  const means = data.means as Record<string, number>;
  const timeInState = data.timeInState as Record<string, number>;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {['engagement', 'boredom', 'confusion', 'frustration'].map((state) => (
        <div key={state} className="bg-white rounded-lg border border-gray-200 p-3">
          <p className="text-xs text-gray-500 capitalize">{state}</p>
          <p className="text-xl font-semibold text-gray-800">
            {((means[state] ?? 0) * 100).toFixed(0)}%
          </p>
          <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
            <div
              className={`h-1.5 rounded-full ${STATE_COLORS[state]?.split(' ')[0] ?? 'bg-gray-400'}`}
              style={{ width: `${(means[state] ?? 0) * 100}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 mt-1">{timeInState[state] ?? 0}% of session</p>
        </div>
      ))}
    </div>
  );
}
