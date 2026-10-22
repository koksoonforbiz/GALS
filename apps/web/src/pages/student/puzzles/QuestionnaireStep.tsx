import { useEffect, useRef, useState } from 'react';
import type { PuzzleQuestionItem, PuzzleQuestionSection } from '@ats/shared';
import { api, ApiError } from '../../../lib/api';
import type { OccasionView } from './PuzzlesPage';

interface QuestionnaireData {
  title: string;
  footer: string;
  sections: PuzzleQuestionSection[];
  answers: Record<string, unknown>;
}

type ChoiceValue = { option?: string; other?: string; describe?: string; when?: string };

/** "About you and how you feel today": one page per section, every item autosaved. */
export function QuestionnaireStep({
  occasionId,
  part,
  onSubmitted,
}: {
  occasionId: string;
  part: 'before' | 'after';
  onSubmitted: (v: OccasionView) => void;
}) {
  const [data, setData] = useState<QuestionnaireData | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    void api
      .get<QuestionnaireData>(`/puzzles/occasions/${occasionId}/questionnaire?part=${part}`)
      .then((d) => {
        setData(d);
        setValues(d.answers);
      });
  }, [occasionId, part]);

  const save = (code: string, value: unknown, delay = 0) => {
    setValues((v) => ({ ...v, [code]: value }));
    clearTimeout(timers.current[code]);
    timers.current[code] = setTimeout(async () => {
      try {
        await api.put(`/puzzles/occasions/${occasionId}/answers/${code}`, { value });
        setErrors(({ [code]: _gone, ...rest }) => rest);
      } catch (err) {
        setErrors((e) => ({ ...e, [code]: err instanceof ApiError ? err.message : 'Not saved' }));
      }
    }, delay);
  };

  if (!data) return <p className="text-sm text-gray-500">Loading…</p>;
  const section = data.sections[page]!;
  const last = page === data.sections.length - 1;
  const sectionComplete = section.items.every(
    (i) => values[i.code] !== undefined && !errors[i.code],
  );

  const submit = async () => {
    setSubmitting(true);
    setMessage('');
    try {
      onSubmitted(
        await api.post<OccasionView>(`/puzzles/occasions/${occasionId}/questionnaire/submit`, {
          part,
        }),
      );
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not submit. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      {part === 'before' && (
        <p className="text-xs uppercase tracking-wide text-gray-400">{data.title}</p>
      )}
      <h2 className="mt-1 text-lg font-semibold text-gray-900">{section.heading}</h2>
      {section.instructions && <p className="mt-2 text-sm text-gray-700">{section.instructions}</p>}
      <p className="mt-1 text-xs text-gray-400">
        Part {page + 1} of {data.sections.length}. Your answers are saved as you go.
      </p>

      <ol className="mt-5 space-y-5">
        {section.items.map((item) => (
          <li key={item.code}>
            <Question item={item} value={values[item.code]} onChange={save} />
            {errors[item.code] && <p className="mt-1 text-xs text-red-600">{errors[item.code]}</p>}
          </li>
        ))}
      </ol>

      {section.attribution && (
        <p className="mt-6 text-[10px] text-gray-400">{section.attribution}</p>
      )}
      {part === 'before' && last && <p className="mt-4 text-xs text-gray-500">{data.footer}</p>}
      {message && <p className="mt-4 text-sm text-red-600">{message}</p>}

      <div className="mt-6 flex gap-3">
        {page > 0 && (
          <button
            onClick={() => setPage(page - 1)}
            className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50"
          >
            Back
          </button>
        )}
        <button
          disabled={!sectionComplete || submitting}
          onClick={() => (last ? void submit() : setPage(page + 1))}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {last ? (submitting ? 'Saving…' : 'Continue') : 'Next'}
        </button>
      </div>
    </div>
  );
}

