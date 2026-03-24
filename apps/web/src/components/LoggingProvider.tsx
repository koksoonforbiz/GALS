import React from 'react';
import { useInteractionLogger } from '../lib/interaction-log/useInteractionLogger';
import { LoggingErrorBoundary } from './LoggingErrorBoundary';

interface LoggingProviderProps {
  sessionId: string;
  userId: string;
  children: React.ReactNode;
}

export function LoggingProvider({ sessionId, userId, children }: LoggingProviderProps) {
  useInteractionLogger({ sessionId, userId });

  return (
    <LoggingErrorBoundary sessionId={sessionId} userId={userId}>
      {children}
    </LoggingErrorBoundary>
  );
}
