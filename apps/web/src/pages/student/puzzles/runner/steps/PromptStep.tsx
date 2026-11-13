import { useEffect, useRef, useState } from 'react';
import { afterPaint, now } from '../timing';
import { KEEP_GOING } from '../wording';
import type { StepProps } from './types';

/**
 * W4: one prompt, 60 s countdown from first display; Enter adds a word to
 * the visible list (earlier entries cannot be edited). A one-time "keep
 * going" nudge if there has been no entry for 15 s before the 30 s mark
 * (ONLINE_ADAPTATION §3 W4).
 */
export function PromptStep({ step, rel, focus, onResult }: StepProps) {
  const p = step.payload as {
    prompt: 'letter' | 'category' | 'switch';
    letter?: string;
    category?: string;
    pair?: [string, string];
    seconds: number;
  };
  const [entries, setEntries] = useState<Array<{ text: string; atMs: number }>>([]);
  const [value, setValue] = useState('');
  const [left, setLeft] = useState(p.seconds);
  const [nudge, setNudge] = useState(false);
  const start = useRef(0);
  const lastEntry = useRef(0);
  const nudged = useRef(false);
  const done = useRef(false);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const input = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    void afterPaint().then((at) => {
      start.current = at;
      lastEntry.current = at;
      input.current?.focus();
      timer = setInterval(() => {
        const t = now();
        const elapsed = (t - start.current) / 1000;
        setLeft(Math.max(0, Math.ceil(p.seconds - elapsed)));
        if (!nudged.current && elapsed < 30 && t - lastEntry.current >= 15_000) {
          nudged.current = true;
          setNudge(true);
        }
        if (elapsed >= p.seconds && !done.current) {
          done.current = true;
          clearInterval(timer);
          onResult({
            kind: 'prompt',
            entries: entriesRef.current,
            startMs: rel(start.current),
            endMs: rel(t),
            nudged: nudged.current,
            // a word still in the box at 60 s: recorded, not scored
            ...(valueRef.current.trim()
              ? { unsubmitted: valueRef.current.trim().slice(0, 64) }
              : {}),
            focusLostMs: focus.take(),
          });
        }
      }, 100);
    });
    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = () => {
    const text = value.trim();
    if (!text || done.current) return;
    const at = now();
    lastEntry.current = at;
    setEntries((e) => [...e, { text: text.slice(0, 64), atMs: rel(at) }]);
    setValue('');
  };

  const heading =
    p.prompt === 'letter' ? (
      <span className="font-mono text-6xl font-semibold">{p.letter}</span>
    ) : p.prompt === 'category' ? (
      <span className="text-3xl font-semibold capitalize">{p.category}</span>
    ) : (
      <span className="text-2xl font-semibold">
        {p.pair![0]} <span className="text-gray-400">↔</span> {p.pair![1]}
      </span>
    );

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex w-full max-w-xl items-center justify-between">
        {heading}
        <span className="font-mono text-2xl text-gray-500" aria-label="seconds left">
          {left}s
        </span>
      </div>
      <input
        ref={input}
        aria-label="A word"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, 64))}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        className="w-full max-w-xl rounded-md border border-gray-300 px-3 py-2 text-xl"
      />
      <p className={`h-5 text-sm font-medium text-amber-700 ${nudge ? '' : 'invisible'}`}>
        {KEEP_GOING}
      </p>
      <ol className="flex w-full max-w-xl flex-wrap gap-2">
        {entries.map((e, i) => (
          <li key={i} className="rounded bg-gray-100 px-2 py-0.5 text-sm text-gray-800">
            {e.text}
          </li>
        ))}
      </ol>
    </div>
  );
}
