import { useRef, useState, useCallback, useEffect, type ReactNode, type RefObject } from 'react';
import {
  PERMISSION_SESSION_KEY,
  setPermittedScreenStream,
  setPermittedWebcamStream,
  clearPermittedScreenStream,
} from '../../lib/biometrics/permittedStreams';
import { useAuth } from '../../contexts/AuthContext';
import { useExtendedDisplay } from '../../lib/screens';

type Status = 'idle' | 'requesting' | 'active' | 'denied';

// The screen recording must show the platform itself, so students share
// THIS tab. Chrome/Edge: `preferCurrentTab` turns the picker into a plain
// "share this tab?" prompt, and Capture Handle lets us confirm afterwards
// that the captured surface is this document (any other tab, window or
// screen is refused and the student is shown how to pick the right one).
const CAPTURE_HANDLE = 'gals-platform';
const TAB_TITLE = 'GALS'; // start of the tab title (student.html)

type CaptureHandle = { handle?: string; origin?: string } | null;
type ShareCheck = 'ok' | 'not-a-tab' | 'other-tab';

/** Tag this document so a capture of it can be recognised (no-op where unsupported). */
function tagThisTab() {
  const md = navigator.mediaDevices as
    | (MediaDevices & {
        setCaptureHandleConfig?: (c: {
          handle: string;
          exposeOrigin: boolean;
          permittedOrigins: string[];
        }) => void;
      })
    | undefined;
  try {
    md?.setCaptureHandleConfig?.({
      handle: CAPTURE_HANDLE,
      exposeOrigin: true,
      permittedOrigins: [window.location.origin],
    });
  } catch {
    // unsupported, or not the top-level document — checkShared falls back
  }
}

/** Is the shared surface this platform tab? */
function checkShared(track: MediaStreamTrack): ShareCheck {
  const surface = (track.getSettings() as { displaySurface?: string }).displaySurface;
  if (surface !== 'browser') return 'not-a-tab';
  const t = track as MediaStreamTrack & { getCaptureHandle?: () => CaptureHandle };
  // Without Capture Handle (e.g. Firefox) a tab is the best we can check.
  if (typeof t.getCaptureHandle !== 'function') return 'ok';
  return t.getCaptureHandle()?.handle === CAPTURE_HANDLE ? 'ok' : 'other-tab';
}

interface Props {
  onGranted: () => void;
}

