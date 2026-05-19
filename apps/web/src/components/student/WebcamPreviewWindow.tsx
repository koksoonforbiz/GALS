import { useState, useRef, useEffect, useCallback } from 'react';
import { Minimize2, Maximize2, X, Video, Eye, EyeOff } from 'lucide-react';
import { mediaStreamRegistry } from '../../lib/biometrics/mediaStreamRegistry';

interface WebcamPreviewWindowProps {
  showGazeDot?: boolean;
  onToggleGazeDot?: () => void;
}

/**
 * Floating draggable window that shows the live webcam feed
 * with WebGazer's face-detection bounding box overlay.
 */
export function WebcamPreviewWindow({ showGazeDot, onToggleGazeDot }: WebcamPreviewWindowProps = {}) {
  const [isOpen, setIsOpen] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [hasStream, setHasStream] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 16, y: 64 });

  // Staleness detection: if positions don't change for N frames, face is gone
  const prevPosHashRef = useRef<string>('');
  const staleCountRef = useRef(0);
  const STALE_THRESHOLD = 8; // frames of identical positions before declaring "no face"

  // Attach webcam stream to video element
  const attachStream = useCallback(() => {
    const stream =
      mediaStreamRegistry.get('webgazer') ??
      mediaStreamRegistry.get('recording') ??
      mediaStreamRegistry.get('pupil-size');
    if (stream && videoRef.current) {
      if (videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setHasStream(true);
    } else {
      setHasStream(false);
      if (videoRef.current) videoRef.current.srcObject = null;
    }
  }, []);

  // Re-attach stream when component becomes visible (open + not minimized)
  useEffect(() => {
    if (!isOpen || isMinimized) return;
    // Small delay to let refs settle after render
    const t = setTimeout(attachStream, 50);
    return () => clearTimeout(t);
  }, [isOpen, isMinimized, attachStream]);

  // Subscribe to stream registry changes
  useEffect(() => {
    attachStream();
    const unsub = mediaStreamRegistry.subscribe(attachStream);
    return () => {
      unsub();
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [attachStream]);

  // Draw video frame + face detection bounding box onto canvas
  useEffect(() => {
    if (isMinimized || !isOpen || !hasStream) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    const drawFrame = () => {
      if (!running || video.readyState < 2) {
        animFrameRef.current = requestAnimationFrame(drawFrame);
        return;
      }

      const w = canvas.width;
      const h = canvas.height;

      // Draw the video frame
      ctx.drawImage(video, 0, 0, w, h);

      // Use WebGazer's tracker to get face detection positions.
      // getPositions() returns stale (cached) data when the face leaves,
      // so we hash a few landmark coords each frame and detect staleness.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wg = (window as any).webgazer;
      let drewFace = false;

      if (wg) {
        try {
          const tracker = wg.getTracker?.();
          const positions = tracker?.getPositions?.();

          if (positions && positions.length > 0) {
            // Build a lightweight hash from a few sampled landmarks
            // to detect whether positions actually changed between frames.
            const sample = [0, 10, 50, 100, 200].map((i) => {
              const pt = positions[Math.min(i, positions.length - 1)];
              return pt ? `${pt[0]?.toFixed(1)},${pt[1]?.toFixed(1)}` : '';
            }).join('|');

            if (sample === prevPosHashRef.current) {
              staleCountRef.current += 1;
            } else {
              staleCountRef.current = 0;
              prevPosHashRef.current = sample;
            }

            // Only draw if positions are fresh (changing between frames)
            if (staleCountRef.current < STALE_THRESHOLD) {
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (const pt of positions) {
                if (pt && pt.length >= 2) {
                  if (pt[0] < minX) minX = pt[0];
                  if (pt[0] > maxX) maxX = pt[0];
                  if (pt[1] < minY) minY = pt[1];
                  if (pt[1] > maxY) maxY = pt[1];
                }
              }

              if (minX < Infinity && maxX > -Infinity) {
                const srcW = video.videoWidth || 640;
                const srcH = video.videoHeight || 480;
                const scaleX = w / srcW;
                const scaleY = h / srcH;

                const pad = 15;
                const bx = Math.max(0, (minX - pad) * scaleX);
                const by = Math.max(0, (minY - pad) * scaleY);
                const bw = Math.min(w - bx, (maxX - minX + pad * 2) * scaleX);
                const bh = Math.min(h - by, (maxY - minY + pad * 2) * scaleY);

                ctx.strokeStyle = '#22c55e';
                ctx.lineWidth = 2;
                ctx.strokeRect(bx, by, bw, bh);

                ctx.fillStyle = '#22c55e';
                ctx.font = '10px sans-serif';
                ctx.fillText('Face detected', bx + 2, by - 4 > 0 ? by - 4 : by + 12);
                drewFace = true;
              }
            }
          } else {
            // Empty positions array — no face at all
            staleCountRef.current = STALE_THRESHOLD;
            prevPosHashRef.current = '';
          }
        } catch {
          // WebGazer may not be fully initialized
        }
      }

      setFaceDetected(drewFace);
      animFrameRef.current = requestAnimationFrame(drawFrame);
    };

    animFrameRef.current = requestAnimationFrame(drawFrame);

    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [isMinimized, isOpen, hasStream]);

  // Drag handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };

      const handleMouseMove = (e: MouseEvent) => {
        if (!dragRef.current) return;
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        const newX = Math.max(0, Math.min(window.innerWidth - 200, dragRef.current.origX + dx));
        const newY = Math.max(0, Math.min(window.innerHeight - 40, dragRef.current.origY + dy));
        setPos({ x: newX, y: newY });
      };

      const handleMouseUp = () => {
        dragRef.current = null;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [pos],
  );

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 left-4 z-[100] flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800 text-white text-xs shadow-lg hover:bg-gray-700 transition-colors"
        title="Show webcam preview"
      >
        <Video size={14} />
        Preview
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-[100] shadow-2xl rounded-lg overflow-hidden bg-gray-900 border border-gray-700"
      style={{ left: pos.x, top: pos.y, width: isMinimized ? 200 : 240 }}
    >
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-2 py-1 bg-gray-800 cursor-move select-none"
        onMouseDown={handleMouseDown}
      >
        <span className="text-[10px] text-gray-300 font-medium flex items-center gap-1">
          <Video size={10} />
          Webcam Preview
        </span>
        <div className="flex items-center gap-0.5">
          {onToggleGazeDot && (
            <button
              onClick={onToggleGazeDot}
              className={`p-0.5 transition-colors ${showGazeDot ? 'text-green-400 hover:text-green-300' : 'text-gray-400 hover:text-white'}`}
              title={showGazeDot ? 'Hide gaze dot' : 'Show gaze dot'}
            >
              {showGazeDot ? <Eye size={10} /> : <EyeOff size={10} />}
            </button>
          )}
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-0.5 text-gray-400 hover:text-white transition-colors"
            title={isMinimized ? 'Expand' : 'Minimize'}
          >
            {isMinimized ? <Maximize2 size={10} /> : <Minimize2 size={10} />}
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-0.5 text-gray-400 hover:text-red-400 transition-colors"
            title="Close preview"
          >
            <X size={10} />
          </button>
        </div>
      </div>

      {/* Video area */}
      {!isMinimized && (
        <div className="relative bg-black" style={{ aspectRatio: '4/3' }}>
          {/* Hidden video element for streaming source */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover opacity-0 pointer-events-none"
          />
          {/* Canvas with face overlay */}
          <canvas ref={canvasRef} width={240} height={180} className="w-full h-full object-cover" />
          {!hasStream && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-xs">
              No active webcam
            </div>
          )}
          {hasStream && (
            <div className="absolute bottom-1 left-1 flex items-center gap-1">
              <span
                className={`w-1.5 h-1.5 rounded-full animate-pulse ${faceDetected ? 'bg-green-500' : 'bg-red-500'}`}
              />
              <span className="text-[9px] text-white/70">{faceDetected ? 'FACE OK' : 'NO FACE'}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
