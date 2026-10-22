import { useEffect, useRef, useState } from 'react';
import { afterPaint, now, untilTime } from '../timing';
import type { StepProps } from './types';

/**
 * W1 / W2: items appear one at a time in the centre (on/off ms from the
 * server, 800/200), then a typed answer. Each item's real on-screen time is
 * measured at paint and sent as `shownMs`. Only the current item is in the DOM.
 */
export function SequenceStep({ step, rel, focus, onResult }: StepProps) {
  const p = step.payload as { items: string[]; onMs: number; offMs: number };
  const digitsOnly = step.id.startsWith('w1');
  const [shown, setShown] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);
  const [value, setValue] = useState('');
  const marks = useRef({
    onset: 0,
    firstInput: null as number | null,
    corrections: 0,
    shown: [] as number[],
  });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await afterPaint();
      const start = now() + 300;
      await untilTime(start);
      for (let k = 0; k < p.items.length && !cancelled; k++) {
        const target = start + k * (p.onMs + p.offMs);
        await untilTime(target);
        setShown(p.items[k]!);
        const on = await afterPaint();
        if (k === 0) marks.current.onset = on;
        await untilTime(on + p.onMs);
        setShown(null);
        const off = await afterPaint();
        marks.current.shown.push(Math.round(off - on));
      }
      if (cancelled) return;
      await untilTime(now() + Math.max(0, p.offMs - 16));
      setAnswering(true);
      requestAnimationFrame(() => input.current?.focus());
    })();
    return () => {
      cancelled = true;
    };
  }, [p.items, p.onMs, p.offMs]);

  const submit = () => {
    if (!value.trim()) return;
    onResult({
      kind: 'sequence',
      response: value,
      onsetMs: rel(marks.current.onset),
      firstInputMs: marks.current.firstInput == null ? null : rel(marks.current.firstInput),
      submitMs: rel(now()),
      shownMs: marks.current.shown,
      corrections: marks.current.corrections,
      focusLostMs: focus.take(),
    });
  };

  if (!answering) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span
          className="font-mono text-7xl font-semibold text-gray-900"
          data-testid="sequence-item"
        >
          {shown ?? ''}
        </span>
      </div>
    );
  }
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3">
      <input
        ref={input}
        aria-label="Your answer"
        autoComplete="off"
        spellCheck={false}
        inputMode={digitsOnly ? 'numeric' : 'text'}
        value={value}
        onChange={(e) => {
          if (marks.current.firstInput == null) marks.current.firstInput = now();
          const v = digitsOnly ? e.target.value.replace(/[^0-9 ]/g, '') : e.target.value;
          if (v.length < value.length) marks.current.corrections++;
          setValue(v.slice(0, 32));
        }}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        className="w-80 rounded-md border border-gray-300 px-3 py-2 text-center font-mono text-2xl tracking-widest"
      />
      <p className="text-xs text-gray-500">Press Enter when you are done.</p>
    </div>
  );
}
