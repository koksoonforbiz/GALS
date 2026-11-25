/**
 * Active time from learner input (Prompt B, P5; CAP-28/29), for every
 * surface, not only interactive lessons.
 *
 * Time between two inputs counts as active when the gap is shorter than
 * T_idle (120 s, SESSION_PARAMS / lesson tracker); a gap of T_idle or more
 * is idle from the last input on, as in the lesson tracker. `activeMs()` only grows, so a caller keeps the
 * value at the start of something (an item, a PDF page) and subtracts it at
 * the end. A hidden tab adds nothing.
 */
export const T_IDLE_MS = 120_000;

const INPUTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

let total = 0;
let lastInput: number | null = null;
let installed = false;

function onInput() {
  const now = Date.now();
  if (lastInput != null && !document.hidden && now - lastInput < T_IDLE_MS)
    total += now - lastInput;
  lastInput = now;
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  for (const k of INPUTS) window.addEventListener(k, onInput, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    const now = Date.now();
    if (document.hidden) {
      // Hidden: count the stretch up to now, then nothing until visible.
      if (lastInput != null && now - lastInput < T_IDLE_MS) total += now - lastInput;
      lastInput = null;
    } else {
      lastInput = now; // visible again: start a fresh stretch
    }
  });
}

/** Active ms so far in this page load (with the stretch since the last input while under T_idle). */
export function activeMs(now = Date.now()): number {
  install();
  if (lastInput == null || document.hidden) return total;
  const tail = now - lastInput;
  return total + (tail < T_IDLE_MS ? tail : 0);
}

/** When the learner last gave input (null: none yet in this page load). */
export function lastInputAt(): number | null {
  install();
  return lastInput;
}

install();
