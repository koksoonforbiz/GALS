import { createContext, useContext, useEffect } from 'react';

/**
 * Lets a page pause session-replay snapshots while it is mounted.
 * Interaction logging (including visibility/focus) keeps running.
 * Provided by LoggingProvider. No page uses it at the moment: the puzzles
 * and knowledge checks record in the gentle mode below instead.
 */
export const ReplayPauseContext = createContext<(paused: boolean) => void>(() => {});

export function usePauseReplay(paused = true) {
  const setPaused = useContext(ReplayPauseContext);
  useEffect(() => {
    setPaused(paused);
    return () => setPaused(false);
  }, [paused, setPaused]);
}

/**
 * Timing-sensitive pages (attention and memory puzzles, knowledge checks)
 * keep screen + DOM recording but in a gentle mode: periodic snapshots every
 * few seconds instead of every second, run when the browser is idle, so a
 * snapshot is unlikely to delay a key handler that times a response.
 */
export const ReplayGentleContext = createContext<(gentle: boolean) => void>(() => {});

export function useGentleReplay(gentle = true) {
  const setGentle = useContext(ReplayGentleContext);
  useEffect(() => {
    setGentle(gentle);
    return () => setGentle(false);
  }, [gentle, setGentle]);
}
