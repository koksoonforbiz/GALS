import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { Zap, Loader2, RefreshCw } from 'lucide-react';

type Mode = 'all' | 'first5' | 'none';

interface Config {
  id: string;
  courseId: string;
  mode: Mode;
  numberOfSets: number;
}

const MODE_OPTIONS: { value: Mode; label: string; description: string }[] = [
  {
    value: 'all',
    label: 'All pages',
    description: 'Pre-generate exercises for every page in each uploaded document.',
  },
  {
    value: 'first5',
    label: 'First 5 pages only',
    description: 'Pre-generate exercises for pages 1–5 only (lower API cost).',
  },
  {
    value: 'none',
    label: 'Disabled',
    description: 'Students wait for live LLM generation each time.',
  },
];

export function PreGenerationSettings({ courseId }: { courseId: string }) {
  const [form, setForm] = useState<{ mode: Mode; numberOfSets: number }>({
    mode: 'none',
    numberOfSets: 1,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  useEffect(() => {
    api
      .get<Config>(`/pre-generation/config/${courseId}`)
      .then((c) => setForm({ mode: c.mode as Mode, numberOfSets: c.numberOfSets }))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [courseId]);

  const handleRegenerate = async () => {
    if (
      !window.confirm(
        'Re-queue all exercises for every indexed document in this course? Existing done exercises will be reset and re-generated. This will consume LLM credits.',
      )
    )
      return;
    setIsRegenerating(true);
    try {
      const r = await api.post<{ queued: number; documents: number }>(
        `/pre-generation/regenerate-course?courseId=${encodeURIComponent(courseId)}`,
      );
      alert(
        `${r.queued} exercises queued across ${r.documents} document${r.documents !== 1 ? 's' : ''}. Check the Pre-Generated Content tab for progress.`,
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to queue re-generation');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaved(false);
    try {
      await api.patch(`/pre-generation/config/${courseId}`, form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // error
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 size={18} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Zap size={18} className="text-gray-600" />
          <h3 className="text-sm font-semibold text-gray-800">Instant Exercises</h3>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              form.mode !== 'none' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {form.mode !== 'none' ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <button
          onClick={() => void handleRegenerate()}
          disabled={isRegenerating || form.mode === 'none'}
          title={
            form.mode === 'none'
              ? 'Enable pre-generation first'
              : 'Re-queue all exercises for every indexed document'
          }
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-md transition-colors"
        >
          {isRegenerating ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <RefreshCw size={13} />
          )}
          {isRegenerating ? 'Queuing…' : 'Re-generate All'}
        </button>
      </div>

      <p className="text-xs text-gray-500">
        Pre-generate learning exercises in the background when a document is uploaded. Students get
        instant responses instead of waiting for the AI.
      </p>

      {/* Mode selector */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-gray-600">Pages to pre-generate</p>
        <div className="flex flex-col gap-2">
          {MODE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="radio"
                name="pregenMode"
                value={opt.value}
                checked={form.mode === opt.value}
                onChange={() => setForm({ ...form, mode: opt.value })}
                className="mt-0.5 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="text-sm text-gray-800 font-medium">{opt.label}</span>
                <p className="text-xs text-gray-500 mt-0.5">{opt.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Number of sets — only shown when enabled */}
      {form.mode !== 'none' && (
        <div className="pl-1 border-l-2 border-blue-100 space-y-1.5">
          <p className="text-xs font-medium text-gray-600">Exercise sets per page</p>
          <p className="text-xs text-gray-500">
            Generate N independent sets per page per strategy, so students get variety across
            visits.
          </p>
          <div className="flex gap-2">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setForm({ ...form, numberOfSets: n })}
                className={`w-10 h-10 rounded-lg border text-sm font-medium transition-colors ${
                  form.numberOfSets === n
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'border-gray-300 text-gray-700 hover:border-blue-400'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">
            Note: higher sets = more LLM API calls per upload.
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        {saved && <span className="text-xs text-green-600">Saved!</span>}
      </div>
    </div>
  );
}
