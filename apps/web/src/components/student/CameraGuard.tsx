import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useActivityLog } from '../../lib/activity-log';
import { useCameraHealth, type CameraProblem } from '../../lib/biometrics/cameraHealth';

/**
 * Keeps the webcam on while it is being recorded. If the camera is turned
 * off, unplugged, taken by another app, covered, or the room is too dark,
 * the page is blocked (like the second-screen overlay) until the picture is
 * back. Recording, logging and the screen capture keep running underneath.
 * Logs CAMERA_BLOCKED / CAMERA_RESTORED (reason and duration only; no image).
 */
export function CameraGuard({
  courseId,
  stream,
  enabled,
  restart,
  error,
}: {
  courseId: string;
  stream: MediaStream | null;
  /** True while the webcam should be recording (course setting + consent). */
  enabled: boolean;
  restart: () => Promise<void>;
  error: string | null;
}) {
  const { problem } = useCameraHealth(stream, enabled);
  const { track } = useActivityLog();
  const since = useRef<{ reason: Exclude<CameraProblem, null>; at: number } | null>(null);

  useEffect(() => {
    if (problem && !since.current) {
      since.current = { reason: problem, at: Date.now() };
      track('CAMERA_BLOCKED', { courseId, metadata: { reason: problem } });
    } else if (!problem && since.current) {
      track('CAMERA_RESTORED', {
        courseId,
        metadata: { reason: since.current.reason, blockedMs: Date.now() - since.current.at },
      });
      since.current = null;
    }
  }, [problem]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!problem) return null;
  return <CameraOffOverlay problem={problem} stream={stream} restart={restart} error={error} />;
}

function CameraOffOverlay({
  problem,
  stream,
  restart,
  error,
}: {
  problem: Exclude<CameraProblem, null>;
  stream: MediaStream | null;
  restart: () => Promise<void>;
  error: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [busy, setBusy] = useState(false);

  // Make everything else inert (no Tab into the page underneath).
  useEffect(() => {
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    return () => root?.removeAttribute('inert');
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) void v.play().catch(() => {});
  }, [stream]);

  const live = stream?.getVideoTracks()[0]?.readyState === 'live';

  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-gray-900/90 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="camera-off-title"
      data-testid="camera-off-overlay"
      data-problem={problem}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl">
        <h2 id="camera-off-title" className="text-xl font-semibold text-gray-900">
          {problem === 'off' ? 'Please turn your camera back on' : 'Your camera looks covered'}
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          {problem === 'off'
            ? 'Your camera stopped sending a picture. It may have been turned off, unplugged, or taken by another app such as Teams or Zoom. Turn it on, then click the button below.'
            : 'We cannot see a picture from your camera. Open the camera cover or shutter, move anything in front of the lens, and turn on a light if the room is dark.'}
        </p>
        <p className="mt-2 text-sm text-gray-600">You can continue as soon as the camera works.</p>
        <div className="mx-auto mt-4 aspect-[4/3] w-48 overflow-hidden rounded-lg bg-gray-800">
          {live && (
            <video
              ref={videoRef}
              muted
              playsInline
              className="h-full w-full -scale-x-100 object-cover"
            />
          )}
        </div>
        {(problem === 'off' || !live) && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await restart();
              } finally {
                setBusy(false);
              }
            }}
            className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            data-testid="camera-restart"
          >
            {busy ? 'Starting the camera…' : 'Turn camera on'}
          </button>
        )}
        {error && problem === 'off' && (
          <p className="mt-3 text-xs text-red-600">
            {/NotAllowed|Permission/i.test(error)
              ? 'Camera access is blocked. Click the lock icon left of the web address, set Camera to "Allow", then click the button again. On Windows, also check Settings, Privacy & security, Camera.'
              : `The camera could not start (${error}).`}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
