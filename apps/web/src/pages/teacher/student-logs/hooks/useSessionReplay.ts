import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../../lib/api';

export interface SessionReplaySnapshot {
  id: string;
  pageUrl: string;
  html?: string;
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
  snapshotCount?: number;
  snapshotsSampled?: boolean;
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

interface SessionReplaySnapshotPage {
  snapshots: SessionReplaySnapshot[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}

export function useSessionReplay(sessionId: string) {
  const [data, setData] = useState<SessionReplayResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState(false);
  const [snapshotLoadProgress, setSnapshotLoadProgress] = useState<{ loaded: number; total: number }>({
    loaded: 0,
    total: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [snapshotContentById, setSnapshotContentById] = useState<Record<string, SessionReplaySnapshot>>(
    {},
  );

  const refresh = useCallback(() => {
    if (!sessionId) return;

    setIsLoading(true);
    setIsLoadingSnapshots(false);
    setSnapshotLoadProgress({ loaded: 0, total: 0 });
    setSnapshotContentById({});
    setError(null);

    void (async () => {
      try {
        const response = await api.get<SessionReplayResponse>(
          `/activity-log/teacher/sessions/${sessionId}/replay?includeSnapshots=false`,
        );
        const totalSnapshots = response.snapshotCount ?? 0;
        setData({ ...response, snapshots: [] });
        setSnapshotLoadProgress({ loaded: 0, total: totalSnapshots });
        setIsLoading(false);

        setIsLoadingSnapshots(true);
        const loadedSnapshots: SessionReplaySnapshot[] = [];
        let cursor: string | null = null;
        let hasMore = true;

        while (hasMore) {
          const query = cursor
            ? `?cursor=${encodeURIComponent(cursor)}&limit=120&includeContent=false`
            : '?limit=120&includeContent=false';
          const page = await api.get<SessionReplaySnapshotPage>(
            `/activity-log/teacher/sessions/${sessionId}/replay/snapshots${query}`,
          );
          loadedSnapshots.push(...page.snapshots);
          setSnapshotLoadProgress({
            loaded: loadedSnapshots.length,
            total: totalSnapshots || loadedSnapshots.length,
          });
          hasMore = page.hasMore;
          cursor = page.nextCursor;
        }
        setData((prev) => (prev ? { ...prev, snapshots: loadedSnapshots } : prev));
      } catch (err) {
        const typedError = err as Error;
        setError(typedError.message || 'Failed to load session replay');
      } finally {
        setIsLoading(false);
        setIsLoadingSnapshots(false);
      }
    })();
  }, [sessionId]);

  const fetchSnapshotContent = useCallback(
    async (snapshotId: string, options?: { includeScreenshot?: boolean }) => {
      if (!sessionId || !snapshotId) return null;
      const includeScreenshot = options?.includeScreenshot ?? false;
      const cached = snapshotContentById[snapshotId];
      if (cached && (!includeScreenshot || Boolean(cached.screenshotDataUrl))) return cached;

      const fullSnapshot = await api.get<SessionReplaySnapshot | null>(
        `/activity-log/teacher/sessions/${sessionId}/replay/snapshots/${snapshotId}?includeScreenshot=${
          includeScreenshot ? 'true' : 'false'
        }`,
      );
      if (!fullSnapshot) return null;

      setSnapshotContentById((prev) => {
        if (prev[snapshotId]) return prev;
        const next = { ...prev, [snapshotId]: fullSnapshot };
        const keys = Object.keys(next);
        const maxEntries = 12;
        if (keys.length > maxEntries) {
          const toDelete = keys.slice(0, keys.length - maxEntries);
          toDelete.forEach((key) => {
            delete next[key];
          });
        }
        return next;
      });
      return fullSnapshot;
    },
    [sessionId, snapshotContentById],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    data,
    isLoading,
    isLoadingSnapshots,
    snapshotLoadProgress,
    snapshotContentById,
    fetchSnapshotContent,
    error,
    refresh,
  };
}
