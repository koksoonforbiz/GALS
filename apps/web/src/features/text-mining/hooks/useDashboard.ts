import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../lib/api';

export function useTextMiningDashboard(sessionId: string) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(() => {
    setLoading(true);
    api
      .get(`/text-mining/sessions/${sessionId}/dashboard`)
      .then((res) => {
        setData(res as Record<string, unknown>);
        setError(null);
      })
      .catch((err) => setError(err.message || 'Failed to load text-mining dashboard'))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}
