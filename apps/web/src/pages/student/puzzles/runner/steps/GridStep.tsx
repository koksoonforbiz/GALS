import { useEffect, useRef, useState } from 'react';
import { afterPaint, now } from '../timing';
import { GRID_INSTRUCTIONS, GRID_RULES } from '../wording';
import type { StepProps } from './types';

type Colour = 'red' | 'green' | 'blue';
type Cell = { text: string; ink: Colour | 'black' };
const KEYS: Record<string, Colour> = { f: 'red', j: 'green', k: 'blue' };
/**
 * After a wrong key, keys are ignored this long. Golden's spoken version
 * makes an error cost the time to say the word again; without a cost,
 * cycling F→J→K passes any item in ~2 presses without reading it, so CW
 * (and IG) could exceed honest performance.
 */
export const ERROR_LOCKOUT_MS = 400;
// Battery ink colours (ef.py \definecolor inkred/inkgreen/inkblue).
const INK: Record<Cell['ink'], string> = {
  red: 'rgb(200,30,30)',
  green: 'rgb(20,140,60)',
  blue: 'rgb(30,70,200)',
  black: 'rgb(17,24,39)',
};

/**
 * W6 colours, Golden card layout on the keyboard. mode "keys"/"row" are
 * untimed practice (read across); mode "grid" is the 45 s page read down
 * the columns, restarting from the top when finished. A wrong key flashes
 * the item red, keys are ignored for ERROR_LOCKOUT_MS, and the right key
 * must still be pressed (time runs on). Held-key auto-repeat is ignored.
 * The correct key is the visible word (W page) or ink (C, CW pages).
 */
export function GridStep({ step, rel, focus, onResult }: StepProps) {
  const p = step.payload as {
    page: 'W' | 'C' | 'CW';
    mode: 'keys' | 'row' | 'grid';
    cells: Cell[];
    rows?: number;
    cols?: number;
    seconds?: number;
  };
  const timed = p.mode === 'grid';
  const [started, setStarted] = useState(!timed);
  const [pos, setPos] = useState(0); // absolute press position (wraps on restart)
  const [flash, setFlash] = useState(false);
  const [left, setLeft] = useState(p.seconds ?? 0);
  const presses = useRef<Array<{ i: number; key: Colour; atMs: number }>>([]);
  const start = useRef(0);
  const done = useRef(false);
  const posRef = useRef(0);
  const lockedUntil = useRef(0);
  posRef.current = pos;

  const correctOf = (c: Cell): Colour =>
    p.page === 'W' ? (c.text.toLowerCase() as Colour) : (c.ink as Colour);
  const n = p.cells.length;

  const finish = (t: number) => {
    if (done.current) return;
    done.current = true;
    onResult({
      kind: 'grid',
      presses: presses.current,
      startMs: rel(start.current),
      endMs: rel(t),
      restarts: Math.floor(posRef.current / n),
      focusLostMs: focus.take(),
    });
  };

  useEffect(() => {
    if (!started) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    void afterPaint().then((at) => {
      start.current = at;
      if (timed) {
        timer = setInterval(() => {
          const elapsed = (now() - start.current) / 1000;
          setLeft(Math.max(0, Math.ceil(p.seconds! - elapsed)));
          if (elapsed >= p.seconds!) {
            clearInterval(timer);
            finish(now());
          }
        }, 50);
      }
    });
    return () => timer && clearInterval(timer);
  }, [started]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!started) {
        if (e.code === 'Space') {
          e.preventDefault();
          setStarted(true);
        }
        return;
      }
      const colour = KEYS[e.key.toLowerCase()];
      if (!colour || done.current) return;
      e.preventDefault();
      if (e.repeat) return;
      const at = now();
      if (at < lockedUntil.current) return;
      const i = posRef.current;
      presses.current.push({ i, key: colour, atMs: rel(at) });
      if (colour === correctOf(p.cells[i % n]!)) {
        setFlash(false);
        const next = i + 1;
        setPos(next);
        if (!timed && next >= n) finish(at); // practice: once through
      } else {
        setFlash(true); // must press the right key; position stays
        lockedUntil.current = at + ERROR_LOCKOUT_MS;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [started]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = pos % n;

  // The 20-row page is taller than a 768 px laptop screen: keep the current
  // item in view so the student never has to leave the keys to scroll
  // during the timed 45 s (that would cost items, not reflect inhibition).
  useEffect(() => {
    if (!started) return;
    document
      .querySelector<HTMLElement>('[data-current="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [pos, started]);

  const cellView = (c: Cell, i: number) => (
    <div
      key={i}
      data-current={i === current ? 'true' : undefined}
      className={`rounded px-2 py-0.5 text-center font-semibold tracking-wide ${
        i === current
          ? flash
            ? 'bg-red-200 ring-2 ring-red-500'
            : 'bg-amber-100 ring-2 ring-amber-400'
          : ''
      }`}
      style={{ color: INK[c.ink] }}
    >
      {c.text}
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-3">
      {timed && (
        <p className="max-w-2xl text-center text-sm text-gray-700">
          {GRID_INSTRUCTIONS[p.page]} {GRID_RULES}
        </p>
      )}
      <div className="flex gap-6 text-sm font-medium text-gray-600">
        <span>F = red</span>
        <span>J = green</span>
        <span>K = blue</span>
        {timed && started && <span className="font-mono text-gray-500">{left}s</span>}
      </div>
      {!started ? (
        <p className="mt-6 text-base text-gray-800">Press the space bar to begin.</p>
      ) : timed ? (
        // Column-major: cell (row r, col c) = cells[c*rows + r].
        <div className="flex gap-6 text-lg">
          {Array.from({ length: p.cols! }, (_, c) => (
            <div key={c} className="flex flex-col gap-0.5">
              {Array.from({ length: p.rows! }, (_, r) =>
                cellView(p.cells[c * p.rows! + r]!, c * p.rows! + r),
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap justify-center gap-3 text-2xl">
          {p.cells.map(cellView)}
        </div>
      )}
    </div>
  );
}
