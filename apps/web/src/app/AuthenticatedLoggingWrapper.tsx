import { useState } from 'react';
import { PermissionGate } from '../components/student/PermissionGate';
import { LoggingProvider } from '../components/LoggingProvider';
import { useAuth } from '../contexts/AuthContext';
import { useActivityLog } from '../lib/activity-log';
import { PERMISSION_SESSION_KEY } from '../lib/biometrics/permittedStreams';

// Moved verbatim from App.tsx for the two-door split. The captureDom
// value and its comment are deliberately untouched — which value ships
// for the study is a human decision, not something the split decides.
export function AuthenticatedLoggingWrapper({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { sessionId } = useActivityLog();
  const [permissionsGranted, setPermissionsGranted] = useState(
    () => sessionStorage.getItem(PERMISSION_SESSION_KEY) === '1',
  );

  if (user?.role === 'student' && !permissionsGranted) {
    return <PermissionGate onGranted={() => setPermissionsGranted(true)} />;
  }

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
    </LoggingProvider>
  );
}
