import { useState, useEffect } from 'react';
import { api } from '../../../../lib/api';

export function useSessionSummary(sessionId: string) {
  const [summary, setSummary] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    setIsLoading(true);
    api.get<any>(`/activity-log/teacher/sessions/${sessionId}/summary`).then((data) => {
      setSummary(data);
      setIsLoading(false);
    });
  }, [sessionId]);

  return { summary, isLoading };
}
