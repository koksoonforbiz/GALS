import { useState } from 'react';
import { ChevronDown, ChevronUp, Video, Eye, Brain, Activity } from 'lucide-react';

interface BiometricsPanelProps {
  recording: { isActive: boolean; isUploading: boolean };
  pupilSize: { isActive: boolean; latestDiameter: number | null };
  webgazer: { isActive: boolean; isCalibrating: boolean; needsCalibration: boolean };
  isPyfeatEnabled: boolean;
}

/**
 * Unified floating panel (bottom-left) that shows all biometric feature
 * statuses in one collapsible widget.
 */
export function BiometricsPanel({
  recording,
  pupilSize,
  webgazer,
  isPyfeatEnabled,
}: BiometricsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Count active features for the collapsed badge
  const activeCount = [
    recording.isActive || recording.isUploading,
    pupilSize.isActive,
    webgazer.isActive || webgazer.isCalibrating || webgazer.needsCalibration,
    isPyfeatEnabled,
  ].filter(Boolean).length;

  // Nothing to show
  if (activeCount === 0) return null;

  // Collapsed state — small pill
  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 left-4 z-[90] flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-900/90 backdrop-blur border border-gray-700 text-white text-xs shadow-lg hover:bg-gray-800 transition-colors"
        title="Expand biometrics panel"
      >
        <Activity size={12} className="text-green-400" />
        <span className="tabular-nums">{activeCount} active</span>
        <ChevronUp size={12} className="text-gray-400" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-[90] w-56 rounded-lg bg-gray-900/90 backdrop-blur border border-gray-700 shadow-lg text-white text-xs overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(true)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-800/80 hover:bg-gray-800 transition-colors"
      >
        <span className="font-medium flex items-center gap-1.5">
          <Activity size={12} className="text-green-400" />
          Biometrics
        </span>
        <ChevronDown size={12} className="text-gray-400" />
      </button>

      {/* Feature rows */}
      <div className="px-3 py-2 space-y-2">
        {/* Recording */}
        {(recording.isActive || recording.isUploading) && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Video size={11} className="text-red-400" />
              <span className="text-gray-300">Recording</span>
            </div>
            <div className="flex items-center gap-1">
              <span
                className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                  recording.isUploading ? 'bg-orange-500' : 'bg-red-500'
                }`}
              />
              <span className="text-gray-400">
                {recording.isUploading ? 'Uploading' : 'Active'}
              </span>
            </div>
          </div>
        )}

        {/* Eye tracking */}
        {(webgazer.isActive || webgazer.isCalibrating || webgazer.needsCalibration) && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Eye size={11} className="text-green-400" />
              <span className="text-gray-300">Eye tracking</span>
            </div>
            <div className="flex items-center gap-1">
              <span
                className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                  webgazer.isCalibrating
                    ? 'bg-yellow-500'
                    : webgazer.needsCalibration
                      ? 'bg-red-500'
                      : 'bg-green-500'
                }`}
              />
              <span className="text-gray-400">
                {webgazer.isCalibrating
                  ? 'Calibrating'
                  : webgazer.needsCalibration
                    ? 'Needs cal.'
                    : 'Active'}
              </span>
            </div>
          </div>
        )}

        {/* Pupil size */}
        {pupilSize.isActive && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Eye size={11} className="text-violet-400" />
              <span className="text-gray-300">Pupil size</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-mono tabular-nums text-violet-300">
                {pupilSize.latestDiameter !== null
                  ? `${pupilSize.latestDiameter.toFixed(1)}px`
                  : '---'}
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
            </div>
          </div>
        )}

        {/* AU extraction */}
        {isPyfeatEnabled && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Brain size={11} className="text-amber-400" />
              <span className="text-gray-300">AU extraction</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-gray-400">Enabled</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
