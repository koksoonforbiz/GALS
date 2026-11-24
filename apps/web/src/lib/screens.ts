import { useEffect, useState } from 'react';

/**
 * Single-screen rule (study requirement): students work on one screen, so
 * the screen recording and eye tracking cover everything they see. Chrome
 * and Edge report an extended desktop as `screen.isExtended` (Window
 * Management API; reading the flag needs no permission) and fire `change`
 * on `window.screen` when a display is connected or removed. Other browsers
 * cannot tell, so they get `null` and are not blocked.
 */
type ScreenWithExtended = Screen & { isExtended?: boolean };

export function isExtendedDisplay(): boolean | null {
  const s = window.screen as ScreenWithExtended;
  return typeof s.isExtended === 'boolean' ? s.isExtended : null;
}

/** Live `isExtendedDisplay()`; re-evaluated when displays change. */
export function useExtendedDisplay(): boolean | null {
  const [extended, setExtended] = useState(isExtendedDisplay);
  useEffect(() => {
    const update = () => setExtended(isExtendedDisplay());
    const s = window.screen as Screen & EventTarget;
    s.addEventListener?.('change', update);
    // Fallback: some builds only update the flag without firing `change`.
    const poll = setInterval(update, 3000);
    return () => {
      s.removeEventListener?.('change', update);
      clearInterval(poll);
    };
  }, []);
  return extended;
}
