import { createContext, useContext, useEffect } from 'react';

/**
 * Lets a page hold back the periodic "How are you feeling right now?"
 * pop-up while it is mounted (the attention and memory puzzles: timed, and
 * must not be interrupted). The pop-up is deferred, not skipped: it shows
 * once the page unmounts. Provided by Layout.
 */
export const SurveyHoldContext = createContext<(held: boolean) => void>(() => {});

export function useHoldSurvey(held = true) {
  const setHeld = useContext(SurveyHoldContext);
  useEffect(() => {
    setHeld(held);
    return () => setHeld(false);
  }, [held, setHeld]);
}
