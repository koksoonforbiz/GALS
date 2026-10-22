import React, { useState } from 'react';
import { useInteractionLogger } from '../lib/interaction-log/useInteractionLogger';
import { useSessionReplayRecorder } from '../lib/interaction-log/useSessionReplayRecorder';
import { LoggingErrorBoundary } from './LoggingErrorBoundary';
import { ReplayPauseContext } from './replayPause';

interface LoggingProviderProps {
  sessionId: string;
  userId: string;
  children: React.ReactNode;
  /** Enable full DOM serialisation per snapshot. Very large (~500 KB–5 MB each).
   *  Defaults to false — pixel screenshots are always captured regardless. */
  captureDom?: boolean;
}

export function LoggingProvider({
  sessionId,
  userId,
  children,
  captureDom = false,
}: LoggingProviderProps) {
  const [replayPaused, setReplayPaused] = useState(false);
  useInteractionLogger({ sessionId, userId });
  useSessionReplayRecorder({ sessionId, userId, captureDom, enabled: !replayPaused });

  return (
    <LoggingErrorBoundary sessionId={sessionId} userId={userId}>
      <ReplayPauseContext.Provider value={setReplayPaused}>{children}</ReplayPauseContext.Provider>
    </LoggingErrorBoundary>
  );
}
