import { useState, useRef, useEffect, useCallback } from 'react';
import { Minimize2, Maximize2, X, Video } from 'lucide-react';
import { mediaStreamRegistry } from '../../lib/biometrics/mediaStreamRegistry';

/**
 * Floating draggable window that shows the live webcam feed
 * with a face-detection bounding box overlay.
 */
export function WebcamPreviewWindow() {
  const [isOpen, setIsOpen] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [hasStream, setHasStream] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const posRef = useRef({ x: 16, y: 64 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 16, y: 64 });

  // Attach webcam stream to video element
  const attachStream = useCallback(() => {
    const stream = mediaStreamRegistry.get('recording') ?? mediaStreamRegistry.get('pupil-size');
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

  // Subscribe to stream registry changes
  useEffect(() => {
    attachStream();
    const unsub = mediaStreamRegistry.subscribe(attachStream);
    return () => {
      unsub();
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [attachStream]);

  // Face detection bounding box using lightweight skin-color detection
  useEffect(() => {
    if (isMinimized || !hasStream) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    const detect = () => {
      if (!running || video.readyState < 2) {
        animFrameRef.current = requestAnimationFrame(detect);
        return;
      }

      const w = canvas.width;
      const h = canvas.height;
      ctx.drawImage(video, 0, 0, w, h);

      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;

      // Simple skin-color detection to find face region
      let minX = w,
        minY = h,
        maxX = 0,
        maxY = 0;
      let skinPixels = 0;

      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          const i = (y * w + x) * 4;
          const r = data[i] ?? 0;
          const g = data[i + 1] ?? 0;
          const b = data[i + 2] ?? 0;

          // HSV-based skin detection heuristic
          if (r > 80 && g > 40 && b > 20 && r > g && r > b && r - g > 15 && Math.abs(r - g) < 150) {
            skinPixels++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      // Clear and redraw video frame
      ctx.drawImage(video, 0, 0, w, h);

      // Draw bounding box if enough skin pixels detected
      const boxW = maxX - minX;
      const boxH = maxY - minY;
      if (skinPixels > 200 && boxW > 20 && boxH > 20) {
        // Add some padding
        const pad = 8;
        const bx = Math.max(0, minX - pad);
        const by = Math.max(0, minY - pad);
        const bw = Math.min(w - bx, boxW + pad * 2);
        const bh = Math.min(h - by, boxH + pad * 2);

        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, by, bw, bh);

        // Label
        ctx.fillStyle = '#22c55e';
        ctx.font = '10px sans-serif';
        ctx.fillText('Face detected', bx + 2, by - 4 > 0 ? by - 4 : by + 12);
      }

      animFrameRef.current = requestAnimationFrame(detect);
    };

    animFrameRef.current = requestAnimationFrame(detect);

    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [isMinimized, hasStream]);

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
        posRef.current = { x: newX, y: newY };
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
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[9px] text-white/70">LIVE</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
