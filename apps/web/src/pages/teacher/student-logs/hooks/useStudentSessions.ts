import { useState, useEffect } from 'react';
import { api } from '../../../../lib/api';

export function useStudentSessions(studentId: string) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function loadSessions() {
    if (!studentId) return;
    setIsLoading(true);
    setError(null);
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
  }

  useEffect(() => {
    loadSessions();
  }, [studentId]);

  async function deleteSession(sessionId: string) {
    await api.delete(`/activity-log/teacher/sessions/${sessionId}`);
    setSessions((current) => current.filter((session) => session.id !== sessionId));
  }

  return { sessions, isLoading, error, deleteSession, refresh: loadSessions };
}
