import { useState } from 'react';
import { Camera, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';

interface RecordingConsentModalProps {
  courseId: string;
  onAccept: () => void;
  onDecline: () => void;
}

export function RecordingConsentModal({
  courseId,
  onAccept,
  onDecline,
}: RecordingConsentModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAccept = async () => {
    setIsSubmitting(true);
    try {
      await api.post(`/recording/consent/${courseId}`);
      onAccept();
    } catch {
      // still accept locally
      onAccept();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <Camera size={20} className="text-blue-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Recording Consent</h2>
        </div>

        <p className="text-sm text-gray-600 mb-3">
          This course uses webcam recording to support learning analytics. Your session will be
          recorded while you are actively learning.
        </p>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <div className="flex items-start gap-2">
            <ShieldCheck size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-blue-800">
              <p className="font-medium mb-1">Privacy protections:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>No audio is recorded</li>
                <li>Recordings are used only for learning analytics</li>
                <li>Recordings are automatically deleted after 180 days</li>
                <li>You can see when recording is active via the red indicator</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onDecline}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Decline
          </button>
          <button
            onClick={handleAccept}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : 'I Consent'}
          </button>
        </div>
      </div>
    </div>
  );
}
