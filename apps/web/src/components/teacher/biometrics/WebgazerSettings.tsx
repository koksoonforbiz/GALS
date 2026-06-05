import { useState, useEffect } from 'react';
import { api } from '../../../lib/api';
import { ScanEye, Loader2 } from 'lucide-react';

interface WebgazerConfig {
  id: string;
  courseId: string;
  isEnabled: boolean;
  eyeTrackerType: 'webgazer' | 'webeyetrack';
  calibrationOnNewSession: boolean;
  inactivityTimeoutSecs: number;
  recalibrationEnabled: boolean;
}

export function WebgazerSettings({ courseId }: { courseId: string }) {
  const [, setConfig] = useState<WebgazerConfig | null>(null);
  const [form, setForm] = useState({
    isEnabled: false,
    eyeTrackerType: 'webgazer' as 'webgazer' | 'webeyetrack',
    calibrationOnNewSession: true,
    recalibrationEnabled: true,
    inactivityTimeoutSecs: 1800,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get<WebgazerConfig>(`/webgazer/config/${courseId}`)
      .then((c) => {
        setConfig(c);
        setForm({
          isEnabled: c.isEnabled,
          eyeTrackerType: (c.eyeTrackerType as 'webgazer' | 'webeyetrack') ?? 'webgazer',
          calibrationOnNewSession: c.calibrationOnNewSession,
          recalibrationEnabled: c.recalibrationEnabled,
          inactivityTimeoutSecs: c.inactivityTimeoutSecs,
        });
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [courseId]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaved(false);
    try {
      const updated = await api.patch<WebgazerConfig>(`/webgazer/config/${courseId}`, form);
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
        <ScanEye size={18} className="text-gray-600" />
        <h3 className="text-sm font-semibold text-gray-800">Eye Tracking</h3>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            form.isEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {form.isEnabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      <div className="space-y-3">
        {/* Enable toggle */}
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
          <span className="text-sm text-gray-700">Enable eye tracking</span>
        </label>

        {/* Tracker type selector */}
        {form.isEnabled && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-gray-600">Tracker method</p>
            <div className="flex flex-col gap-2">
              <label className="flex items-start gap-2.5 cursor-pointer group">
                <input
                  type="radio"
                  name="eyeTrackerType"
                  value="webgazer"
                  checked={form.eyeTrackerType === 'webgazer'}
                  onChange={() => setForm({ ...form, eyeTrackerType: 'webgazer' })}
                  className="mt-0.5 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm text-gray-800 font-medium">WebGazer</span>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Regression-based. Requires a short calibration step at session start. Provides
                    confidence scores.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer group">
                <input
                  type="radio"
                  name="eyeTrackerType"
                  value="webeyetrack"
                  checked={form.eyeTrackerType === 'webeyetrack'}
                  onChange={() => setForm({ ...form, eyeTrackerType: 'webeyetrack' })}
                  className="mt-0.5 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm text-gray-800 font-medium">WebEyeTrack</span>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Model-based (RedForestAI). No calibration needed — tracking starts immediately.
                    Data format is identical to WebGazer.
                  </p>
                </div>
              </label>
            </div>
          </div>
        )}

        {/* Calibration options — only relevant for WebGazer */}
        {form.isEnabled && form.eyeTrackerType === 'webgazer' && (
          <div className="space-y-3 pl-1 border-l-2 border-blue-100">
            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={form.calibrationOnNewSession}
                  onChange={(e) => setForm({ ...form, calibrationOnNewSession: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 peer-checked:bg-blue-600 rounded-full transition-colors" />
                <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform" />
              </div>
              <span className="text-sm text-gray-700">Calibrate on new session</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={form.recalibrationEnabled}
                  onChange={(e) => setForm({ ...form, recalibrationEnabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 peer-checked:bg-blue-600 rounded-full transition-colors" />
                <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform" />
              </div>
              <span className="text-sm text-gray-700">Re-calibrate after inactivity</span>
            </label>

            <div>
              <label className="block text-sm text-gray-700 mb-1">
                Inactivity timeout (seconds)
              </label>
              <input
                type="number"
                min={300}
                max={7200}
                value={form.inactivityTimeoutSecs}
                onChange={(e) =>
                  setForm({ ...form, inactivityTimeoutSecs: parseInt(e.target.value, 10) || 1800 })
                }
                className="w-32 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1">Min: 300, Max: 7200</p>
            </div>
          </div>
        )}

        {/* WebEyeTrack note */}
        {form.isEnabled && form.eyeTrackerType === 'webeyetrack' && (
          <p className="text-xs text-gray-500 pl-1 border-l-2 border-green-200">
            No calibration needed. Tracking starts automatically when the student opens the course.
            Make sure <code className="font-mono bg-gray-100 px-1 rounded">webeyetrack.js</code> is
            present in <code className="font-mono bg-gray-100 px-1 rounded">apps/web/public/</code>.
          </p>
        )}
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
