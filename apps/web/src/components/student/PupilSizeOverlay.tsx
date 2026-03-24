import { Eye } from 'lucide-react';

interface PupilSizeOverlayProps {
  isActive: boolean;
  latestDiameter: number | null;
}

/**
 * Debug badge that shows real-time pupil size estimation.
 * Only rendered when pupil-size tracking is active.
 */
export function PupilSizeOverlay({ isActive, latestDiameter }: PupilSizeOverlayProps) {
  if (!isActive) return null;

  return (
    <div
      className="fixed bottom-4 left-48 z-[90] flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-gray-900/80 backdrop-blur border border-gray-700 text-white text-xs shadow-lg"
      title="Pupil size estimation (debug)"
    >
      <Eye size={12} className="text-violet-400" />
      <span className="text-gray-400">Pupil:</span>
      <span className="font-mono tabular-nums text-violet-300">
        {latestDiameter !== null ? `${latestDiameter.toFixed(1)} px` : '---'}
      </span>
      <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
    </div>
  );
}