function Question({
  item,
  value,
  onChange,
}: {
  item: PuzzleQuestionItem;
  value: unknown;
  onChange: (code: string, value: unknown, delay?: number) => void;
}) {
  const label = <p className="text-sm font-medium text-gray-800">{item.text}</p>;
  const input = 'mt-1 rounded-md border border-gray-300 px-2 py-1 text-sm';

  if (item.type === 'number') {
    return (
      <div>
        {label}
        <input
          type="number"
          className={`${input} w-28`}
          min={item.min}
          max={item.max}
          step={item.step ?? 1}
          defaultValue={typeof value === 'number' ? value : ''}
          onChange={(e) =>
            e.target.value !== '' && onChange(item.code, Number(e.target.value), 600)
          }
        />{' '}
        <span className="text-sm text-gray-500">{item.unit}</span>
      </div>
    );
  }
  if (item.type === 'text') {
    return (
      <div>
        {label}
        <input
          className={`${input} w-full max-w-md`}
          defaultValue={typeof value === 'string' ? value : ''}
          onChange={(e) => e.target.value.trim() && onChange(item.code, e.target.value, 800)}
        />
      </div>
    );
  }
  if (item.type === 'text2') {
    const v = (value ?? {}) as { first?: string; second?: string };
    const set = (k: 'first' | 'second', s: string) => onChange(item.code, { ...v, [k]: s }, 800);
    return (
      <div>
        {label}
        <input
          className={`${input} w-full max-w-md`}
          defaultValue={v.first ?? ''}
          onChange={(e) => set('first', e.target.value)}
        />
        <p className="mt-2 text-sm text-gray-700">{item.secondText}</p>
        <input
          className={`${input} w-full max-w-md`}
          defaultValue={v.second ?? ''}
          onChange={(e) => set('second', e.target.value)}
        />
      </div>
    );
  }
  if (item.type === 'scale') {
    const labels = item.scaleLabels;
    const points = Array.from({ length: item.max! - item.min! + 1 }, (_, i) => item.min! + i);
    return (
      <div>
        {label}
        <div className="mt-2 flex flex-wrap items-center gap-1" role="radiogroup">
          {!labels && <span className="mr-1 text-xs text-gray-500">{item.lowLabel}</span>}
          {points.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={value === p}
              onClick={() => onChange(item.code, p)}
              className={`rounded-md border px-2.5 py-1 text-sm ${
                value === p
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-300 hover:bg-gray-50'
              }`}
              title={labels?.[p - item.min!]}
            >
              {labels ? `${p} · ${labels[p - item.min!]}` : p}
            </button>
          ))}
          {!labels && <span className="ml-1 text-xs text-gray-500">{item.highLabel}</span>}
        </div>
      </div>
    );
  }
  // choice
  const v = (typeof value === 'object' && value ? value : {}) as ChoiceValue;
  const pick = (option: string) => onChange(item.code, { ...v, option });
  return (
    <div>
      {label}
      <div className="mt-2 space-y-1">
        {item.options!.map((o) => (
          <label key={o} className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="radio"
              name={item.code}
              checked={v.option === o}
              onChange={() => pick(o)}
            />
            {o}
            {o === item.otherOption && v.option === o && (
              <input
                className={`${input} ml-1`}
                defaultValue={v.other ?? ''}
                onChange={(e) =>
                  onChange(item.code, { ...v, option: o, other: e.target.value }, 800)
                }
              />
            )}
            {o === item.describeOption && v.option === o && (
              <input
                className={`${input} ml-1 w-72`}
                defaultValue={v.describe ?? ''}
                onChange={(e) =>
                  onChange(item.code, { ...v, option: o, describe: e.target.value }, 800)
                }
              />
            )}
          </label>
        ))}
        {item.followup && v.option && item.followup.when.includes(v.option) && (
          <label className="mt-1 block text-sm text-gray-700">
            {item.followup.text}{' '}
            <input
              className={input}
              defaultValue={v.when ?? ''}
              onChange={(e) => onChange(item.code, { ...v, when: e.target.value }, 800)}
            />
          </label>
        )}
      </div>
    </div>
  );
}
