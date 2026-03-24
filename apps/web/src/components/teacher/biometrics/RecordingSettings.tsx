import { useState, useEffect } from 'react';
import { api } from '../../../lib/api';
import { Camera, AlertTriangle, Loader2 } from 'lucide-react';

interface RecordingConfig {
  id: string;
  courseId: string;
  isEnabled: boolean;
}

interface RecordingSettingsProps {
  courseId: string;
}

export function RecordingSettings({ courseId }: RecordingSettingsProps) {
  const [config, setConfig] = useState<RecordingConfig | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get<RecordingConfig>(`/recording/config/${courseId}`)
      .then((c) => {
        setConfig(c);
        setIsEnabled(c.isEnabled);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [courseId]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaved(false);
    try {
      const updated = await api.patch<RecordingConfig>(`/recording/config/${courseId}`, {
        isEnabled,
      });
      setConfig(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // error handled silently
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Camera size={18} className="text-gray-600" />
        <h3 className="text-sm font-semibold text-gray-800">Webcam Recording</h3>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            isEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {isEnabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      {/* Privacy warning */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
        <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-amber-800">
          Enabling this feature will record video of students during learning sessions. Ensure
          students have been informed and have consented per your institution&apos;s policies.
          Recordings are automatically deleted after 180 days.
        </p>
      </div>

      {/* Toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <div className="relative">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => setIsEnabled(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-gray-200 peer-checked:bg-blue-600 rounded-full transition-colors" />
          <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform" />
        </div>
        <span className="text-sm text-gray-700">Enable webcam recording for this course</span>
      </label>

      {/* Save */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={isSaving || isEnabled === config?.isEnabled}
          className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        {saved && <span className="text-xs text-green-600">Saved!</span>}
      </div>
    </div>
  );
}
