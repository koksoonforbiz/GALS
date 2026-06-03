import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../lib/api';

export type TextMiningSessionScope = 'dialogue' | 'activity';

function getDashboardPath(scope: TextMiningSessionScope, sessionId: string) {
  return scope === 'activity'
    ? `/text-mining/activity-sessions/${sessionId}/dashboard`
    : `/text-mining/sessions/${sessionId}/dashboard`;
}

export function useTextMiningDashboard(
  sessionId: string,
  scope: TextMiningSessionScope = 'dialogue',
) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(() => {
    setLoading(true);
    api
      .get(getDashboardPath(scope, sessionId))
      .then((res) => {
        setData(res as Record<string, unknown>);
        setError(null);
      })
      .catch((err) => setError(err.message || 'Failed to load text-mining dashboard'))
      .finally(() => setLoading(false));
  }, [scope, sessionId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}
