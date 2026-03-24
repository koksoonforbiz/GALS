import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../api';
import { mediaStreamRegistry } from '../biometrics/mediaStreamRegistry';

/**
 * Load WebGazer.js dynamically via script tag.
 * Falls back gracefully if the script cannot be loaded.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadWebgazerScript(): Promise<any | null> {
  // If already loaded globally
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).webgazer) return Promise.resolve((window as any).webgazer);

  return new Promise((resolve) => {
    const existing = document.querySelector('script[data-webgazer]');
    if (existing) {
      // Script tag exists but may still be loading
      existing.addEventListener('load', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolve((window as any).webgazer ?? null);
      });
      existing.addEventListener('error', () => resolve(null));
      return;
    }

    const script = document.createElement('script');
    script.src = '/webgazer.js'; // Served from apps/web/public/webgazer.js
    script.setAttribute('data-webgazer', 'true');
    script.async = true;
    script.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolve((window as any).webgazer ?? null);
    };
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
}

interface WebgazerConfig {
  isEnabled: boolean;
  calibrationOnNewSession: boolean;
  inactivityTimeoutSecs: number;
  recalibrationEnabled: boolean;
}

interface GazeReading {
  timestamp: string;
  gazeX: number;
  gazeY: number;
  confidence: number | null;
  pageUrl: string;
}

export function useWebgazer(
  courseId: string,
  sessionId: string,
  wallClockOffset: number,
): {
  isActive: boolean;
  isCalibrating: boolean;
  needsCalibration: boolean;
  showGazeDot: boolean;
  triggerCalibration: () => void;
  completeCalibration: () => void;
  skipCalibration: () => void;
  toggleGazeDot: () => void;
  trainOnPoint: (screenX: number, screenY: number) => void;
  getCurrentPrediction: () => Promise<{ x: number; y: number } | null>;
  latestGaze: { x: number; y: number } | null;
  config: WebgazerConfig | null;
} {
  const [isActive, setIsActive] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [needsCalibration, setNeedsCalibration] = useState(false);
  const [showGazeDot, setShowGazeDot] = useState(false);
  const [latestGaze, setLatestGaze] = useState<{ x: number; y: number } | null>(null);
  const [config, setConfig] = useState<WebgazerConfig | null>(null);

  const bufferRef = useRef<GazeReading[]>([]);
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGazeTimeRef = useRef(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webgazerRef = useRef<any>(null);

  const toWallTime = useCallback(
    (perfNow: number) => new Date(perfNow + wallClockOffset).toISOString(),
    [wallClockOffset],
  );

  const flushBuffer = useCallback(async () => {
    const readings = bufferRef.current.splice(0, bufferRef.current.length);
    if (readings.length === 0) return;
    try {
      await api.post('/webgazer/logs', { sessionId, courseId, readings });
      console.log('[WebGazer] Flushed', readings.length, 'gaze readings');
    } catch (err) {
      console.error('[WebGazer] Flush failed:', err);
      bufferRef.current.unshift(...readings);
    }
  }, [sessionId, courseId]);

  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    if (!config?.recalibrationEnabled) return;

    inactivityTimerRef.current = setTimeout(
      () => {
        setNeedsCalibration(true);
      },
      (config?.inactivityTimeoutSecs ?? 1800) * 1000,
    );
  }, [config]);

  const triggerCalibration = useCallback(() => {
    setIsCalibrating(true);
    setNeedsCalibration(false);
  }, []);

  const completeCalibration = useCallback(() => {
    setIsCalibrating(false);
    setNeedsCalibration(false);
  }, []);

  const skipCalibration = useCallback(() => {
    setIsCalibrating(false);
    setNeedsCalibration(false);
  }, []);

  /** Toggle the red gaze-prediction dot on/off. */
  const toggleGazeDot = useCallback(() => {
    setShowGazeDot((prev) => {
      const next = !prev;
      const dot = document.getElementById('webgazerGazeDot');
      if (dot) dot.style.display = next ? 'block' : 'none';
      return next;
    });
  }, []);

  /** Feed a known screen position into WebGazer's regression model. */
  const trainOnPoint = useCallback((screenX: number, screenY: number) => {
    try {
      webgazerRef.current?.recordScreenPosition(screenX, screenY, 'click');
    } catch {
      // WebGazer may not be ready yet
    }
  }, []);

  /** Get WebGazer's current gaze prediction (for accuracy testing). */
  const getCurrentPrediction = useCallback(
    (): Promise<{ x: number; y: number } | null> =>
      new Promise((resolve) => {
        try {
          const wg = webgazerRef.current;
          if (!wg) return resolve(null);
          wg.getCurrentPrediction()
            .then((pred: { x: number; y: number } | null) => resolve(pred))
            .catch(() => resolve(null));
        } catch {
          resolve(null);
        }
      }),
    [],
  );

  useEffect(() => {
    if (!courseId || !sessionId) return;

    let cancelled = false;

    async function start() {
      try {
        const cfg = await api.get<WebgazerConfig>(`/webgazer/config/${courseId}`);
        console.log('[WebGazer] Config loaded:', cfg);
        if (!cfg.isEnabled || cancelled) return;
        setConfig(cfg);

        // Dynamically load WebGazer via script tag (not available as npm package)
        const loadedWg = await loadWebgazerScript();
        if (!loadedWg || cancelled) return;
        webgazerRef.current = loadedWg;

        const wg = webgazerRef.current;
        wg.setRegression('weightedRidge');
        wg.saveDataAcrossSessions(false);

        // Set absolute path for MediaPipe face_mesh WASM assets
        // (default relative path './mediapipe/face_mesh' breaks on non-root pages)
        wg.params.faceMeshSolutionPath = '/mediapipe/face_mesh';

        // Enable internal video + face overlay (needed for face tracking)
        // but we'll remove the container from DOM after begin()
        wg.showVideo(true);
        wg.showFaceOverlay(true);
        wg.showFaceFeedbackBox(true);

        await wg.begin();
        if (cancelled) {
          wg.end();
          return;
        }

        // Register WebGazer's video stream in the shared registry
        try {
          const videoEl = document.getElementById('webgazerVideoFeed') as HTMLVideoElement | undefined;
          const stream = videoEl?.srcObject as MediaStream | null;
          if (stream) {
            mediaStreamRegistry.register('webgazer', stream);
          }
        } catch {
          // Video element may not exist yet
        }

        // Hide WebGazer's default UI from view but keep elements in DOM
        // (WebGazer's internal face tracking loop needs its video + canvas elements)
        const wgContainer = document.getElementById('webgazerVideoContainer');
        if (wgContainer) {
          wgContainer.style.position = 'fixed';
          wgContainer.style.left = '-9999px';
          wgContainer.style.top = '-9999px';
          wgContainer.style.width = '1px';
          wgContainer.style.height = '1px';
          wgContainer.style.overflow = 'hidden';
          wgContainer.style.opacity = '0';
          wgContainer.style.pointerEvents = 'none';
        }
        const wgGazeDot = document.getElementById('webgazerGazeDot');
        if (wgGazeDot) wgGazeDot.style.display = 'none';

        // Gaze listener throttled to 10 Hz (100ms) for better accuracy
        wg.setGazeListener(
          (data: { x: number; y: number; confidence?: number } | null, _timestamp: number) => {
            if (!data) return;
            const now = performance.now();
            if (now - lastGazeTimeRef.current < 100) return;
            lastGazeTimeRef.current = now;

            setLatestGaze({ x: data.x, y: data.y });
            bufferRef.current.push({
              timestamp: toWallTime(now),
              gazeX: data.x,
              gazeY: data.y,
              confidence: data.confidence ?? null,
              pageUrl: window.location.pathname,
            });

            // Auto-flush at 300 entries
            if (bufferRef.current.length >= 300) {
              flushBuffer();
            }
          },
        );

        setIsActive(true);
        console.log('[WebGazer] Active, calibrationOnNewSession:', cfg.calibrationOnNewSession);

        // If calibration on new session, prompt calibration
        if (cfg.calibrationOnNewSession) {
          console.log('[WebGazer] Triggering calibration for new session');
          setNeedsCalibration(true);
        }

        // Flush every 30 seconds
        flushIntervalRef.current = setInterval(flushBuffer, 30000);

        // Inactivity detection
        const resetTimer = () => resetInactivityTimer();
        for (const event of ['mousemove', 'keydown', 'scroll', 'click']) {
          document.addEventListener(event, resetTimer);
        }
        resetTimer();
      } catch (err) {
        console.error('[WebGazer] Initialization failed:', err);
        setIsActive(false);
      }
    }

    start();

    return () => {
      cancelled = true;
      if (flushIntervalRef.current) clearInterval(flushIntervalRef.current);
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      flushBuffer();

      try {
        webgazerRef.current?.end();
      } catch {
        // WebGazer may throw on cleanup
      }
      mediaStreamRegistry.unregister('webgazer');
      setIsActive(false);
    };
  }, [courseId, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up WebGazer on logout
  useEffect(() => {
    const handleLogout = () => {
      if (flushIntervalRef.current) clearInterval(flushIntervalRef.current);
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      flushBuffer();
      try {
        webgazerRef.current?.end();
      } catch {
        // WebGazer may throw on cleanup
      }
      mediaStreamRegistry.unregister('webgazer');
      setIsActive(false);
    };
    window.addEventListener('ats:logout', handleLogout);
    return () => window.removeEventListener('ats:logout', handleLogout);
  }, [flushBuffer]);

  // Flush remaining readings on page unload using fetch with keepalive (supports auth headers)
  useEffect(() => {
    const handleUnload = () => {
      const readings = bufferRef.current.splice(0, bufferRef.current.length);
      if (readings.length > 0) {
        const token = localStorage.getItem('token');
        fetch('/api/webgazer/logs', {
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

  return {
    isActive,
    isCalibrating,
    needsCalibration,
    showGazeDot,
    triggerCalibration,
    completeCalibration,
    skipCalibration,
    toggleGazeDot,
    trainOnPoint,
    getCurrentPrediction,
    latestGaze,
    config,
  };
}
