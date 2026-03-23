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

    async function start() {
      try {
        const config = await api.get<PupilSizeConfig>(`/pupil-size/config/${courseId}`);
        if (!config.isEnabled || cancelled) return;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, frameRate: 5 },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        mediaStreamRegistry.register('pupil-size', stream);

        // Create hidden video + canvas
        const video = document.createElement('video');
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.style.display = 'none';
        document.body.appendChild(video);
        videoRef.current = video;

        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 240;
        canvas.style.display = 'none';
        document.body.appendChild(canvas);
        canvasRef.current = canvas;

        await video.play();
        setIsActive(true);
        console.log('[PupilSize] Active, sampling at 2 Hz');

        const ctx = canvas.getContext('2d')!;

        // Sample at 2 Hz (every 500ms)
        intervalRef.current = setInterval(() => {
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

        // Flush every 30 seconds
        flushIntervalRef.current = setInterval(flushBuffer, 30000);
      } catch (err) {
        console.error('[PupilSize] Initialization failed:', err);
        setIsActive(false);
      }
    }

    start();

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (flushIntervalRef.current) clearInterval(flushIntervalRef.current);
      flushBuffer(); // Flush remaining

      streamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRegistry.unregister('pupil-size');
      if (videoRef.current) {
        videoRef.current.remove();
        videoRef.current = null;
      }
      if (canvasRef.current) {
        canvasRef.current.remove();
        canvasRef.current = null;
      }
      setIsActive(false);
    };
  }, [courseId, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // sendBeacon on page unload
  useEffect(() => {
    const handleUnload = () => {
      const readings = bufferRef.current.splice(0, bufferRef.current.length);
      if (readings.length > 0) {
        navigator.sendBeacon(
          '/api/pupil-size/logs',
          new Blob([JSON.stringify({ sessionId, courseId, readings })], {
            type: 'application/json',
          }),
        );
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [sessionId, courseId]);

  return { isActive, latestDiameter };
}
