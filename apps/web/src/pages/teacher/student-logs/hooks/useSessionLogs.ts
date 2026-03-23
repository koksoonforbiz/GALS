import { useState, useEffect } from 'react';
import { api } from '../../../../lib/api';

export function useSessionLogs(sessionId: string) {
  const [logs, setLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    setIsLoading(true);
    api.get<any[]>(`/activity-log/teacher/sessions/${sessionId}`).then((data) => {
      setLogs(data);
      setIsLoading(false);
    });
  }, [sessionId]);

  return { logs, isLoading };
}
