import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../api';
import { mediaStreamRegistry } from '../biometrics/mediaStreamRegistry';

// WebGazer is loaded via script tag (not available as npm package).
function loadWebgazerScript(): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any;
  if (win.webgazer) return Promise.resolve(win.webgazer);

  return new Promise((resolve) => {
    const existing = document.querySelector('script[data-webgazer]');
    if (existing) {
      existing.addEventListener('load', () => resolve(win.webgazer ?? null));
      existing.addEventListener('error', () => resolve(null));
      return;
    }
    const script = document.createElement('script');
    script.src = '/webgazer.js';
    script.setAttribute('data-webgazer', 'true');
    script.async = true;
    script.onload = () => resolve(win.webgazer ?? null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
}

interface EyeTrackingConfig {
  isEnabled: boolean;
  eyeTrackerType: 'webgazer' | 'webeyetrack';
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

/**
 * Unified eye-tracking hook. Reads eyeTrackerType from the course config and
 * initialises either WebGazer (calibration-based, script tag) or WebEyeTrack
 * (model-based npm package, no calibration). Both write to the same
 * /webgazer/logs endpoint so the data schema and teacher viewer are identical.
 *
 * WebEyeTrack model weights: copy the `web/` folder from
 * https://github.com/RedForestAI/WebEyeTrack/tree/main/js/examples/minimal-example/public
 * into apps/web/public/ before using WebEyeTrack.
 */
export function useEyeTracking(
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
  config: EyeTrackingConfig | null;
} {
  const [isActive, setIsActive] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [needsCalibration, setNeedsCalibration] = useState(false);
  const [showGazeDot, setShowGazeDot] = useState(false);
  const [latestGaze, setLatestGaze] = useState<{ x: number; y: number } | null>(null);
  const [config, setConfig] = useState<EyeTrackingConfig | null>(null);

  const bufferRef = useRef<GazeReading[]>([]);
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGazeTimeRef = useRef(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webgazerRef = useRef<any>(null);
  const webEyeTrackRef = useRef<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tracker: any;
    videoEl: HTMLVideoElement;
  } | null>(null);
  const configRef = useRef<EyeTrackingConfig | null>(null);

  const toWallTime = useCallback(
    (perfNow: number) => new Date(perfNow + wallClockOffset).toISOString(),
    [wallClockOffset],
  );

  const flushBuffer = useCallback(async () => {
    const readings = bufferRef.current.splice(0, bufferRef.current.length);
    if (readings.length === 0) return;
    try {
      await api.post('/webgazer/logs', { sessionId, courseId, readings });
    } catch {
      bufferRef.current.unshift(...readings);
    }
  }, [sessionId, courseId]);

  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    if (!configRef.current?.recalibrationEnabled) return;
    inactivityTimerRef.current = setTimeout(
      () => setNeedsCalibration(true),
      (configRef.current?.inactivityTimeoutSecs ?? 1800) * 1000,
    );
  }, []);

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

  const toggleGazeDot = useCallback(() => {
    setShowGazeDot((prev) => {
      const next = !prev;
      // WebGazer dot toggle (no-op for WebEyeTrack)
      const wg = webgazerRef.current;
      if (wg?.showPredictionPoints) wg.showPredictionPoints(next);
      const dot = document.getElementById('webgazerGazeDot');
      if (dot) dot.style.display = next ? 'block' : 'none';
      return next;
    });
  }, []);

  const trainOnPoint = useCallback((screenX: number, screenY: number) => {
    try {
      webgazerRef.current?.recordScreenPosition(screenX, screenY, 'click');
    } catch {
      // WebGazer may not be ready yet; no-op for WebEyeTrack
    }
  }, []);

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

  // Throttled sample handler shared by both trackers (10 Hz max).
  const onGazeSample = useCallback(
    (x: number, y: number, confidence: number | null) => {
      const now = performance.now();
      if (now - lastGazeTimeRef.current < 100) return;
      lastGazeTimeRef.current = now;
      setLatestGaze({ x, y });
      bufferRef.current.push({
        timestamp: toWallTime(now),
        gazeX: x,
        gazeY: y,
        confidence,
        pageUrl: window.location.pathname,
      });
      if (bufferRef.current.length >= 300) flushBuffer();
    },
    [toWallTime, flushBuffer],
  );

  useEffect(() => {
    if (!courseId || !sessionId) return;
    let cancelled = false;

    const resetTimer = () => resetInactivityTimer();

    async function start() {
      try {
        const cfg = await api.get<EyeTrackingConfig>(`/webgazer/config/${courseId}`);
        if (!cfg.isEnabled || cancelled) return;
        setConfig(cfg);
        configRef.current = cfg;

        if ((cfg.eyeTrackerType ?? 'webgazer') === 'webgazer') {
          await startWebGazer(cfg);
        } else {
          await startWebEyeTrack();
        }
      } catch (err) {
        console.error('[EyeTracking] Initialization failed:', err);
        setIsActive(false);
      }
    }

    async function startWebGazer(cfg: EyeTrackingConfig) {
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) {
          console.warn('[EyeTracking] WebGL not supported — WebGazer unavailable');
          return;
        }
      } catch {
        console.warn('[EyeTracking] WebGL detection failed');
      }

      const loadedWg = await loadWebgazerScript();
      if (!loadedWg || cancelled) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      webgazerRef.current = (window as any).webgazer;
      const wg = webgazerRef.current;
      if (!wg) return;

      wg.setRegression('weightedRidge');
      wg.saveDataAcrossSessions(false);
      wg.params.faceMeshSolutionPath = '/mediapipe/face_mesh';
      wg.showVideo(true);
      wg.showFaceOverlay(true);
      wg.showFaceFeedbackBox(true);

      await wg.begin();
      if (cancelled) {
        wg.end();
        return;
      }

      try {
        const videoEl = document.getElementById('webgazerVideoFeed') as HTMLVideoElement | null;
        const stream = videoEl?.srcObject as MediaStream | null;
        if (stream) mediaStreamRegistry.register('webgazer', stream);
      } catch (_e) {
        /* video element may not exist yet */
      }

      const wgContainer = document.getElementById('webgazerVideoContainer');
      if (wgContainer) {
        Object.assign(wgContainer.style, {
          position: 'fixed',
          left: '-9999px',
          top: '-9999px',
          width: '1px',
          height: '1px',
          overflow: 'hidden',
          opacity: '0',
          pointerEvents: 'none',
        });
      }
      wg.showPredictionPoints(false);
      const wgDot = document.getElementById('webgazerGazeDot');
      if (wgDot) wgDot.style.display = 'none';

      wg.setGazeListener((data: { x: number; y: number; confidence?: number } | null) => {
        if (!data) return;
        onGazeSample(data.x, data.y, data.confidence ?? null);
      });

      setIsActive(true);
      if (cfg.calibrationOnNewSession) setNeedsCalibration(true);
      flushIntervalRef.current = setInterval(flushBuffer, 30000);

      for (const ev of ['mousemove', 'keydown', 'scroll', 'click']) {
        document.addEventListener(ev, resetTimer);
      }
      resetTimer();
    }

    async function startWebEyeTrack() {
      // Dynamically imported so WebGazer users don't pay the bundle cost.
      // Requires model weights in public/web/ — see the comment at the top of this file.
      const { WebcamClient, WebEyeTrackProxy } = await import('webeyetrack');
      if (cancelled) return;

      // Create a hidden <video> element for WebcamClient.
      const videoEl = document.createElement('video');
      videoEl.id = 'webeyetrack-video';
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      Object.assign(videoEl.style, {
        position: 'fixed',
        left: '-9999px',
        top: '-9999px',
        width: '1px',
        height: '1px',
        opacity: '0',
        pointerEvents: 'none',
      });
      document.body.appendChild(videoEl);

      const webcamClient = new WebcamClient('webeyetrack-video');
      const tracker = new WebEyeTrackProxy(webcamClient);
      webEyeTrackRef.current = { tracker, videoEl };

      // Tracking starts as soon as onGazeResults is assigned — no start() needed.
      // normPog: [-0.5, 0.5] origin at screen centre → convert to pixel coords.
      // gazeState 'open'=1.0 / 'closed'=0.0 used as a confidence proxy.
      tracker.onGazeResults = (gazeResult: { normPog: number[]; gazeState: 'open' | 'closed' }) => {
        if (cancelled) return;
        const x = ((gazeResult.normPog[0] ?? 0) + 0.5) * window.innerWidth;
        const y = ((gazeResult.normPog[1] ?? 0) + 0.5) * window.innerHeight;
        const confidence = gazeResult.gazeState === 'open' ? 1.0 : 0.0;
        onGazeSample(x, y, confidence);
      };

      if (cancelled) return;
      setIsActive(true);
      // No calibration for WebEyeTrack.
      flushIntervalRef.current = setInterval(flushBuffer, 30000);
    }

    start();

    return () => {
      cancelled = true;
      for (const ev of ['mousemove', 'keydown', 'scroll', 'click']) {
        document.removeEventListener(ev, resetTimer);
      }
      if (flushIntervalRef.current) clearInterval(flushIntervalRef.current);
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);

      // Keepalive flush so no readings are lost on unmount.
      const buf = bufferRef.current;
      const remaining = buf.splice(0, buf.length);
      if (remaining.length > 0) {
        const token = localStorage.getItem('token');
        fetch('/api/webgazer/logs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ sessionId, courseId, readings: remaining }),
          keepalive: true,
        }).catch(() => {
          /* best-effort flush on unmount */
        });
      }

      try {
        webgazerRef.current?.end();
      } catch (_e) {
        /* WebGazer may already be stopped */
      }
      try {
        const wet = webEyeTrackRef.current;
        if (wet) {
          wet.tracker.onGazeResults = null;
          wet.tracker.destroy?.();
          wet.videoEl.remove();
        }
      } catch (_e) {
        /* tracker may already be destroyed */
      }
      mediaStreamRegistry.unregister('webgazer');
      setIsActive(false);
    };
  }, [courseId, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush on logout
  useEffect(() => {
    const handleLogout = () => {
      if (flushIntervalRef.current) clearInterval(flushIntervalRef.current);
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      const buffer = bufferRef.current;
      const remaining = buffer.splice(0, buffer.length);
      if (remaining.length > 0) {
        const token = localStorage.getItem('token');
        fetch('/api/webgazer/logs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ sessionId, courseId, readings: remaining }),
          keepalive: true,
        }).catch(() => {
          /* best-effort flush on logout */
        });
      }
      try {
        webgazerRef.current?.end();
      } catch (_e) {
        /* already stopped */
      }
      try {
        const wet = webEyeTrackRef.current;
        if (wet) {
          wet.tracker.onGazeResults = null;
          wet.videoEl.remove();
        }
      } catch (_e) {
        /* already destroyed */
      }
      mediaStreamRegistry.unregister('webgazer');
      setIsActive(false);
    };
    window.addEventListener('ats:logout', handleLogout);
    return () => window.removeEventListener('ats:logout', handleLogout);
  }, [flushBuffer]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush on page unload
  useEffect(() => {
    const handleUnload = () => {
      const unloadBuf = bufferRef.current;
      const readings = unloadBuf.splice(0, unloadBuf.length);
      if (readings.length === 0) return;
      const token = localStorage.getItem('token');
      fetch('/api/webgazer/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ sessionId, courseId, readings }),
        keepalive: true,
      }).catch(() => {
        /* best-effort flush on page unload */
      });
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
