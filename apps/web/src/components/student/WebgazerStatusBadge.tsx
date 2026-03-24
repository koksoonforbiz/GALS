interface WebgazerStatusBadgeProps {
  isActive: boolean;
  isCalibrating: boolean;
  needsCalibration: boolean;
}

/**
 * Status badge showing WebGazer state:
 *   yellow = calibrating, green = active, red = needs recalibration, hidden = disabled
 */
export function WebgazerStatusBadge({
  isActive,
  isCalibrating,
  needsCalibration,
}: WebgazerStatusBadgeProps) {
  if (!isActive && !isCalibrating && !needsCalibration) return null;

  let color: string;
  let label: string;

  if (isCalibrating) {
    color = 'bg-yellow-500';
    label = 'Calibrating';
  } else if (needsCalibration) {
    color = 'bg-red-500';
    label = 'Needs calibration';
  } else {
    color = 'bg-green-500';
    label = 'Eye tracking active';
  }

  return (
    <div
      className="fixed bottom-4 left-4 z-[90] flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-gray-900/80 backdrop-blur border border-gray-700 text-white text-xs shadow-lg"
      title={label}
    >
      <span className={`w-2 h-2 rounded-full ${color} animate-pulse`} />
      <span className="text-gray-300">{label}</span>
    </div>
  );
}
