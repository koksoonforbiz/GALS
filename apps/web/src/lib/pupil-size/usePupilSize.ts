import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../api';
import { mediaStreamRegistry } from '../biometrics/mediaStreamRegistry';

export interface PupilReading {
  timestamp: string;
  pupilDiameter: number;
}

interface PupilSizeConfig {
  isEnabled: boolean;
}

/**
 * SET Pupil Size Estimation hook.
 *
 * Captures webcam frames on a hidden canvas, estimates pupil diameter
 * at 2 Hz using simple thresholding + contour analysis, and flushes
 * batches of readings to the backend every 30 seconds.
 */
export function usePupilSize(
  courseId: string,
  sessionId: string,
  wallClockOffset: number,
): { isActive: boolean; latestDiameter: number | null } {
  const [isActive, setIsActive] = useState(false);
  const [latestDiameter, setLatestDiameter] = useState<number | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bufferRef = useRef<PupilReading[]>([]);

  const toWallTime = useCallback(
    (perfNow: number) => new Date(perfNow + wallClockOffset).toISOString(),
    [wallClockOffset],
  );

  const flushBuffer = useCallback(async () => {
    const readings = bufferRef.current.splice(0, bufferRef.current.length);
    if (readings.length === 0) return;
    try {
      await api.post('/pupil-size/logs', { sessionId, courseId, readings });
      console.log('[PupilSize] Flushed', readings.length, 'readings');
    } catch (err) {
      console.error('[PupilSize] Flush failed:', err);
      bufferRef.current.unshift(...readings);
    }
  }, [sessionId, courseId]);

  /**
   * Estimate pupil diameter from a grayscale frame using
   * simple threshold + largest dark blob analysis.
   */
  const estimatePupilDiameter = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number): number | null => {
      const imageData = ctx.getImageData(0, 0, w, h);
      const data: Uint8ClampedArray = imageData.data;

      // Convert to grayscale
      const gray = new Uint8Array(w * h);
      for (let i = 0; i < gray.length; i++) {
        const r = data[i * 4] ?? 0;
        const g = data[i * 4 + 1] ?? 0;
        const b = data[i * 4 + 2] ?? 0;
        gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      }

      // Focus on the centre of the frame (eye region is typically upper-center)
      const roiX = Math.floor(w * 0.2);
      const roiY = Math.floor(h * 0.15);
      const roiW = Math.floor(w * 0.6);
      const roiH = Math.floor(h * 0.4);

      // Adaptive threshold: pixels darker than mean - 30 in the ROI
      let sum = 0;
      let count = 0;
      for (let y = roiY; y < roiY + roiH; y++) {
        for (let x = roiX; x < roiX + roiW; x++) {
          sum += gray[y * w + x] ?? 0;
          count++;
        }
      }
      const mean = sum / count;
      const threshold = Math.max(mean - 30, 20);

      // Count dark pixels (potential pupil)
      let darkPixels = 0;
      for (let y = roiY; y < roiY + roiH; y++) {
        for (let x = roiX; x < roiX + roiW; x++) {
          if ((gray[y * w + x] ?? 255) < threshold) {
            darkPixels++;
          }
        }
      }

      if (darkPixels < 10) return null;

      // Approximate diameter: treat dark region as a circle
      const diameter = 2 * Math.sqrt(darkPixels / Math.PI);
      return Math.round(diameter * 100) / 100;
    },
    [],
  );

  useEffect(() => {
    if (!courseId || !sessionId) return;

    let cancelled = false;
    let samplingStarted = false;
    let unsubRegistry: (() => void) | null = null;

    // Create hidden canvas once; the video element is from the borrowed stream.
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    canvas.style.display = 'none';
    document.body.appendChild(canvas);
    canvasRef.current = canvas;

    function startSampling(video: HTMLVideoElement) {
      if (samplingStarted || cancelled) return;
      samplingStarted = true;
      setIsActive(true);

      const ctx = canvas.getContext('2d')!;

      // Sample at 2 Hz (every 500ms)
      intervalRef.current = setInterval(() => {
        if (video.readyState < 2) return;
        ctx.drawImage(video, 0, 0, 320, 240);
        const diameter = estimatePupilDiameter(ctx, 320, 240);
        if (diameter !== null) {
          setLatestDiameter(diameter);
          bufferRef.current.push({
            timestamp: toWallTime(performance.now()),
            pupilDiameter: diameter,
          });
        }
      }, 500);

      flushIntervalRef.current = setInterval(flushBuffer, 30000);
      console.log('[PupilSize] Active, sampling at 2 Hz (borrowed stream)');
    }

    // Borrow the first available stream from the registry (webgazer runs MediaPipe
    // at full resolution; recording has the gate-provided 640×480 stream). Either
    // is more than enough for 2-Hz pupil-size estimation — no need for a third
    // getUserMedia() call which would open a separate camera pipeline and cause lag.
    function tryBorrowStream() {
      if (samplingStarted || cancelled) return;
      const stream = mediaStreamRegistry.get('webgazer') ?? mediaStreamRegistry.get('recording');
      if (!stream || !stream.active) return;

      // Create a lightweight video element backed by the borrowed stream.
      // We never stop the stream's tracks — the owning hook manages lifetime.
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.style.display = 'none';
      document.body.appendChild(video);
      videoRef.current = video;
      streamRef.current = stream;

      video
        .play()
        .then(() => startSampling(video))
        .catch(() => {});
    }

    async function init() {
      try {
        const config = await api.get<PupilSizeConfig>(`/pupil-size/config/${courseId}`);
        if (!config.isEnabled || cancelled) return;

        // Try immediately — the recording stream may already be registered if
        // useWebcamRecording's effect ran first.
        tryBorrowStream();

        // Subscribe to registry changes so we pick up whichever hook registers
        // its stream last (webgazer, recording) regardless of async ordering.
        if (!samplingStarted) {
          unsubRegistry = mediaStreamRegistry.subscribe(tryBorrowStream);
        }
      } catch (err) {
        console.error('[PupilSize] Initialization failed:', err);
        setIsActive(false);
      }
    }

    void init();

    return () => {
      cancelled = true;
      unsubRegistry?.();
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (flushIntervalRef.current) clearInterval(flushIntervalRef.current);

      // Synchronous keepalive flush
      const remaining = bufferRef.current.splice(0, bufferRef.current.length);
      if (remaining.length > 0) {
        const token = localStorage.getItem('token');
        fetch('/api/pupil-size/logs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ sessionId, courseId, readings: remaining }),
          keepalive: true,
        }).catch(() => {});
      }

      // Stream is borrowed — do NOT stop its tracks. Just detach the video element.
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.remove();
        videoRef.current = null;
      }
      streamRef.current = null;
      // No mediaStreamRegistry.unregister — we never registered a 'pupil-size' stream.
      if (canvasRef.current) {
        canvasRef.current.remove();
        canvasRef.current = null;
      }
      setIsActive(false);
    };
  }, [courseId, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush remaining readings on page unload using fetch with keepalive (supports auth headers)
  useEffect(() => {
    const handleUnload = () => {
      const readings = bufferRef.current.splice(0, bufferRef.current.length);
      if (readings.length > 0) {
        const token = localStorage.getItem('token');
        fetch('/api/pupil-size/logs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ sessionId, courseId, readings }),
          keepalive: true,
        }).catch(() => {});
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [sessionId, courseId]);

  return { isActive, latestDiameter };
}
