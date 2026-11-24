import { useEffect, useState } from 'react';
import { useExtendedDisplay } from '../lib/screens';
import { PermissionGate } from '../components/student/PermissionGate';
import { LoggingProvider } from '../components/LoggingProvider';
import { useAuth } from '../contexts/AuthContext';
import { useActivityLog } from '../lib/activity-log';
import {
  PERMISSION_SESSION_KEY,
  peekPermittedScreenStream,
} from '../lib/biometrics/permittedStreams';

/** The gate's screen share, if it is still running (it never survives a reload). */
function liveScreenTrack(): MediaStreamTrack | null {
  const t = peekPermittedScreenStream()?.getVideoTracks()[0];
  return t && t.readyState === 'live' ? t : null;
}

// Moved verbatim from App.tsx for the two-door split. The captureDom
// value and its comment are deliberately untouched — which value ships
// for the study is a human decision, not something the split decides.
export function AuthenticatedLoggingWrapper({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { sessionId } = useActivityLog();
  // Students pass the gate whenever there is no live screen share — after a
  // reload, or when they press the browser's "Stop sharing". (A remembered
  // "granted" flag let a reload skip the gate; the recorder's own
  // getDisplayMedia then ran without a click, which Chrome refuses, so the
  // rest of the session had no screen capture and no tab check.)
  // Dev builds only: the e2e helpers (e2e/puzzles.helpers.ts) set the
  // session flag to skip the gate, since a test browser has no real screen
  // to share. Production builds never honour it.
  const testBypass = import.meta.env.DEV && sessionStorage.getItem(PERMISSION_SESSION_KEY) === '1';
  const extendedDisplay = useExtendedDisplay();
  const [permissionsGranted, setPermissionsGranted] = useState(
    () => testBypass || !!liveScreenTrack(),
  );

  useEffect(() => {
    if (user?.role !== 'student' || !permissionsGranted || testBypass) return;
    const track = liveScreenTrack();
    if (!track) {
      setPermissionsGranted(false);
      return;
    }
    const onEnded = () => setPermissionsGranted(false);
    track.addEventListener('ended', onEnded);
    return () => track.removeEventListener('ended', onEnded);
  }, [user?.role, permissionsGranted, testBypass]);

  if (user?.role === 'student' && !permissionsGranted) {
    return <PermissionGate onGranted={() => setPermissionsGranted(true)} />;
  }

  const blockForSecondScreen = user?.role === 'student' && extendedDisplay === true;

  if (!user || !sessionId) return <>{children}</>;

  // captureDom temporarily ON again — re-testing after lowering
  // PDF_CANVAS_JPEG_QUALITY/OTHER_CANVAS_JPEG_QUALITY and adding
  // MAX_CANVAS_ENCODE_DIMENSION downscaling (see useSessionReplayRecorder.ts)
  // against the 2026-08-19 baseline (~1.7MB html, ~1.9:1 gzip). Flip back to
  // `false` once this comparison is done — off by default for the
  // 2026-06-13 study to keep snapshot storage and bandwidth under control.
  return (
    <LoggingProvider sessionId={sessionId} userId={user.id} captureDom={true}>
      {children}
      {blockForSecondScreen && <SecondScreenOverlay />}
    </LoggingProvider>
  );
}

/** Mid-lesson: a second display was connected. Recording keeps running underneath. */
function SecondScreenOverlay() {
  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-gray-900/90 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="second-screen-title"
      data-testid="second-screen-overlay"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl">
        <h2 id="second-screen-title" className="text-xl font-semibold text-gray-900">
          Please disconnect your second screen
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          GALS must be used on one screen only. Unplug the external monitor, or set your display to
          show on one screen. You can continue as soon as only one screen is connected.
        </p>
      </div>
    </div>
  );
}
