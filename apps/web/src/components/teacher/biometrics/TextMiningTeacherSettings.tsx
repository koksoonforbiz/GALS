import { useState, useEffect } from 'react';
import { api } from '../../../lib/api';
import { Sparkles, Loader2, Info } from 'lucide-react';

interface EfTeacherSettings {
  id: string;
  teacherId: string;
  rollingWindowN: number;
  detectionConcurrency: number;
  disableLowFeasibility: boolean;
  pauseIngestion: boolean;
  detectionProviderOverride: string | null;
  detectionModelOverride: string | null;
}

export function TextMiningTeacherSettings() {
  const [settings, setSettings] = useState<EfTeacherSettings | null>(null);
  const [form, setForm] = useState({
    rollingWindowN: 5,
    detectionConcurrency: 6,
    disableLowFeasibility: false,
    pauseIngestion: false,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get<EfTeacherSettings>(`/text-mining/teacher-settings`)
      .then((s) => {
        setSettings(s);
        setForm({
          rollingWindowN: s.rollingWindowN,
          detectionConcurrency: s.detectionConcurrency,
          disableLowFeasibility: s.disableLowFeasibility,
          pauseIngestion: s.pauseIngestion,
        });
      })
      .catch(() => {
        // Settings will be auto-created on first read; default form values stand in.
      })
      .finally(() => setIsLoading(false));
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setSaved(false);
    try {
      const updated = await api.put<EfTeacherSettings>(`/text-mining/teacher-settings`, form);
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // API layer surfaces errors via toast.
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
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={18} className="text-gray-600" />
        <h3 className="text-sm font-semibold text-gray-800">
          Text-mining EF Detection (teacher settings)
        </h3>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            form.pauseIngestion ? 'bg-gray-100 text-gray-500' : 'bg-green-100 text-green-700'
          }`}
        >
          {form.pauseIngestion ? 'Paused' : 'Active'}
        </span>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
        <Info size={14} className="text-blue-600 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-blue-800">
          These settings live on your teacher account and apply to{' '}
          <strong>all courses you teach</strong>, not just this one. Per-course prompt overrides
          live in the course's prompt-tuning page.
        </p>
      </div>

      <p className="text-xs text-gray-500">
        Detects executive-function constructs (metacognition, attention, working memory load,
        cognitive flexibility, confusion, frustration, engagement, boredom) on every student
        dialogue message using your configured LLM.
      </p>

      {/* Pause toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <div className="relative">
          <input
            type="checkbox"
            checked={form.pauseIngestion}
            onChange={(e) => setForm({ ...form, pauseIngestion: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-gray-200 peer-checked:bg-amber-500 rounded-full transition-colors" />
          <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform" />
        </div>
        <span className="text-sm text-gray-700">
          Pause ingestion
          <span className="text-xs text-gray-400 ml-1">(no LLM calls; existing data kept)</span>
        </span>
      </label>

      {/* Disable low feasibility */}
      <label className="flex items-center gap-3 cursor-pointer">
        <div className="relative">
          <input
            type="checkbox"
            checked={form.disableLowFeasibility}
            onChange={(e) => setForm({ ...form, disableLowFeasibility: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-gray-200 peer-checked:bg-blue-600 rounded-full transition-colors" />
          <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform" />
        </div>
        <span className="text-sm text-gray-700">
          Skip low-feasibility constructs
          <span className="text-xs text-gray-400 ml-1">
            (drops attention/working-memory/cognitive-flexibility/boredom — saves ~⅔ of LLM cost)
          </span>
        </span>
      </label>

      {/* Rolling window N */}
      <div>
        <label className="block text-sm text-gray-700 mb-1">
          Rolling window: <span className="font-mono">{form.rollingWindowN}</span> messages
        </label>
        <input
          type="range"
          min={1}
          max={20}
          step={1}
          value={form.rollingWindowN}
          onChange={(e) => setForm({ ...form, rollingWindowN: parseInt(e.target.value, 10) })}
          className="w-48"
        />
        <p className="text-xs text-gray-400 mt-0.5">
          How many of the most recent detections per construct the dashboard rolls up. Larger
          windows smooth noise but lag behind shifts in the student's state.
        </p>
      </div>

      {/* Detection concurrency */}
      <div>
        <label className="block text-sm text-gray-700 mb-1">
          Detection concurrency: <span className="font-mono">{form.detectionConcurrency}</span>
        </label>
        <input
          type="range"
          min={1}
          max={9}
          step={1}
          value={form.detectionConcurrency}
          onChange={(e) => setForm({ ...form, detectionConcurrency: parseInt(e.target.value, 10) })}
          className="w-48"
        />
        <p className="text-xs text-gray-400 mt-0.5">
          How many constructs the engine runs in parallel per message. 6 (default) keeps total
          latency under ~3s on most LLMs without hammering rate limits.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        {saved && <span className="text-xs text-green-600">Saved!</span>}
        {settings?.detectionProviderOverride && (
          <span className="text-xs text-gray-400">
            Provider override: {settings.detectionProviderOverride}/
            {settings.detectionModelOverride ?? '(default)'}
          </span>
        )}
      </div>
    </div>
  );
}
