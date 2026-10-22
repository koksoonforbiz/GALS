import { createContext, useContext, useEffect } from 'react';

/**
 * Lets a page pause session-replay snapshots while it is mounted (the
 * attention and memory puzzles: timing-sensitive, and their answers must
 * not end up in DOM/pixel snapshots). Interaction logging — including
 * visibility/focus — keeps running. Provided by LoggingProvider.
 */
export const ReplayPauseContext = createContext<(paused: boolean) => void>(() => {});

export function usePauseReplay(paused = true) {
  const setPaused = useContext(ReplayPauseContext);
  useEffect(() => {
    setPaused(paused);
    return () => setPaused(false);
  }, [paused, setPaused]);
}
