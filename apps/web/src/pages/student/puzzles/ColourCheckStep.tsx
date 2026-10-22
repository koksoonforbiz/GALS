import { useMemo, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import type { OccasionView } from './PuzzlesPage';

type Colour = 'red' | 'green' | 'blue';
// Battery ink colours (ef.py \definecolor inkred/inkgreen/inkblue).
const INK: Record<Colour, string> = {
  red: 'rgb(200,30,30)',
  green: 'rgb(20,140,60)',
  blue: 'rgb(30,70,200)',
};
const LABELS: Colour[] = ['red', 'green', 'blue']; // fixed label order

/** Name three colour patches (order randomised per visit). No feedback either way. */
export function ColourCheckStep({
  occasionId,
  onDone,
}: {
  occasionId: string;
  onDone: (v: OccasionView) => void;
}) {
  const order = useMemo<Colour[]>(() => {
    const a: Colour[] = ['red', 'green', 'blue'];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }, []);
  const [chosen, setChosen] = useState<Partial<Record<number, Colour>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setSaving(true);
    try {
      onDone(
        await api.post<OccasionView>(`/puzzles/occasions/${occasionId}/colour-check`, {
          answers: order.map((shown, i) => ({ shown, chosen: chosen[i] })),
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-gray-900">Colours</h2>
      <p className="mt-1 text-sm text-gray-700">
        What colour is each patch? Click the name under each one.
      </p>
      <div className="mt-6 grid grid-cols-3 gap-6">
        {order.map((c, i) => (
          <div key={c} className="flex flex-col items-center gap-3">
            <div
              className="h-24 w-24 rounded-md"
              style={{ background: INK[c] }}
              aria-label={`patch ${i + 1}`}
            />
            <div className="flex gap-1">
              {LABELS.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setChosen((x) => ({ ...x, [i]: l }))}
                  className={`rounded-md border px-2 py-1 text-sm capitalize ${
                    chosen[i] === l
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      <button
        disabled={order.some((_, i) => !chosen[i]) || saving}
        onClick={() => void submit()}
        className="mt-6 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Continue'}
      </button>
    </div>
  );
}
