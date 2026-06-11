/**
 * Module-level bridge between PermissionGate and the biometric hooks.
 *
 * Screen stream — peek pattern (not take-once):
 *   PermissionGate calls setPermittedScreenStream() after screen share is
 *   confirmed. useSessionReplayRecorder calls peekPermittedScreenStream() on
 *   every mount without clearing the slot. React StrictMode mounts effects
 *   twice (mount → cleanup → mount again), so take-once would clear the slot
 *   on the first mount and leave the second mount with nothing, forcing a
 *   second getDisplayMedia() prompt. Peek avoids this. The slot is cleared
 *   explicitly by clearPermittedScreenStream() on logout or gate dismissal.
 *
 * Webcam stream — take-once pattern:
 *   useWebcamRecording calls takePermittedWebcamStream() once to claim it.
 *   The webcam hook only mounts inside BiometricsWrapper (course pages), not
 *   during the StrictMode double-mount of LoggingProvider, so take-once is safe.
 *
 * The gate runs inside AuthenticatedLoggingWrapper BEFORE LoggingProvider
 * mounts, so streams are stored here before any hook subscribes.
 */

export const PERMISSION_SESSION_KEY = 'gals:permissions_granted';

// ── Screen stream ────────────────────────────────────────────────────────────

let _screenStream: MediaStream | null = null;

/** Called by PermissionGate after screen share is confirmed. */
export function setPermittedScreenStream(stream: MediaStream): void {
  _screenStream = stream;
}

/**
 * Read the gate-provided screen stream without consuming it. Returns null if
 * no stream is stored. The slot stays populated so React StrictMode's
 * double-mount can re-read it after the cleanup phase wipes the hook's ref.
 * Call clearPermittedScreenStream() explicitly on logout or when the gate
 * closes without granting.
 */
export function peekPermittedScreenStream(): MediaStream | null {
  return _screenStream;
}

/** Clear the slot (and stop tracks) when the stream is no longer needed. */
export function clearPermittedScreenStream(): void {
  _screenStream?.getTracks().forEach((t) => t.stop());
  _screenStream = null;
}

// ── Webcam stream ────────────────────────────────────────────────────────────

let _webcamStream: MediaStream | null = null;

/** Called by PermissionGate after webcam is confirmed. */
export function setPermittedWebcamStream(stream: MediaStream): void {
  _webcamStream = stream;
}

/**
 * Claim the pre-obtained webcam stream. Returns null if none is stored.
 * Clears the slot after returning so it cannot be claimed twice.
 */
export function takePermittedWebcamStream(): MediaStream | null {
  const s = _webcamStream;
  _webcamStream = null;
  return s;
}
