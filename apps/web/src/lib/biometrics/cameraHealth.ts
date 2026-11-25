import { useEffect, useRef, useState } from 'react';

/**
 * Is the webcam actually giving us a picture?
 *
 *  - 'off':     the camera track ended (turned off, unplugged, permission
 *               revoked) or is muted (the OS / a privacy key stopped frames,
 *               or another app took the camera), or no frames arrive.
 *  - 'covered': frames arrive but are almost black and flat (lens covered,
 *               privacy shutter closed, or a very dark room), or one flat
 *               colour (a shutter or a "camera off" placeholder image).
 *
 * Runs entirely in the browser on a 32x24 thumbnail once a second; nothing
 * is uploaded. Debounced so a blink or a hand passing the lens does not flag.
 */
export type CameraProblem = 'off' | 'covered' | null;

const SAMPLE_MS = 1_000;
const FLAG_AFTER = 3; // consecutive bad samples before flagging
const CLEAR_AFTER = 2; // consecutive good samples before clearing
const NO_STREAM_AFTER = 6; // grace while the recorder (re)starts the camera
const W = 32;
const H = 24;

export interface FrameStats {
  mean: number; // average luma, 0-255
  std: number; // luma standard deviation
}

/** Luma statistics of the current video frame, or null when there is no frame yet. */
export function frameStats(video: HTMLVideoElement, canvas: HTMLCanvasElement): FrameStats | null {
  if (video.readyState < 2 || !video.videoWidth) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);
  let sum = 0;
  let sq = 0;
  const n = W * H;
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
    sum += y;
    sq += y * y;
  }
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
}

/** Dark and flat (covered lens / shutter / very dark room), or one flat colour. */
export function looksCovered({ mean, std }: FrameStats): boolean {
  return (mean < 28 && std < 10) || std < 4;
}

function trackProblem(stream: MediaStream | null): 'off' | null {
  const t = stream?.getVideoTracks()[0];
  if (!t || t.readyState === 'ended' || t.muted || !t.enabled) return 'off';
  return null;
}

export interface CameraHealth {
  problem: CameraProblem;
  /** A good picture has been seen since the stream (re)started. */
  verified: boolean;
}

/**
 * Watch a camera stream. `enabled` false (no stream expected) reports no problem.
 * A null stream while enabled is reported as 'off' after a start-up grace.
 */
export function useCameraHealth(stream: MediaStream | null, enabled: boolean): CameraHealth {
  const [problem, setProblem] = useState<CameraProblem>(null);
  const [verified, setVerified] = useState(false);
  const bad = useRef(0);
  const good = useRef(0);
  const pending = useRef<CameraProblem>(null);

  useEffect(() => {
    bad.current = 0;
    good.current = 0;
    pending.current = null;
    setVerified(false);
    if (!enabled) {
      setProblem(null);
      return;
    }
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    if (stream) {
      video.srcObject = stream;
      void video.play().catch(() => {});
    }

    const sample = () => {
      let now: CameraProblem = stream ? trackProblem(stream) : 'off';
      if (!now) {
        const stats = frameStats(video, canvas);
        now = stats === null ? 'off' : looksCovered(stats) ? 'covered' : null;
      }
      if (now) {
        good.current = 0;
        bad.current = pending.current === now ? bad.current + 1 : 1;
        pending.current = now;
        if (bad.current >= (stream ? FLAG_AFTER : NO_STREAM_AFTER)) setProblem(now);
      } else {
        bad.current = 0;
        pending.current = null;
        good.current += 1;
        if (good.current >= CLEAR_AFTER) {
          setProblem(null);
          setVerified(true);
        }
      }
    };

    // Track events are immediate; the timer catches covered lenses and stalls.
    const t = stream?.getVideoTracks()[0];
    const onOff = () => {
      good.current = 0;
      setProblem('off');
    };
    t?.addEventListener('ended', onOff);
    t?.addEventListener('mute', onOff);
    const timer = setInterval(sample, SAMPLE_MS);
    return () => {
      clearInterval(timer);
      t?.removeEventListener('ended', onOff);
      t?.removeEventListener('mute', onOff);
      video.pause();
      video.srcObject = null;
    };
  }, [stream, enabled]);

  return { problem, verified };
}
