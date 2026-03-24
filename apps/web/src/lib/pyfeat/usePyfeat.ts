import { useState, useEffect } from 'react';
import { api } from '../api';

interface PyfeatConfig {
  isEnabled: boolean;
}

/**
 * Lightweight hook that checks whether py-feat AU detection is enabled
 * for the current course. Since AU extraction runs asynchronously on
 * recorded video segments (not in real time), this hook only queries the
 * config and exposes an `isActive` flag for the biometrics banner.
 */
export function usePyfeat(courseId: string, sessionId: string): { isActive: boolean } {
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (!courseId || !sessionId) return;

    let cancelled = false;

    async function checkConfig() {
      try {
        const config = await api.get<PyfeatConfig>(`/pyfeat/config/${courseId}`);
        if (!cancelled && config.isEnabled) {
          setIsActive(true);
          console.log('[PyFeat] AU detection is enabled for this course');
        }
      } catch (err) {
        console.error('[PyFeat] Failed to fetch config:', err);
      }
    }

    checkConfig();

    return () => {
      cancelled = true;
    };
  }, [courseId, sessionId]);

  return { isActive };
}
