import { useEffect, useRef } from 'react';
import { segmentAt, type WebcamSeg } from './lookup';

/**
 * Webcam <video> kept time-synced to the scrubber. Picks the segment covering
 * the playhead and seeks to `currentAbsoluteMs - segment.startWallMs`. Drift is
 * corrected when it exceeds ~0.25s. Defensive throughout.
 */
export function WebcamPanel(props: { segments: WebcamSeg[]; absoluteMs: number; playing: boolean }) {
  const { segments, absoluteMs, playing } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const seg = segmentAt(segments, absoluteMs);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !seg) return;
    const targetSec = (absoluteMs - seg.startWallMs) / 1000;
    try {
      if (Math.abs(video.currentTime - targetSec) > 0.25) video.currentTime = Math.max(0, targetSec);
      if (playing && video.paused) void video.play().catch(() => {});
      if (!playing && !video.paused) video.pause();
    } catch {
      /* never block */
    }
  }, [absoluteMs, playing, seg?.segmentId]);

  if (!seg) {
    return (
      <div className="flex h-40 items-center justify-center rounded border border-slate-200 bg-slate-900 text-sm text-slate-400">
        No camera for this moment
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      src={seg.url ?? undefined}
      muted
      playsInline
      className="w-full rounded bg-black"
      style={{ maxHeight: 220 }}
    />
  );
}
