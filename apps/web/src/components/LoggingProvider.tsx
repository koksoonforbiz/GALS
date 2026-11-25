import React, { useState } from 'react';
import { useInteractionLogger } from '../lib/interaction-log/useInteractionLogger';
import { useSessionReplayRecorder } from '../lib/interaction-log/useSessionReplayRecorder';
import { LoggingErrorBoundary } from './LoggingErrorBoundary';
import { ReplayGentleContext, ReplayPauseContext } from './replayPause';

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
  const [replayGentle, setReplayGentle] = useState(false);
  useInteractionLogger({ sessionId, userId });
  useSessionReplayRecorder({
    sessionId,
    userId,
    captureDom,
    enabled: !replayPaused,
    gentle: replayGentle,
  });

  return (
    <LoggingErrorBoundary sessionId={sessionId} userId={userId}>
      <ReplayPauseContext.Provider value={setReplayPaused}>
        <ReplayGentleContext.Provider value={setReplayGentle}>
          {children}
        </ReplayGentleContext.Provider>
      </ReplayPauseContext.Provider>
    </LoggingErrorBoundary>
  );
}
