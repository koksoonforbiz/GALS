import { useRef, useState, useCallback, useEffect, type RefObject } from 'react';
import {
  PERMISSION_SESSION_KEY,
  setPermittedScreenStream,
  setPermittedWebcamStream,
  clearPermittedScreenStream,
} from '../../lib/biometrics/permittedStreams';

type Status = 'idle' | 'requesting' | 'active' | 'denied';

interface Props {
  onGranted: () => void;
}

export function PermissionGate({ onGranted }: Props) {
  const [screenStatus, setScreenStatus] = useState<Status>('idle');
  const [webcamStatus, setWebcamStatus] = useState<Status>('idle');
  const [screenError, setScreenError] = useState<string | null>(null);
  const [webcamError, setWebcamError] = useState<string | null>(null);

  const screenStreamRef = useRef<MediaStream | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const grantedRef = useRef(false);

  // Cleanup: stop streams only when the gate is dismissed WITHOUT granting
  // (user navigated away, or a forced unmount). If granted, the streams are
  // owned by the hooks — stopping them here would kill active recording.
  useEffect(() => {
    return () => {
      if (!grantedRef.current) {
        // Gate dismissed without granting — stop tracks AND clear the module
        // slot so the replay recorder doesn't pick up a stale reference.
        clearPermittedScreenStream();
        screenStreamRef.current?.getTracks().forEach((t) => t.stop());
        webcamStreamRef.current?.getTracks().forEach((t) => t.stop());
      }
      // Always detach srcObject so the video elements release their decoder
      if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
      if (webcamVideoRef.current) webcamVideoRef.current.srcObject = null;
    };
  }, []);

  const requestScreen = useCallback(async () => {
    // Stop and discard any previous attempt before retrying
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
    setScreenError(null);
    setScreenStatus('requesting');

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      screenStreamRef.current = stream;
      if (screenVideoRef.current) screenVideoRef.current.srcObject = stream;

      // If the student clicks the browser's "Stop sharing" button, treat as denied
      const track = stream.getVideoTracks()[0];
      if (track) {
        const onEnded = () => {
          if (grantedRef.current) return; // already transferred — hook handles this
          screenStreamRef.current = null;
          if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
          setScreenStatus('denied');
          setScreenError('Screen sharing was stopped. Click "Try Again" to share again.');
        };
        track.addEventListener('ended', onEnded);
      }

      setScreenStatus('active');
    } catch {
      setScreenStatus('denied');
      setScreenError(
        'Screen sharing was denied. Click "Try Again" and allow access when prompted.',
      );
    }
  }, []);

  const requestWebcam = useCallback(async () => {
    webcamStreamRef.current?.getTracks().forEach((t) => t.stop());
    webcamStreamRef.current = null;
    if (webcamVideoRef.current) webcamVideoRef.current.srcObject = null;
    setWebcamError(null);
    setWebcamStatus('requesting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, frameRate: 15 },
        audio: false,
      });
      webcamStreamRef.current = stream;
      if (webcamVideoRef.current) webcamVideoRef.current.srcObject = stream;
      setWebcamStatus('active');
    } catch {
      setWebcamStatus('denied');
      setWebcamError('Camera access was denied. Click "Try Again" and allow access when prompted.');
    }
  }, []);

  const handleContinue = useCallback(() => {
    const screen = screenStreamRef.current;
    const webcam = webcamStreamRef.current;
    if (!screen || !webcam) return;

    // Transfer ownership to hooks BEFORE unmounting gate
    grantedRef.current = true;
    setPermittedScreenStream(screen); // broadcast to useSessionReplayRecorder immediately
    setPermittedWebcamStream(webcam); // stored for useWebcamRecording to take on mount
    sessionStorage.setItem(PERMISSION_SESSION_KEY, '1');
    onGranted(); // triggers BiometricsWrapper to unmount gate and mount course content
  }, [onGranted]);

  const bothActive = screenStatus === 'active' && webcamStatus === 'active';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg space-y-6 rounded-2xl bg-white p-8 shadow-2xl">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Before you begin</h2>
          <p className="mt-1 text-sm text-gray-500">
            Screen sharing and your webcam must be active before you can proceed.
          </p>
        </div>

        <PermRow
          label="Screen sharing"
          description="Share your entire screen or a browser window."
          status={screenStatus}
          error={screenError}
          videoRef={screenVideoRef as RefObject<HTMLVideoElement>}
          onRequest={requestScreen}
        />

        <PermRow
          label="Webcam"
          description="Allow camera access so your face is visible."
          status={webcamStatus}
          error={webcamError}
          videoRef={webcamVideoRef as RefObject<HTMLVideoElement>}
          onRequest={requestWebcam}
          mirrorVideo
        />

        <button
          disabled={!bothActive}
          onClick={handleContinue}
          className="w-full rounded-xl py-3 text-sm font-medium transition-colors
            disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400
            enabled:bg-blue-600 enabled:text-white enabled:hover:bg-blue-700"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: Status }) {
  const base =
    'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold';
  if (status === 'active') return <span className={`${base} bg-green-100 text-green-600`}>✓</span>;
  if (status === 'denied') return <span className={`${base} bg-red-100 text-red-600`}>✗</span>;
  if (status === 'requesting')
    return <span className={`${base} animate-pulse bg-yellow-100 text-yellow-600`}>…</span>;
  return <span className={`${base} bg-gray-100 text-gray-400`}>○</span>;
}

function PermRow({
  label,
  description,
  status,
  error,
  videoRef,
  onRequest,
  mirrorVideo = false,
}: {
  label: string;
  description: string;
  status: Status;
  error: string | null;
  videoRef: RefObject<HTMLVideoElement>;
  onRequest: () => void;
  mirrorVideo?: boolean;
}) {
  const actionLabel =
    status === 'idle' ? `Enable ${label}` : status === 'denied' ? 'Try Again' : null;

  return (
    <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <StatusDot status={status} />
          <div>
            <p className="text-sm font-medium text-gray-900">{label}</p>
            <p className="text-xs text-gray-500">{description}</p>
          </div>
        </div>

        {actionLabel && (
          <button
            onClick={onRequest}
            className="flex-shrink-0 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100"
          >
            {actionLabel}
          </button>
        )}
        {status === 'requesting' && (
          <span className="flex-shrink-0 animate-pulse text-xs text-gray-400">
            Waiting for permission…
          </span>
        )}
      </div>

      {/* Video preview — always mounted so the ref is populated before the stream
          arrives; visibility toggled via height + opacity so no layout jank. */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{ transform: mirrorVideo ? 'scaleX(-1)' : undefined }}
        className={`w-full rounded-lg bg-black object-cover transition-all duration-300 ${
          status === 'active' ? 'h-36 opacity-100' : 'h-0 opacity-0'
        }`}
      />

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
