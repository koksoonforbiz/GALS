interface RecordingIndicatorProps {
  isActive: boolean;
  isUploading: boolean;
}

export function RecordingIndicator({ isActive, isUploading }: RecordingIndicatorProps) {
  if (!isActive && !isUploading) return null;

  return (
    <div
      className="fixed top-3 right-3 z-50 flex items-center gap-2 px-2.5 py-1.5 rounded-full shadow-lg bg-white/90 border border-gray-200 text-xs"
      title={
        isUploading
          ? 'Uploading recording segment...'
          : 'Session is being recorded for learning analytics'
      }
    >
      <span
        className={`w-2.5 h-2.5 rounded-full ${
          isUploading ? 'bg-orange-500 animate-pulse' : 'bg-red-500 animate-pulse'
        }`}
      />
      <span className="text-gray-600 font-medium">
        {isUploading ? 'Uploading...' : 'Recording'}
      </span>
    </div>
  );
}
