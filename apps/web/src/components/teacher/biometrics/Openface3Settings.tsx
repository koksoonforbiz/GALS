import { useState, useEffect } from 'react';
import { api } from '../../../lib/api';
import { Smile, Loader2 } from 'lucide-react';

interface RecordingConfig {
  id: string;
  courseId: string;
  isEnabled: boolean;
  openface3Enabled: boolean;
  openface3ExtractionFps: number;
  openface3DetectorBackend: string;
  openface3RunOnNewSegments: boolean;
}

interface Openface3SettingsProps {
  courseId: string;
}

export function Openface3Settings({ courseId }: Openface3SettingsProps) {
  const [config, setConfig] = useState<RecordingConfig | null>(null);
  const [form, setForm] = useState({
    openface3Enabled: false,
    openface3ExtractionFps: 5,
    openface3DetectorBackend: 'retinaface',
    openface3RunOnNewSegments: true,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get<RecordingConfig>(`/recording/config/${courseId}`)
      .then((c) => {
        setConfig(c);
        setForm({
          openface3Enabled: c.openface3Enabled,
          openface3ExtractionFps: c.openface3ExtractionFps,
          openface3DetectorBackend: c.openface3DetectorBackend,
          openface3RunOnNewSegments: c.openface3RunOnNewSegments,
        });
      })
      .catch(() => {
        // Recording config may not exist yet; keep defaults.
      })
      .finally(() => setIsLoading(false));
  }, [courseId]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaved(false);
    try {
      const updated = await api.patch<RecordingConfig>(`/recording/config/${courseId}`, form);
      setConfig(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Errors are surfaced via the API layer's toast; nothing to do here.
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

  const recordingEnabled = config?.isEnabled === true;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Smile size={18} className="text-gray-600" />
        <h3 className="text-sm font-semibold text-gray-800">OpenFace 3 Emotion Detection</h3>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            form.openface3Enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {form.openface3Enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      <p className="text-xs text-gray-500">
        Extracts continuous emotion estimates (happiness, sadness, surprise, fear, anger, disgust,
        contempt, neutral) from recorded video segments using OpenFace 3. Runs in a separate worker
        process; results show up in the student log Biometrics tab once jobs complete. Requires
        webcam recording to be enabled.
      </p>

      {!recordingEnabled && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          Webcam recording is currently disabled for this course. Enable it above before turning on
          OpenFace 3 — without recordings there is nothing to process.
        </div>
      )}

      {/* Master toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <div className="relative">
          <input
            type="checkbox"
            checked={form.openface3Enabled}
            onChange={(e) => setForm({ ...form, openface3Enabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-gray-200 peer-checked:bg-blue-600 rounded-full transition-colors" />
          <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform" />
        </div>
        <span className="text-sm text-gray-700">Enable OpenFace 3 emotion detection</span>
      </label>

      {/* Auto-run on new segments */}
      <label className="flex items-center gap-3 cursor-pointer">
        <div className="relative">
          <input
            type="checkbox"
            checked={form.openface3RunOnNewSegments}
            onChange={(e) => setForm({ ...form, openface3RunOnNewSegments: e.target.checked })}
            className="sr-only peer"
            disabled={!form.openface3Enabled}
          />
          <div
            className={`w-9 h-5 bg-gray-200 peer-checked:bg-blue-600 rounded-full transition-colors ${
              !form.openface3Enabled ? 'opacity-50' : ''
            }`}
          />
          <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform" />
        </div>
        <span className="text-sm text-gray-700">
          Auto-enqueue every new recording segment
          <span className="text-xs text-gray-400 ml-1">(turn off to backfill manually)</span>
        </span>
      </label>

      {/* Extraction FPS */}
      <div>
        <label className="block text-sm text-gray-700 mb-1">
          Extraction FPS: <span className="font-mono">{form.openface3ExtractionFps}</span>
        </label>
        <input
          type="range"
          min={1}
          max={15}
          step={1}
          value={form.openface3ExtractionFps}
          onChange={(e) =>
            setForm({ ...form, openface3ExtractionFps: parseInt(e.target.value, 10) })
          }
          className="w-48"
          disabled={!form.openface3Enabled}
        />
        <p className="text-xs text-gray-400 mt-0.5">
          How many frames per second the worker samples. Higher FPS = finer-grained emotion timeline
          but longer processing. 5 FPS is a reasonable default.
        </p>
      </div>

      {/* Detector backend */}
      <div>
        <label className="block text-xs text-gray-600 mb-1">Face detector backend</label>
        <select
          value={form.openface3DetectorBackend}
          onChange={(e) => setForm({ ...form, openface3DetectorBackend: e.target.value })}
          className="text-sm border border-gray-300 rounded-lg px-2 py-1"
          disabled={!form.openface3Enabled}
        >
          <option value="retinaface">RetinaFace</option>
          <option value="mtcnn">MTCNN</option>
          <option value="img2pose">img2pose</option>
        </select>
      </div>

      {/* Save */}
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
