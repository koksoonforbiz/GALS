import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../../lib/api';

export interface SessionReplaySnapshot {
  id: string;
  pageUrl: string;
  html: string;
  screenshotDataUrl?: string | null;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  capturedAt: number;
  trigger: string;
}

export interface SessionReplayClickLog {
  id: string;
  x: number;
  y: number;
  pageUrl: string;
  elementSelector: string;
  elementText?: string | null;
  timestamp: number;
}

export interface SessionReplayScrollLog {
  id: string;
  scrollY: number;
  scrollPercent: number;
  pageUrl: string;
  timestamp: number;
}

export interface SessionReplayViewportLog {
  id: string;
  width: number;
  height: number;
  orientation: string;
  timestamp: number;
}

export interface SessionReplayGazeLog {
  id: string;
  pageUrl?: string | null;
  timestamp: string;
  gazeX: number;
  gazeY: number;
  confidence?: number | null;
}

export interface SessionReplayPupilLog {
  id: string;
  timestamp: string;
  pupilDiameter: number;
}

export interface SessionReplayEmotionFrame {
  id: string;
  frameWallMs: number;
  frameIndex: number;
  faceDetected: boolean;
  dominantEmotion?: string | null;
  dominantProbability?: number | null;
  pHappiness?: number | null;
  pSadness?: number | null;
  pSurprise?: number | null;
  pFear?: number | null;
  pAnger?: number | null;
  pDisgust?: number | null;
  pContempt?: number | null;
  pNeutral?: number | null;
}

export interface SessionReplayAuResult {
  id: string;
  frameIndex: number;
  timestamp: number;
  wallTime: string;
  faceConf?: number | null;
  au01?: number | null;
  au02?: number | null;
  au04?: number | null;
  au05?: number | null;
  au06?: number | null;
  au07?: number | null;
  au09?: number | null;
  au10?: number | null;
  au12?: number | null;
  au14?: number | null;
  au15?: number | null;
  au17?: number | null;
  au20?: number | null;
  au23?: number | null;
  au24?: number | null;
  au25?: number | null;
  au26?: number | null;
  au28?: number | null;
}

interface SessionReplayResponse {
  session: {
    id: string;
    userId: string;
    courseId?: string | null;
    startedAt: string;
    endedAt?: string | null;
    durationSecs?: number | null;
  } | null;
  syncAnchor: {
    wallClockMs: number;
    monotonicMs: number;
    serverReceiveMs: number;
    timezone: string;
    userAgent: string;
  } | null;
  snapshots: SessionReplaySnapshot[];
  clickLogs: SessionReplayClickLog[];
  scrollLogs: SessionReplayScrollLog[];
  viewportLogs: SessionReplayViewportLog[];
  gazeLogs: SessionReplayGazeLog[];
  pupilLogs: SessionReplayPupilLog[];
  emotionFrames: SessionReplayEmotionFrame[];
  auResults: SessionReplayAuResult[];
  diagnostics?: {
    recordingSegments: Array<{
      id: string;
      uploadStatus: string;
      pyfeatJobId: string | null;
      startWallTime: string;
      endWallTime: string | null;
      durationMs: number | null;
    }>;
    openface3Jobs: Array<{
      id: string;
      status: string;
      errorMessage: string | null;
      createdAt: string;
      completedAt: string | null;
      recordingSegmentId: string;
    }>;
    pyfeatJobs: Array<{
      id: string;
      status: string;
      error: string | null;
      createdAt: string;
      completedAt: string | null;
      sourceMinioKey: string;
    }>;
  };
}

export function useSessionReplay(sessionId: string) {
  const [data, setData] = useState<SessionReplayResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!sessionId) return;

    setIsLoading(true);
    setError(null);

    api
      .get<SessionReplayResponse>(`/activity-log/teacher/sessions/${sessionId}/replay`)
      .then((response) => setData(response))
      .catch((err: Error) => setError(err.message || 'Failed to load session replay'))
      .finally(() => setIsLoading(false));
  }, [sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, isLoading, error, refresh };
}
