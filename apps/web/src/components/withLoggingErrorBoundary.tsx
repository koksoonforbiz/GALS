import React from 'react';
import { LoggingErrorBoundary } from './LoggingErrorBoundary';

export function withLoggingErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  sessionId: string,
  userId: string,
): React.ComponentType<P> {
  const Wrapped = (props: P) => (
    <LoggingErrorBoundary sessionId={sessionId} userId={userId}>
      <Component {...props} />
    </LoggingErrorBoundary>
  );
  Wrapped.displayName = `WithLoggingErrorBoundary(${Component.displayName || Component.name || 'Component'})`;
  return Wrapped;
}
