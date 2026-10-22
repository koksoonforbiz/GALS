import { useEffect, useMemo, useRef, useState } from 'react';
import { afterPaint, now } from '../timing';
import type { StepProps } from './types';

/**
 * W7 joining circles as a click trail. The mm layout (origin bottom-left,
 * y up) is scaled to fit the window at a fixed aspect; the scale is sent as
 * pxPerMm. A correct click draws the line; a wrong one flashes red and
 * counts as an error, and the student carries on from the last correct
 * circle with the clock running. Test parts stop at 300 s.
 */
export function TrailStep({ step, rel, focus, onResult }: StepProps) {
  const p = step.payload as {
    points: Array<[number, number]>;
    labels: string[];
    fieldMm: [number, number];
    circleMm: number;
    beginEndOffsetMm: number;
    discontinueSeconds?: number;
  };
  const [W, H] = p.fieldMm;
  const scale = useMemo(() => {
    const maxW = Math.min(window.innerWidth - 64, 1100);
    const maxH = window.innerHeight - 220;
    return Math.max(1, Math.min(maxW / W, maxH / H));
  }, [W, H]);
  const [reached, setReached] = useState(0);
  const [wrong, setWrong] = useState<number | null>(null);
  const clicks = useRef<Array<{ label: string; atMs: number }>>([]);
  const start = useRef(0);
  const done = useRef(false);

  const xy = (i: number) => {
    const [x, y] = p.points[i]!;
    return { x: x * scale, y: (H - y) * scale }; // flip y
  };
  const r = (p.circleMm / 2) * scale;

  const finish = (t: number, discontinued: boolean) => {
    if (done.current) return;
    done.current = true;
    onResult({
      kind: 'trail',
      clicks: clicks.current,
      startMs: rel(start.current),
      endMs: rel(t),
      discontinued,
      pxPerMm: Math.round(scale * 1000) / 1000,
      focusLostMs: focus.take(),
    });
  };

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    void afterPaint().then((at) => {
      start.current = at;
      if (p.discontinueSeconds) {
        timer = setInterval(() => {
          if ((now() - start.current) / 1000 >= p.discontinueSeconds!) {
            clearInterval(timer);
            finish(now(), true);
          }
        }, 250);
      }
    });
    return () => timer && clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const click = (i: number) => {
    // A repeat click on the circle just reached is not an error: ignore it
    // entirely (not recorded), so the server's re-scoring matches the screen.
    if (done.current || i === reached - 1) return;
    const at = now();
    clicks.current.push({ label: p.labels[i]!, atMs: rel(at) });
    if (i === reached) {
      setWrong(null);
      const next = reached + 1;
      setReached(next);
      if (next >= p.labels.length) finish(at, false);
    } else {
      setWrong(i);
      setTimeout(() => setWrong((w) => (w === i ? null : w)), 400);
    }
  };

  const last = p.labels.length - 1;
  return (
    <svg
      width={W * scale}
      height={H * scale}
      className="mx-auto block select-none rounded border border-gray-200 bg-white"
    >
      {Array.from({ length: Math.max(0, reached - 1) }, (_, k) => {
        const a = xy(k);
        const b = xy(k + 1);
        return (
          <line
            key={k}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="rgb(30,70,200)"
            strokeWidth={2}
          />
        );
      })}
      {p.points.map((_, i) => {
        const c = xy(i);
        return (
          <g
            key={i}
            data-label={p.labels[i]}
            onMouseDown={() => click(i)}
            className="cursor-pointer"
          >
            <circle
              cx={c.x}
              cy={c.y}
              r={r}
              fill={wrong === i ? 'rgb(254,202,202)' : i < reached ? 'rgb(219,234,254)' : 'white'}
              stroke={wrong === i ? 'rgb(220,38,38)' : 'rgb(55,65,81)'}
              strokeWidth={1.5}
            />
            <text
              x={c.x}
              y={c.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={r * 0.95}
              fill="rgb(17,24,39)"
            >
              {p.labels[i]}
            </text>
            {(i === 0 || i === last) && (
              <text
                x={c.x}
                y={c.y + r + p.beginEndOffsetMm * scale * 0.6}
                textAnchor="middle"
                fontSize={r * 0.6}
                fill="rgb(107,114,128)"
              >
                {i === 0 ? 'Begin' : 'End'}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
