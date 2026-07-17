import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../api';
import { toWallTime } from '../biometrics/time';
import { mediaStreamRegistry } from '../biometrics/mediaStreamRegistry';
import { takePermittedWebcamStream } from '../biometrics/permittedStreams';

export interface RecordingState {
  isActive: boolean;
  isUploading: boolean;
  segmentId: string | null;
  startWallTime: Date | null;
  wallClockOffset: number;
  error: string | null;
}

const MAX_SEGMENT_BYTES = 50 * 1024 * 1024; // 50 MB auto-rotate

function getPreferredMimeType(): string {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const mt of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mt)) return mt;
  }
  return 'video/webm';
}

export function useWebcamRecording(
  courseId: string,
  sessionId: string,
  wallClockOffset: number,
  isEnabled: boolean,
  hasConsent: boolean,
  onRecordingActiveChange?: (active: boolean) => void,
): RecordingState {
  const [isActive, setIsActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [segmentId, setSegmentId] = useState<string | null>(null);
  const [startWallTime, setStartWallTime] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const totalBytesRef = useRef(0);
  const segmentIndexRef = useRef(0);
  const segmentIdRef = useRef<string | null>(null);
  const segmentStartTimeRef = useRef<number>(0);
  const uploadUrlRef = useRef<string | null>(null);
  const isStoppingRef = useRef(false);

  const toWall = useCallback(
    (perfNow: number) => toWallTime(wallClockOffset)(perfNow),
    [wallClockOffset],
  );

  const uploadSegment = useCallback(
    async (blob: Blob, currentSegmentId: string, startTime: number, stoppedAt: number) => {
      const url = uploadUrlRef.current;
      if (!url || blob.size === 0) return;

      setIsUploading(true);
      try {
        console.log('[Recording] Uploading segment', currentSegmentId, 'size:', blob.size);
        // PUT to presigned MinIO URL (proxied via /s3/ in dev)
        const res = await fetch(url, {
          method: 'PUT',
          body: blob,
          headers: { 'Content-Type': blob.type || 'video/webm' },
        });
        if (!res.ok) {
          throw new Error(`Upload returned ${res.status}: ${res.statusText}`);
        }

        // Stamped at actual recording-stop time (passed in from onstop), not
        // after the upload above resolves — otherwise upload latency (which
        // can be seconds) inflates the persisted duration.
        const endWallTime = new Date(stoppedAt).toISOString();
        const durationMs = stoppedAt - startTime;

        await api.patch(`/recording/segments/${currentSegmentId}/complete`, {
          endWallTime,
          durationMs,
          fileSizeBytes: blob.size,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        console.error('[Recording] Upload failed:', msg, err);
        setError(msg);
        try {
          await api.patch(`/recording/segments/${currentSegmentId}/fail`, {
            error: msg,
          });
        } catch {
          // best effort
        }
      } finally {
        setIsUploading(false);
      }
    },
    [],
  );

  const startRecording = useCallback(async () => {
    if (!isEnabled || !hasConsent || !courseId || !sessionId) return;

    try {
      // Use the stream pre-obtained by PermissionGate when available so the
      // browser does not show a second permission prompt on first course visit.
      // takePermittedWebcamStream() returns null on subsequent navigations
      // (already consumed) — getUserMedia() then succeeds silently because the
      // browser cached the permission from the gate.
      const stream =
        takePermittedWebcamStream() ??
        (await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, frameRate: 15 },
          audio: false,
        }));
      streamRef.current = stream;
      mediaStreamRegistry.register('recording', stream);

      const startWall = toWall(performance.now());
      const { segmentId: sid, uploadUrl } = await api.post<{
        segmentId: string;
        uploadUrl: string;
        minioKey: string;
      }>('/recording/segments/initiate', {
        sessionId,
        courseId,
        startWallTime: startWall,
        segmentIndex: segmentIndexRef.current,
        mimeType: getPreferredMimeType(),
      });

      segmentIdRef.current = sid;
      uploadUrlRef.current = uploadUrl;
      setSegmentId(sid);
      setStartWallTime(new Date(startWall));
      segmentStartTimeRef.current = Date.now();
      chunksRef.current = [];
      totalBytesRef.current = 0;

      const mimeType = getPreferredMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          totalBytesRef.current += e.data.size;

          // Auto-rotate at 50 MB
          if (totalBytesRef.current >= MAX_SEGMENT_BYTES && !isStoppingRef.current) {
            isStoppingRef.current = true;
            recorder.stop();
          }
        }
      };

      recorder.onstop = async () => {
        const stoppedAt = Date.now();
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const currentSid = segmentIdRef.current;
        const startTime = segmentStartTimeRef.current;

        if (currentSid && blob.size > 0) {
          await uploadSegment(blob, currentSid, startTime, stoppedAt);
        }

        // If auto-rotated, start a new segment
        if (isStoppingRef.current && streamRef.current?.active) {
          isStoppingRef.current = false;
          segmentIndexRef.current += 1;
          startRecording();
        }
      };

      recorder.start(1000); // 1-second time slices
      setIsActive(true);
      setError(null);
      onRecordingActiveChange?.(true);
      console.log('[Recording] Started, segment:', sid);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start recording';
      console.error('[Recording] Start failed:', err);
      setError(msg);
      setIsActive(false);
      onRecordingActiveChange?.(false);
    }
  }, [courseId, sessionId, isEnabled, hasConsent, toWall, uploadSegment, onRecordingActiveChange]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaStreamRegistry.unregister('recording');
    setIsActive(false);
    onRecordingActiveChange?.(false);
  }, [onRecordingActiveChange]);

  // Start recording on mount if enabled + consent
  useEffect(() => {
    if (isEnabled && hasConsent) {
      startRecording();
    }
    return () => {
      stopRecording();
    };
  }, [isEnabled, hasConsent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle page visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stopRecording();
      } else if (isEnabled && hasConsent) {
        segmentIndexRef.current += 1;
        startRecording();
      }
    };

    const handleBeforeUnload = () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      // Do not mark segment COMPLETE on unload: upload might never finish,
      // which creates "completed" rows pointing to missing MinIO objects.
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
    };
  }, [isEnabled, hasConsent, startRecording, stopRecording]);

  return {
    isActive,
    isUploading,
    segmentId,
    startWallTime,
    wallClockOffset,
    error,
  };
}