export function PermissionGate({ onGranted }: Props) {
  const { logout } = useAuth();
  const [screenStatus, setScreenStatus] = useState<Status>('idle');
  const [webcamStatus, setWebcamStatus] = useState<Status>('idle');
  const [screenError, setScreenError] = useState<string | null>(null);
  const [webcamError, setWebcamError] = useState<string | null>(null);

  const screenStreamRef = useRef<MediaStream | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const grantedRef = useRef(false);
  const [wrongShare, setWrongShare] = useState(false);

  useEffect(tagThisTab, []);

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
        video: { displaySurface: 'browser' },
        audio: false,
        // Chrome/Edge hints (ignored elsewhere): offer this tab, hide whole
        // screens, and remove "share this tab instead" so the capture can't
        // be switched to another tab later.
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
        monitorTypeSurfaces: 'exclude',
      } as DisplayMediaStreamOptions);
      const shared = stream.getVideoTracks()[0];
      const check = shared ? checkShared(shared) : 'not-a-tab';
      if (check !== 'ok') {
        stream.getTracks().forEach((t) => t.stop());
        setWrongShare(true);
        setScreenStatus('denied');
        setScreenError(
          check === 'other-tab'
            ? `You shared a different tab. Share this tab ("${TAB_TITLE}") so the platform is recorded — see the steps below.`
            : `You shared a window or your whole screen. Share only this tab ("${TAB_TITLE}") — see the steps below.`,
        );
        return;
      }
      setWrongShare(false);
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
    } catch (err) {
      setScreenStatus('denied');
      // Keep the browser's reason: "denied" alone can't tell a cancelled
      // picker from a browser/OS that blocks screen capture outright.
      const name = err instanceof DOMException ? err.name : '';
      setScreenError(
        !navigator.mediaDevices?.getDisplayMedia
          ? 'This browser does not support screen sharing. Please use Chrome or Edge.'
          : name === 'NotAllowedError'
            ? `Screen sharing was cancelled. Click "Try Again" and share this tab ("${TAB_TITLE}") — see the steps below.`
            : `Screen sharing failed (${name || 'unknown error'}). Click "Try Again", or try Chrome or Edge.`,
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
    } catch (err) {
      setWebcamStatus('denied');
      // Name the real cause: a browser that remembers "Block" refuses without
      // prompting again, so a generic "denied" sends students round in circles.
      const name = err instanceof DOMException ? err.name : '';
      setWebcamError(
        !navigator.mediaDevices?.getUserMedia
          ? 'This browser cannot use the camera here. Please use Chrome or Edge.'
          : name === 'NotAllowedError'
            ? 'Camera access is blocked. Click the lock icon left of the web address, set Camera to "Allow", then reload the page. On Windows, also check Settings → Privacy & security → Camera.'
            : name === 'NotReadableError' || name === 'AbortError'
              ? 'The camera is being used by another app or tab (e.g. Teams or Zoom). Close it, then click "Try Again".'
              : name === 'NotFoundError' || name === 'OverconstrainedError'
                ? 'No camera was found. Connect a webcam, then click "Try Again".'
                : `The camera could not start (${name || 'unknown error'}). Click "Try Again", or try Chrome or Edge.`,
      );
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
  // Phones and tablets cannot share a browser tab at all.
  const canShareScreen = !!navigator.mediaDevices?.getDisplayMedia;
  // One screen only (study rule): a connected second display blocks entry.
  const extended = useExtendedDisplay() === true;

  // One click: share this tab (needs the click), then the camera (does not).
  const startAll = useCallback(async () => {
    if (!screenStreamRef.current) await requestScreen();
    if (screenStreamRef.current && !webcamStreamRef.current) await requestWebcam();
  }, [requestScreen, requestWebcam]);

  // Both granted on one screen → carry on without a second click.
  useEffect(() => {
    if (bothActive && !extended && !grantedRef.current) handleContinue();
  }, [bothActive, extended, handleContinue]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-gray-900/80 p-4 backdrop-blur-sm sm:items-center">
      <div className="my-auto w-full max-w-lg space-y-6 rounded-2xl bg-white p-8 shadow-2xl">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Before you begin</h2>
          <p className="mt-1 text-sm text-gray-500">
            Screen sharing and your webcam must be active before you can proceed.
          </p>
        </div>

        {extended && (
          <p
            className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800"
            data-testid="second-screen-block"
          >
            <strong>Disconnect your second screen.</strong> GALS must be used on one screen only.
            Unplug the external monitor (or switch your display to show on one screen only) — this
            page continues by itself once only one screen is connected.
          </p>
        )}

        {canShareScreen && !bothActive && (
          <button
            type="button"
            onClick={() => void startAll()}
            className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Start — share this tab and turn on my camera
          </button>
        )}

        {!canShareScreen && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            This browser cannot share its screen — phones and tablets can&apos;t. Please use a
            laptop or desktop computer with Chrome or Edge.
          </p>
        )}

        <PermRow
          label="Screen sharing"
          description="Share this browser tab (the learning platform)."
          status={screenStatus}
          error={screenError}
          help={screenStatus === 'active' ? null : <ShareTabSteps emphasise={wrongShare} />}
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
          disabled={!bothActive || extended}
          onClick={handleContinue}
          className="w-full rounded-xl py-3 text-sm font-medium transition-colors
            disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400
            enabled:bg-blue-600 enabled:text-white enabled:hover:bg-blue-700"
        >
          Continue
        </button>
        <p className="text-center text-xs text-gray-400">
          Not now?{' '}
          <button type="button" onClick={logout} className="underline hover:text-gray-600">
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** How to pick this tab in the browser's share dialog (Chrome / Edge wording). */
function ShareTabSteps({ emphasise }: { emphasise: boolean }) {
  return (
    <div
      data-testid="share-tab-steps"
      className={`rounded-lg border p-3 text-xs ${
        emphasise
          ? 'border-amber-300 bg-amber-50 text-amber-900'
          : 'border-gray-200 bg-white text-gray-600'
      }`}
    >
      <p className="mb-1 font-medium">How to share the right page</p>
      <ol className="list-decimal space-y-1 pl-4">
        <li>
          Click <strong>Enable Screen sharing</strong> (or <strong>Try Again</strong>) above.
        </li>
        <li>
          If the browser asks <em>&ldquo;Allow … to see this tab?&rdquo;</em> (or{' '}
          <em>&ldquo;Share this tab&rdquo;</em>), click <strong>Allow</strong> /{' '}
          <strong>Share</strong>.
        </li>
        <li>
          If you see a list instead, open the <strong>Chrome Tab</strong> (Edge:{' '}
          <strong>Browser tab</strong>) section, select <strong>{TAB_TITLE}</strong>, then click{' '}
          <strong>Share</strong>.
        </li>
        <li>
          Do not choose <strong>Window</strong> or <strong>Entire screen</strong> — they will be
          refused.
        </li>
      </ol>
    </div>
  );
}

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
  help = null,
}: {
  label: string;
  description: string;
  status: Status;
  error: string | null;
  videoRef: RefObject<HTMLVideoElement>;
  onRequest: () => void;
  mirrorVideo?: boolean;
  help?: ReactNode;
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
      {help}
    </div>
  );
}
