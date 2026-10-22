/**
 * Typed single-answer steps: W3 practice items, W3 timed lists (one number
 * at a time, the next appears on Enter) and W5 sentences.
 */
import { useEffect, useRef, useState } from 'react';
import { afterPaint, now } from '../timing';
import { ANY_WORD } from '../wording';
import type { StepProps } from './types';

function useTyped(onFirst: () => void) {
  const [value, setValue] = useState('');
  const corrections = useRef(0);
  const change = (v: string, filter?: (s: string) => string) => {
    onFirst();
    const next = (filter ? filter(v) : v).slice(0, 32);
    setValue((old) => {
      if (next.length < old.length) corrections.current++;
      return next;
    });
  };
  const reset = () => {
    setValue('');
    corrections.current = 0;
  };
  return { value, change, corrections, reset };
}

const LIST_LABEL: Record<string, string> = {
  plus: 'Add 3',
  minus: 'Subtract 3',
  alt: 'Add 3, then subtract 3, in turn',
};

/** W3 practice: one number with its rule shown, answer, Enter. */
export function ItemStep({ step, rel, focus, onResult }: StepProps) {
  const p = step.payload as { number: number; list: string };
  const onset = useRef(0);
  const first = useRef<number | null>(null);
  const t = useTyped(() => (first.current ??= now()));
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void afterPaint().then((at) => (onset.current = at));
    input.current?.focus();
  }, []);

  const submit = () => {
    if (!t.value.trim()) return;
    onResult({
      kind: 'item',
      response: t.value,
      onsetMs: rel(onset.current),
      firstInputMs: first.current == null ? null : rel(first.current),
      submitMs: rel(now()),
      corrections: t.corrections.current,
      focusLostMs: focus.take(),
    });
  };

  return (
    <div className="flex h-64 flex-col items-center justify-center gap-4">
      <p className="text-sm text-gray-500">{LIST_LABEL[p.list]}</p>
      <span className="font-mono text-6xl font-semibold text-gray-900">{p.number}</span>
      <input
        ref={input}
        aria-label="Your answer"
        inputMode="numeric"
        autoComplete="off"
        value={t.value}
        onChange={(e) => t.change(e.target.value, (s) => s.replace(/[^0-9-]/g, ''))}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        className="w-32 rounded-md border border-gray-300 px-3 py-2 text-center font-mono text-2xl"
      />
    </div>
  );
}

/** W3 timed list: 30 numbers, one at a time; Enter shows the next immediately. No cue for the operation. */
export function ListStep({ step, rel, focus, onResult }: StepProps) {
  const p = step.payload as { list: number; numbers: number[] };
  const [i, setI] = useState(0);
  const onset = useRef(0);
  const first = useRef<number | null>(null);
  const start = useRef(0);
  const responses = useRef<
    Array<{
      response: string;
      onsetMs: number;
      firstInputMs: number | null;
      submitMs: number;
      corrections: number;
    }>
  >([]);
  const t = useTyped(() => (first.current ??= now()));
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void afterPaint().then((at) => {
      onset.current = at;
      if (i === 0) start.current = at;
    });
    input.current?.focus();
  }, [i]);

  const enter = () => {
    if (!t.value.trim()) return; // empty Enter is ignored (no skipping)
    const at = now();
    responses.current.push({
      response: t.value,
      onsetMs: rel(onset.current),
      firstInputMs: first.current == null ? null : rel(first.current),
      submitMs: rel(at),
      corrections: t.corrections.current,
    });
    first.current = null;
    t.reset();
    if (i + 1 < p.numbers.length) setI(i + 1);
    else
      onResult({
        kind: 'list',
        responses: responses.current,
        startMs: rel(start.current),
        endMs: rel(at),
        focusLostMs: focus.take(),
      });
  };

  return (
    <div className="flex h-64 flex-col items-center justify-center gap-4">
      <span key={i} className="font-mono text-6xl font-semibold text-gray-900">
        {p.numbers[i]}
      </span>
      <input
        ref={input}
        aria-label="Your answer"
        inputMode="numeric"
        autoComplete="off"
        value={t.value}
        onChange={(e) => t.change(e.target.value, (s) => s.replace(/[^0-9-]/g, ''))}
        onKeyDown={(e) => e.key === 'Enter' && enter()}
        className="w-32 rounded-md border border-gray-300 px-3 py-2 text-center font-mono text-2xl"
      />
      <p className="text-xs text-gray-400">
        {i + 1} / {p.numbers.length}
      </p>
    </div>
  );
}

/** W5: the whole sentence with its final gap; one typed word; "Any word" after 15 s without input. */
export function SentenceStep({ step, rel, focus, onResult }: StepProps) {
  const p = step.payload as { sentence: string; promptAfterMs: number };
  const onset = useRef(0);
  const first = useRef<number | null>(null);
  const [prompted, setPrompted] = useState(false);
  const t = useTyped(() => (first.current ??= now()));
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void afterPaint().then((at) => (onset.current = at));
    input.current?.focus();
    const timer = setTimeout(() => {
      if (first.current == null) setPrompted(true);
    }, p.promptAfterMs);
    return () => clearTimeout(timer);
  }, [p.promptAfterMs]);

  const submit = () => {
    const word = t.value.trim();
    if (!word) return;
    onResult({
      kind: 'sentence',
      response: word,
      onsetMs: rel(onset.current),
      firstInputMs: first.current == null ? null : rel(first.current),
      submitMs: rel(now()),
      prompted,
      corrections: t.corrections.current,
      focusLostMs: focus.take(),
    });
  };

  return (
    <div className="flex h-64 flex-col items-center justify-center gap-5">
      <p className="max-w-2xl text-center text-2xl text-gray-900">
        {p.sentence.replace('___', '______')}
      </p>
      <input
        ref={input}
        aria-label="One word"
        autoComplete="off"
        spellCheck={false}
        value={t.value}
        onChange={(e) => t.change(e.target.value.replace(/\s/g, ''))}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        className="w-64 rounded-md border border-gray-300 px-3 py-2 text-center text-xl"
      />
      <p className={`h-5 text-sm font-medium text-amber-700 ${prompted ? '' : 'invisible'}`}>
        {ANY_WORD}
      </p>
    </div>
  );
}
