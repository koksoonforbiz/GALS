import { useState, useEffect } from 'react';
import { api } from '../../../lib/api';
import { Brain, Loader2 } from 'lucide-react';

interface PyfeatConfig {
  id: string;
  courseId: string;
  isEnabled: boolean;
  extractionFps: number;
  enabledAus: string[];
  detectorBackend: string;
  auPredictor: string;
}

const ALL_AUS = [
  'AU01',
  'AU02',
  'AU04',
  'AU05',
  'AU06',
  'AU07',
  'AU09',
  'AU10',
  'AU12',
  'AU14',
  'AU15',
  'AU17',
  'AU20',
  'AU23',
  'AU24',
  'AU25',
  'AU26',
  'AU28',
];

const AU_LABELS: Record<string, string> = {
  AU01: 'Inner Brow Raise',
  AU02: 'Outer Brow Raise',
  AU04: 'Brow Lowerer',
  AU05: 'Upper Lid Raiser',
  AU06: 'Cheek Raiser',
  AU07: 'Lid Tightener',
  AU09: 'Nose Wrinkler',
  AU10: 'Upper Lip Raiser',
  AU12: 'Lip Corner Puller',
  AU14: 'Dimpler',
  AU15: 'Lip Corner Depressor',
  AU17: 'Chin Raiser',
  AU20: 'Lip Stretcher',
  AU23: 'Lip Tightener',
  AU24: 'Lip Pressor',
  AU25: 'Lips Part',
  AU26: 'Jaw Drop',
  AU28: 'Lip Suck',
};

export function PyfeatSettings({ courseId }: { courseId: string }) {
  const [, setConfig] = useState<PyfeatConfig | null>(null);
  const [form, setForm] = useState({
    isEnabled: false,
    extractionFps: 1.0,
    enabledAus: ['AU01', 'AU04', 'AU06', 'AU07', 'AU12', 'AU17', 'AU25', 'AU26'],
    detectorBackend: 'retinaface' as string,
    auPredictor: 'xgb' as string,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get<PyfeatConfig>(`/pyfeat/config/${courseId}`)
      .then((c) => {
        setConfig(c);
        setForm({
          isEnabled: c.isEnabled,
          extractionFps: c.extractionFps,
          enabledAus: c.enabledAus,
          detectorBackend: c.detectorBackend,
          auPredictor: c.auPredictor,
        });
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [courseId]);

  const toggleAu = (au: string) => {
    setForm((prev) => ({
      ...prev,
      enabledAus: prev.enabledAus.includes(au)
        ? prev.enabledAus.filter((a) => a !== au)
        : [...prev.enabledAus, au],
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaved(false);
    try {
      const updated = await api.patch<PyfeatConfig>(`/pyfeat/config/${courseId}`, form);
      setConfig(updated);
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
      <div className="flex items-center gap-2 mb-2">
        <Brain size={18} className="text-gray-600" />
        <h3 className="text-sm font-semibold text-gray-800">py-feat AU Extraction</h3>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            form.isEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {form.isEnabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      <p className="text-xs text-gray-500">
        Extracts facial Action Units from recorded video segments asynchronously. Requires webcam
        recording to be enabled.
      </p>

      <label className="flex items-center gap-3 cursor-pointer">
        <div className="relative">
          <input
            type="checkbox"
            checked={form.isEnabled}
            onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-gray-200 peer-checked:bg-blue-600 rounded-full transition-colors" />
          <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform" />
        </div>
        <span className="text-sm text-gray-700">Enable py-feat processing</span>
      </label>

      {/* Extraction FPS */}
      <div>
        <label className="block text-sm text-gray-700 mb-1">
          Extraction FPS: <span className="font-mono">{form.extractionFps}</span>
        </label>
        <input
          type="range"
          min={0.5}
          max={5}
          step={0.5}
          value={form.extractionFps}
          onChange={(e) => setForm({ ...form, extractionFps: parseFloat(e.target.value) })}
          className="w-48"
        />
        <p className="text-xs text-gray-400 mt-0.5">
          Higher FPS increases processing time. 1 FPS is recommended.
        </p>
      </div>

      {/* Detector backend */}
      <div className="flex gap-4">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Detector backend</label>
          <select
            value={form.detectorBackend}
            onChange={(e) => setForm({ ...form, detectorBackend: e.target.value })}
            className="text-sm border border-gray-300 rounded-lg px-2 py-1"
          >
            <option value="retinaface">RetinaFace</option>
            <option value="mtcnn">MTCNN</option>
            <option value="img2pose">img2pose</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">AU predictor</label>
          <select
            value={form.auPredictor}
            onChange={(e) => setForm({ ...form, auPredictor: e.target.value })}
            className="text-sm border border-gray-300 rounded-lg px-2 py-1"
          >
            <option value="xgb">XGBoost</option>
            <option value="svm">SVM</option>
            <option value="logistic">Logistic</option>
          </select>
        </div>
      </div>

      {/* AU selection */}
      <div>
        <label className="block text-xs text-gray-600 mb-2">Enabled AUs</label>
        <div className="grid grid-cols-3 gap-1">
          {ALL_AUS.map((au) => (
            <label key={au} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={form.enabledAus.includes(au)}
                onChange={() => toggleAu(au)}
                className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600"
              />
              <span className="font-mono text-gray-700">{au}</span>
              <span className="text-gray-400 truncate">{AU_LABELS[au]}</span>
            </label>
          ))}
        </div>
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
      </div>
    </div>
  );
}
