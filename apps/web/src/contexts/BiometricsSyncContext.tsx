import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from 'react';
import { api } from '../lib/api';

interface RecordingConfig {
  isEnabled: boolean;
}

export interface BiometricsSyncContextValue {
  sessionId: string;
  courseId: string;
  wallClockOffset: number;
  isRecordingActive: boolean;
  isRecordingEnabled: boolean;
  hasConsent: boolean;
  setRecordingActive: (active: boolean) => void;
  setHasConsent: (consent: boolean) => void;
}

const BiometricsSyncContext = createContext<BiometricsSyncContextValue | null>(null);

export function useBiometricsSync() {
  return useContext(BiometricsSyncContext);
}

interface BiometricsSyncProviderProps {
  sessionId: string;
  courseId: string;
  children: ReactNode;
}

export function BiometricsSyncProvider({
  sessionId,
  courseId,
  children,
}: BiometricsSyncProviderProps) {
  // Compute wallClockOffset once on mount
  const wallClockOffset = useMemo(() => Date.now() - performance.now(), []);

  const [isRecordingActive, setRecordingActive] = useState(false);
  const [isRecordingEnabled, setRecordingEnabled] = useState(false);
  // Consent is implied by login — no explicit consent dialog needed.
  const [hasConsent, setHasConsent] = useState(true);

  // Link this activity session to the course so the teacher can view biometric data
  useEffect(() => {
    if (!courseId) return;
    api.patch('/activity-log/session/course', { courseId }).catch(() => {});
  }, [courseId]);

  // Fetch recording config on mount (consent is always granted)
  useEffect(() => {
    if (!courseId) return;
    api
      .get<RecordingConfig>(`/recording/config/${courseId}`)
      .then((config) => setRecordingEnabled(config.isEnabled))
      .catch(() => setRecordingEnabled(false));
  }, [courseId]);

  const value = useMemo<BiometricsSyncContextValue>(
    () => ({
      sessionId,
      courseId,
      wallClockOffset,
      isRecordingActive,
      isRecordingEnabled,
      hasConsent,
      setRecordingActive,
      setHasConsent,
    }),
    [sessionId, courseId, wallClockOffset, isRecordingActive, isRecordingEnabled, hasConsent],
  );

  return <BiometricsSyncContext.Provider value={value}>{children}</BiometricsSyncContext.Provider>;
}
