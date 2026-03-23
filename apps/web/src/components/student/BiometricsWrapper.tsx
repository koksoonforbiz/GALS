import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useActivityLog } from '../../lib/activity-log';
import { BiometricsSyncProvider, useBiometricsSync } from '../../contexts/BiometricsSyncContext';
import { useWebcamRecording } from '../../lib/recording/useWebcamRecording';
import { usePupilSize } from '../../lib/pupil-size/usePupilSize';
import { useWebgazer } from '../../lib/webgazer/useWebgazer';
import { CalibrationModal } from '../../lib/webgazer/CalibrationModal';
import { RecordingIndicator } from './RecordingIndicator';
import { RecordingConsentModal } from './RecordingConsentModal';
import { BiometricsActiveBanner } from './BiometricsActiveBanner';
import { WebcamPreviewWindow } from './WebcamPreviewWindow';

/**
 * Inner component that uses BiometricsSync context to activate all hooks.
 */
function BiometricsHooks({ children }: { children: ReactNode }) {
  const sync = useBiometricsSync();
  if (!sync) return <>{children}</>;

  const {
    sessionId,
    courseId,
    wallClockOffset,
    isRecordingEnabled,
    hasConsent,
    setRecordingActive,
    setHasConsent,
  } = sync;

  return (
    <BiometricsHooksInner
      sessionId={sessionId}
      courseId={courseId}
      wallClockOffset={wallClockOffset}
      isRecordingEnabled={isRecordingEnabled}
      hasConsent={hasConsent}
      onRecordingActiveChange={setRecordingActive}
      onConsentGiven={() => setHasConsent(true)}
      onConsentDeclined={() => {}}
    >
      {children}
    </BiometricsHooksInner>
  );
}

function BiometricsHooksInner({
  sessionId,
  courseId,
  wallClockOffset,
  isRecordingEnabled,
  hasConsent,
  onRecordingActiveChange,
  onConsentGiven,
  onConsentDeclined,
  children,
}: {
  sessionId: string;
  courseId: string;
  wallClockOffset: number;
  isRecordingEnabled: boolean;
  hasConsent: boolean;
  onRecordingActiveChange: (active: boolean) => void;
  onConsentGiven: () => void;
  onConsentDeclined: () => void;
  children: ReactNode;
}) {
  const [showConsentModal, setShowConsentModal] = useState(isRecordingEnabled && !hasConsent);

  // Feature 04: Webcam recording
  const recording = useWebcamRecording(
    courseId,
    sessionId,
    wallClockOffset,
    isRecordingEnabled,
    hasConsent,
    onRecordingActiveChange,
  );

  // Feature 01: Pupil size
  const pupilSize = usePupilSize(courseId, sessionId, wallClockOffset);

  // Feature 02: WebGazer
  const webgazer = useWebgazer(courseId, sessionId, wallClockOffset);

  // Build active features list for banner
  const activeFeatures: string[] = [];
  if (recording.isActive) activeFeatures.push('Session recording');
  if (pupilSize.isActive) activeFeatures.push('Pupil size monitoring');
  if (webgazer.isActive) activeFeatures.push('Eye tracking');

  return (
    <>
      {/* Privacy banner */}
      <BiometricsActiveBanner activeFeatures={activeFeatures} />

      {/* Recording indicator */}
      <RecordingIndicator isActive={recording.isActive} isUploading={recording.isUploading} />

      {/* Floating webcam preview with face bounding box */}
      {(recording.isActive || pupilSize.isActive || webgazer.isActive) && <WebcamPreviewWindow />}

      {/* Consent modal */}
      {showConsentModal && (
        <RecordingConsentModal
          courseId={courseId}
          onAccept={() => {
            setShowConsentModal(false);
            onConsentGiven();
          }}
          onDecline={() => {
            setShowConsentModal(false);
            onConsentDeclined();
          }}
        />
      )}

      {/* WebGazer calibration modal */}
      {webgazer.needsCalibration && !webgazer.isCalibrating && (
        <CalibrationModal
          courseId={courseId}
          sessionId={sessionId}
          triggeredBy="new_session"
          onTrainPoint={webgazer.trainOnPoint}
          getCurrentPrediction={webgazer.getCurrentPrediction}
          onComplete={() => {
            webgazer.completeCalibration();
          }}
          onSkip={() => {
            webgazer.skipCalibration();
          }}
        />
      )}

      {children}
    </>
  );
}

/**
 * Wrap any student course page with this component to activate all biometric hooks.
 * It reads courseId from URL params and sessionId from the activity log context.
 */
export function BiometricsWrapper({ children }: { children: ReactNode }) {
  const { courseId } = useParams<{ courseId: string }>();
  const { sessionId } = useActivityLog();

  // Need both courseId and sessionId to operate
  if (!courseId || !sessionId) {
    return <>{children}</>;
  }

  return (
    <BiometricsSyncProvider sessionId={sessionId} courseId={courseId}>
      <BiometricsHooks>{children}</BiometricsHooks>
    </BiometricsSyncProvider>
  );
}
