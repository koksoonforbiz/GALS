import { useState, useEffect } from 'react';
import { api } from '../../../../lib/api';

export function useStudentSessions(studentId: string) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!studentId) return;
    setIsLoading(true);
    api
      .get<any[]>(`/activity-log/teacher/students/${studentId}/sessions`)
      .then((data) => {
        setSessions(data);
        setIsLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setIsLoading(false);
      });
  }, [studentId]);

  return { sessions, isLoading, error };
}
