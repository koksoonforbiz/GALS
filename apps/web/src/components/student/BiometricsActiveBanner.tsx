import { Eye, X } from 'lucide-react';
import { useState } from 'react';

interface BiometricsActiveBannerProps {
  activeFeatures: string[]; // e.g. ['Recording', 'Pupil tracking', 'Eye tracking']
}

export function BiometricsActiveBanner({ activeFeatures }: BiometricsActiveBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || activeFeatures.length === 0) return null;

  const featureText =
    activeFeatures.length === 1
      ? activeFeatures[0]
      : activeFeatures.length === 2
        ? `${activeFeatures[0]} and ${activeFeatures[1]}`
        : `${activeFeatures.slice(0, -1).join(', ')}, and ${activeFeatures[activeFeatures.length - 1]}`;

  return (
    <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center justify-between text-xs text-blue-800">
      <div className="flex items-center gap-2">
        <Eye size={14} className="text-blue-600 flex-shrink-0" />
        <span>
          <span className="font-medium">{featureText}</span>
          {activeFeatures.length === 1 ? ' is' : ' are'} active for this course.
        </span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-blue-500 hover:text-blue-700 p-0.5"
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
