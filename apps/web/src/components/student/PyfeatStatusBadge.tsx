import { Brain } from 'lucide-react';

interface PyfeatStatusBadgeProps {
  isEnabled: boolean;
}

/**
 * Status badge showing py-feat AU extraction is enabled for this course.
 * Positioned bottom-left alongside the other biometric indicators.
 */
export function PyfeatStatusBadge({ isEnabled }: PyfeatStatusBadgeProps) {
  if (!isEnabled) return null;

  return (
    <div
      className="fixed bottom-4 left-[22rem] z-[90] flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-gray-900/80 backdrop-blur border border-gray-700 text-white text-xs shadow-lg"
      title="py-feat AU extraction enabled"
    >
      <Brain size={12} className="text-amber-400" />
      <span className="text-gray-400">AU extraction</span>
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
    </div>
  );
}
