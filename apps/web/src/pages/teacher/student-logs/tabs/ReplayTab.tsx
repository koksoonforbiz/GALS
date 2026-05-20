import { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionReplay } from '../hooks/useSessionReplay';
import { api } from '../../../../lib/api';
const PLAYBACK_STEP_MS = 200; // 5 FPS playback to align with biometrics sampled at 5 FPS

const EMOTION_SIGNALS = [
  { key: 'happiness', label: 'Emotion Happy', color: '#16a34a' },
  { key: 'sadness', label: 'Emotion Sad', color: '#2563eb' },
  { key: 'surprise', label: 'Emotion Surprise', color: '#d97706' },
  { key: 'fear', label: 'Emotion Fear', color: '#7c3aed' },
  { key: 'anger', label: 'Emotion Anger', color: '#dc2626' },
  { key: 'disgust', label: 'Emotion Disgust', color: '#65a30d' },
  { key: 'contempt', label: 'Emotion Contempt', color: '#ea580c' },
  { key: 'neutral', label: 'Emotion Neutral', color: '#6b7280' },
] as const;

const LEARNING_STATE_SIGNALS = [
  { key: 'engagementScore', label: 'State Engagement', color: '#16a34a' },
  { key: 'boredomScore', label: 'State Boredom', color: '#6b7280' },
  { key: 'confusionScore', label: 'State Confusion', color: '#d97706' },
  { key: 'frustrationScore', label: 'State Frustration', color: '#dc2626' },
] as const;

const AU_SIGNALS = [
  { key: 'au01', label: 'AU01', color: '#e11d48' },
  { key: 'au02', label: 'AU02', color: '#db2777' },
  { key: 'au04', label: 'AU04', color: '#be185d' },
  { key: 'au05', label: 'AU05', color: '#a21caf' },
  { key: 'au06', label: 'AU06', color: '#7e22ce' },
  { key: 'au07', label: 'AU07', color: '#6d28d9' },
  { key: 'au09', label: 'AU09', color: '#4f46e5' },
  { key: 'au10', label: 'AU10', color: '#2563eb' },
  { key: 'au12', label: 'AU12', color: '#0284c7' },
  { key: 'au14', label: 'AU14', color: '#0891b2' },
  { key: 'au15', label: 'AU15', color: '#0d9488' },
  { key: 'au17', label: 'AU17', color: '#059669' },
  { key: 'au20', label: 'AU20', color: '#16a34a' },
  { key: 'au23', label: 'AU23', color: '#65a30d' },
  { key: 'au24', label: 'AU24', color: '#84cc16' },
  { key: 'au25', label: 'AU25', color: '#ca8a04' },
  { key: 'au26', label: 'AU26', color: '#d97706' },
  { key: 'au28', label: 'AU28', color: '#ea580c' },
] as const;

type EmotionSignalKey = (typeof EMOTION_SIGNALS)[number]['key'];
type LearningStateSignalKey = (typeof LEARNING_STATE_SIGNALS)[number]['key'];
type AuSignalKey = (typeof AU_SIGNALS)[number]['key'];
type SignalKey = EmotionSignalKey | LearningStateSignalKey | AuSignalKey;

const AU_LABELS: Record<string, string> = {
  au01: 'AU01',
  au02: 'AU02',
  au04: 'AU04',
  au05: 'AU05',
  au06: 'AU06',
  au07: 'AU07',
  au09: 'AU09',
  au10: 'AU10',
  au12: 'AU12',
  au14: 'AU14',
  au15: 'AU15',
  au17: 'AU17',
  au20: 'AU20',
  au23: 'AU23',
  au24: 'AU24',
  au25: 'AU25',
  au26: 'AU26',
  au28: 'AU28',
};

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatTimestamp(ms: number) {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function buildSnapshotImageDataUrl(html: string, width: number, height: number) {
  const escapedHtml = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="0" y="0" width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${escapedHtml}</div></foreignObject></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

type LearningThresholds = {
  engagement_score: number;
  boredom_score: number;
  confusion_surprise: number;
  confusion_fear: number;
  confusion_anger: number;
  confusion_disgust: number;
  frustration_sad: number;
  frustration_anger: number;
  frustration_disgust: number;
};

const DEFAULT_THRESHOLDS: LearningThresholds = {
  engagement_score: 0.14,
  boredom_score: 0.2,
  confusion_surprise: 0.0,
  confusion_fear: 0.05,
  confusion_anger: 0.19,
  confusion_disgust: 0.0,
  frustration_sad: 0.2,
  frustration_anger: 0.25,
  frustration_disgust: 0.13,
};

type LearningRuleMode = 'single' | 'all_gt' | 'any_gt';
type LearningStateName = 'boredom' | 'engagement' | 'confusion' | 'frustration';
type LearningFeatureKey =
  | 'score_boredom'
  | 'score_engagement'
  | 'prob_Surprise'
  | 'prob_Fear'
  | 'prob_Anger'
  | 'prob_Disgust'
  | 'prob_Sad';
type LearningRule = {
  features: LearningFeatureKey[];
  mode: LearningRuleMode;
  thresholdKeys: (keyof LearningThresholds)[];
};

const STATE_RULES: Record<LearningStateName, LearningRule> = {
  boredom: {
    features: ['score_boredom'],
    mode: 'single',
    thresholdKeys: ['boredom_score'],
  },
  engagement: {
    features: ['score_engagement'],
    mode: 'single',
    thresholdKeys: ['engagement_score'],
  },
  confusion: {
    features: ['prob_Surprise', 'prob_Fear', 'prob_Anger', 'prob_Disgust'],
    mode: 'all_gt',
    thresholdKeys: ['confusion_surprise', 'confusion_fear', 'confusion_anger', 'confusion_disgust'],
  },
  frustration: {
    features: ['prob_Sad', 'prob_Anger', 'prob_Disgust'],
    mode: 'any_gt',
    thresholdKeys: ['frustration_sad', 'frustration_anger', 'frustration_disgust'],
  },
};

function predictRow(
  row: Record<LearningFeatureKey, number>,
  features: LearningFeatureKey[],
  thresholds: number[],
  mode: LearningRuleMode,
) {
  const comparisons = features.map((feature, index) => row[feature] > thresholds[index]!);
  if (mode === 'single') return Number(comparisons[0] ?? false);
  if (mode === 'all_gt') return Number(comparisons.every(Boolean));
  if (mode === 'any_gt') return Number(comparisons.some(Boolean));
  throw new Error(`Unsupported mode: ${mode}`);
}

function predictLearningState(
  probs: {
    neutral: number;
    disgust: number;
    happy: number;
    sad: number;
    anger: number;
    surprise: number;
    fear: number;
  },
  thresholds: LearningThresholds,
) {
  const n = probs.neutral;
  const d = probs.disgust;
  const h = probs.happy;
  const s = probs.sad;
  const a = probs.anger;
  const sp = probs.surprise;
  const f = probs.fear;

  const scoreEngagement = 0.4 * h + 0.4 * n + 0.2 * sp;
  const scoreBoredom = 0.5 * n + 0.3 * s + 0.2 * d;

  const row: Record<LearningFeatureKey, number> = {
    score_boredom: scoreBoredom,
    score_engagement: scoreEngagement,
    prob_Surprise: sp,
    prob_Fear: f,
    prob_Anger: a,
    prob_Disgust: d,
    prob_Sad: s,
  };

  const rulePredictions: Record<LearningStateName, number> = {
    boredom: predictRow(
      row,
      STATE_RULES.boredom.features,
      STATE_RULES.boredom.thresholdKeys.map((key) => thresholds[key]),
      STATE_RULES.boredom.mode,
    ),
    engagement: predictRow(
      row,
      STATE_RULES.engagement.features,
      STATE_RULES.engagement.thresholdKeys.map((key) => thresholds[key]),
      STATE_RULES.engagement.mode,
    ),
    confusion: predictRow(
      row,
      STATE_RULES.confusion.features,
      STATE_RULES.confusion.thresholdKeys.map((key) => thresholds[key]),
      STATE_RULES.confusion.mode,
    ),
    frustration: predictRow(
      row,
      STATE_RULES.frustration.features,
      STATE_RULES.frustration.thresholdKeys.map((key) => thresholds[key]),
      STATE_RULES.frustration.mode,
    ),
  };

  const scores = {
    engagement: scoreEngagement,
    boredom: scoreBoredom,
    confusion: rulePredictions.confusion,
    frustration: rulePredictions.frustration,
  };

  const eligibleScores: Record<string, number> = Object.fromEntries(
    Object.entries(rulePredictions).filter(([, value]) => value > 0),
  );
  const predicted = Object.keys(eligibleScores).length
    ? Object.keys(eligibleScores).join(',')
    : 'none';

  return { predicted, scores, eligibleScores };
}

export function ReplayTab({ sessionId }: { sessionId: string }) {
  const {
    data,
    isLoading,
    isLoadingSnapshots,
    snapshotLoadProgress,
    snapshotContentById,
    fetchSnapshotContent,
    error,
    refresh,
  } = useSessionReplay(sessionId);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const viewportHostRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [isRetryingPyfeat, setIsRetryingPyfeat] = useState(false);
  const [contentScale, setContentScale] = useState(1);
  const [segmentVideoUrls, setSegmentVideoUrls] = useState<Record<string, string | null>>({});
  const [learningThresholds, setLearningThresholds] =
    useState<LearningThresholds>(DEFAULT_THRESHOLDS);
  const [selectedSignals, setSelectedSignals] = useState<Set<SignalKey>>(
    () =>
      new Set<SignalKey>([
        'boredomScore',
        'frustrationScore',
        'engagementScore',
        'confusionScore',
      ]),
  );

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTimeMs(0);
  }, [sessionId]);

  const baseWallClockMs = useMemo(() => {
    if (!data) return 0;
    return (
      data.syncAnchor?.wallClockMs ??
      data.snapshots[0]?.capturedAt ??
      (data.session ? new Date(data.session.startedAt).getTime() : 0)
    );
  }, [data]);

  const durationMs = useMemo(() => {
    if (!data) return 0;
    const candidates = [
      ...data.snapshots.map((snapshot) => snapshot.capturedAt),
      ...data.clickLogs.map((log) => log.timestamp),
      ...data.scrollLogs.map((log) => log.timestamp),
      ...data.viewportLogs.map((log) => log.timestamp),
      ...data.gazeLogs.map((log) => new Date(log.timestamp).getTime()),
    ];

    const sessionEnd = data.session?.endedAt ? new Date(data.session.endedAt).getTime() : 0;
    const maxTime = Math.max(baseWallClockMs, sessionEnd, ...candidates);
    return Math.max(1_000, maxTime - baseWallClockMs);
  }, [baseWallClockMs, data]);

  useEffect(() => {
    if (!isPlaying) return;

    const timer = window.setInterval(() => {
      setCurrentTimeMs((prev) => {
        const next = prev + PLAYBACK_STEP_MS;
        if (next >= durationMs) {
          setIsPlaying(false);
          return durationMs;
        }
        return next;
      });
    }, PLAYBACK_STEP_MS);

    return () => window.clearInterval(timer);
  }, [durationMs, isPlaying]);

  const currentAbsoluteMs = baseWallClockMs + currentTimeMs;

  const snapshotStats = useMemo(() => {
    if (!data?.snapshots.length) {
      return { averageGapMs: null as number | null, latestGapMs: null as number | null };
    }
    if (data.snapshots.length === 1) {
      return { averageGapMs: null as number | null, latestGapMs: null as number | null };
    }

    const gaps: number[] = [];
    for (let index = 1; index < data.snapshots.length; index += 1) {
      gaps.push(data.snapshots[index]!.capturedAt - data.snapshots[index - 1]!.capturedAt);
    }

    const averageGapMs = Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length);
    return {
      averageGapMs,
      latestGapMs: gaps[gaps.length - 1] ?? null,
    };
  }, [data?.snapshots]);

  const currentSnapshot = useMemo(() => {
    if (!data?.snapshots.length) return null;
    let selected = data.snapshots[0]!;
    for (const snapshot of data.snapshots) {
      if (snapshot.capturedAt <= currentAbsoluteMs) selected = snapshot;
      else break;
    }
    return selected;
  }, [currentAbsoluteMs, data?.snapshots]);

  const currentSnapshotWithContent = useMemo(() => {
    if (!currentSnapshot) return null;
    return snapshotContentById[currentSnapshot.id] ?? currentSnapshot;
  }, [currentSnapshot, snapshotContentById]);

  useEffect(() => {
    if (!currentSnapshot?.id) return;
    void fetchSnapshotContent(currentSnapshot.id, { includeScreenshot: true });
  }, [currentSnapshot?.id, fetchSnapshotContent]);

  const currentSnapshotImageDataUrl = useMemo(() => {
    if (!currentSnapshotWithContent) return null;
    if (currentSnapshotWithContent.screenshotDataUrl) return currentSnapshotWithContent.screenshotDataUrl;
    if (!currentSnapshotWithContent.html) return null;
    return buildSnapshotImageDataUrl(
      currentSnapshotWithContent.html,
      currentSnapshotWithContent.width,
      currentSnapshotWithContent.height,
    );
  }, [currentSnapshotWithContent]);
  const hasCurrentSnapshotContent = useMemo(
    () => Boolean(currentSnapshot?.id && snapshotContentById[currentSnapshot.id]),
    [currentSnapshot?.id, snapshotContentById],
  );
  const isUsingDomFallbackImage = useMemo(
    () =>
      Boolean(
        currentSnapshotWithContent &&
          !currentSnapshotWithContent.screenshotDataUrl &&
          currentSnapshotWithContent.html,
      ),
    [currentSnapshotWithContent],
  );

  const currentViewport = useMemo(() => {
    if (!data) return null;
    const logs = data.viewportLogs;
    let selected = logs[0] ?? null;
    for (const log of logs) {
      if (log.timestamp <= currentAbsoluteMs) selected = log;
      else break;
    }
    return (
      selected ?? (currentSnapshot ? { width: currentSnapshot.width, height: currentSnapshot.height } : null)
    );
  }, [currentAbsoluteMs, currentSnapshot, data]);

  const currentScrollY = useMemo(() => {
    if (!data) return currentSnapshot?.scrollY ?? 0;
    let scrollY = currentSnapshot?.scrollY ?? 0;
    for (const log of data.scrollLogs) {
      if (log.timestamp <= currentAbsoluteMs) scrollY = log.scrollY;
      else break;
    }
    return scrollY;
  }, [currentAbsoluteMs, currentSnapshot, data]);

  const currentGaze = useMemo(() => {
    if (!data) return null;
    let selected = null;
    for (const log of data.gazeLogs) {
      const ts = new Date(log.timestamp).getTime();
      if (ts <= currentAbsoluteMs) selected = { ...log, timestampMs: ts };
      else break;
    }
    if (!selected) return null;
    if (currentAbsoluteMs - selected.timestampMs > 1_500) return null;
    return selected;
  }, [currentAbsoluteMs, data]);

  const currentClick = useMemo(() => {
    if (!data) return null;
    for (let index = data.clickLogs.length - 1; index >= 0; index -= 1) {
      const click = data.clickLogs[index]!;
      if (click.timestamp <= currentAbsoluteMs) {
        if (currentAbsoluteMs - click.timestamp <= 900) return click;
        return null;
      }
    }
    return null;
  }, [currentAbsoluteMs, data]);

  const currentPupil = useMemo(() => {
    if (!data) return null;
    let selected: ({ timestampMs: number } & (typeof data.pupilLogs)[number]) | null = null;
    for (const log of data.pupilLogs) {
      const timestampMs = new Date(log.timestamp).getTime();
      if (timestampMs <= currentAbsoluteMs) selected = { ...log, timestampMs };
      else break;
    }
    if (!selected) return null;
    if (currentAbsoluteMs - selected.timestampMs > 1_500) return null;
    return selected;
  }, [currentAbsoluteMs, data]);

  const currentEmotionFrame = useMemo(() => {
    if (!data) return null;
    let selected: (typeof data.emotionFrames)[number] | null = null;
    let selectedDelta = Number.POSITIVE_INFINITY;
    for (const frame of data.emotionFrames) {
      const delta = Math.abs(frame.frameWallMs - currentAbsoluteMs);
      if (delta < selectedDelta) {
        selected = frame;
        selectedDelta = delta;
      }
    }
    if (!selected) return null;
    if (selectedDelta > 10_000) return null;
    return selected;
  }, [currentAbsoluteMs, data]);

  const currentAuResult = useMemo(() => {
    if (!data) return null;
    let selected: ({ wallTimeMs: number } & (typeof data.auResults)[number]) | null = null;
    let selectedDelta = Number.POSITIVE_INFINITY;
    for (const result of data.auResults) {
      const wallTimeMs = new Date(result.wallTime).getTime();
      const delta = Math.abs(wallTimeMs - currentAbsoluteMs);
      if (delta < selectedDelta) {
        selected = { ...result, wallTimeMs };
        selectedDelta = delta;
      }
    }
    if (!selected) return null;
    if (selectedDelta > 10_000) return null;
    return selected;
  }, [currentAbsoluteMs, data]);

  const currentRecordingSegment = useMemo(() => {
    const segments = data?.diagnostics?.recordingSegments ?? [];
    if (!segments.length) return null;

    let selected = segments[0] ?? null;
    for (const segment of segments) {
      const startMs = new Date(segment.startWallTime).getTime();
      const endMs = segment.endWallTime ? new Date(segment.endWallTime).getTime() : Number.POSITIVE_INFINITY;
      if (currentAbsoluteMs >= startMs && currentAbsoluteMs <= endMs) {
        selected = segment;
        break;
      }
      if (startMs <= currentAbsoluteMs) selected = segment;
    }
    return selected;
  }, [currentAbsoluteMs, data?.diagnostics?.recordingSegments]);

  useEffect(() => {
    const segmentId = currentRecordingSegment?.id;
    if (!segmentId || Object.prototype.hasOwnProperty.call(segmentVideoUrls, segmentId)) return;

    let cancelled = false;
    api
      .get<{ url: string }>(`/recording/segments/${segmentId}/download`)
      .then(({ url }) => {
        if (cancelled) return;
        setSegmentVideoUrls((prev) => ({ ...prev, [segmentId]: url }));
      })
      .catch(() => {
        if (cancelled) return;
        setSegmentVideoUrls((prev) => ({ ...prev, [segmentId]: null }));
      });

    return () => {
      cancelled = true;
    };
  }, [currentRecordingSegment?.id, segmentVideoUrls]);

  useEffect(() => {
    const video = cameraVideoRef.current;
    if (!video || !currentRecordingSegment) return;

    const startMs = new Date(currentRecordingSegment.startWallTime).getTime();
    const targetSeconds = Math.max(0, (currentAbsoluteMs - startMs) / 1000);
    if (Math.abs(video.currentTime - targetSeconds) > 0.75) {
      video.currentTime = targetSeconds;
    }

    if (isPlaying) {
      void video.play().catch(() => {
        // Ignore autoplay restriction errors.
      });
    } else {
      video.pause();
    }
  }, [currentAbsoluteMs, currentRecordingSegment, isPlaying]);

  const topAus = useMemo(() => {
    if (!currentAuResult) return [];
    return Object.entries(AU_LABELS)
      .map(([key, label]) => ({
        key,
        label,
        value: currentAuResult[key as keyof typeof currentAuResult] as number | null | undefined,
      }))
      .filter((entry) => typeof entry.value === 'number' && Number.isFinite(entry.value))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      .slice(0, 6);
  }, [currentAuResult]);

  const learningState = useMemo(() => {
    if (!currentEmotionFrame) return null;
    return predictLearningState(
      {
        neutral: currentEmotionFrame.pNeutral ?? 0,
        disgust: currentEmotionFrame.pDisgust ?? 0,
        happy: currentEmotionFrame.pHappiness ?? 0,
        sad: currentEmotionFrame.pSadness ?? 0,
        anger: currentEmotionFrame.pAnger ?? 0,
        surprise: currentEmotionFrame.pSurprise ?? 0,
        fear: currentEmotionFrame.pFear ?? 0,
      },
      learningThresholds,
    );
  }, [currentEmotionFrame, learningThresholds]);

  const failedPyfeatJobs = useMemo(
    () => (data?.diagnostics?.pyfeatJobs ?? []).filter((job) => job.status === 'FAILED'),
    [data?.diagnostics?.pyfeatJobs],
  );

  const chartSeries = useMemo(() => {
    if (!data || durationMs <= 0) return [];
    const series: Array<{ key: SignalKey; label: string; color: string; points: string }> = [];

    const pushSeries = (
      key: SignalKey,
      label: string,
      color: string,
      samples: Array<{ timeMs: number; value: number }>,
    ) => {
      if (!selectedSignals.has(key)) return;
      const points = samples
        .filter((sample) => Number.isFinite(sample.value))
        .map((sample) => {
          const rel = Math.min(1, Math.max(0, (sample.timeMs - baseWallClockMs) / durationMs));
          const x = rel * 1000;
          const y = 180 - Math.min(1, Math.max(0, sample.value)) * 160;
          return `${x},${y}`;
        })
        .join(' ');
      if (points) series.push({ key, label, color, points });
    };

    for (const signal of EMOTION_SIGNALS) {
      const prop =
        `p${signal.key.charAt(0).toUpperCase()}${signal.key.slice(1)}` as
          | 'pHappiness'
          | 'pSadness'
          | 'pSurprise'
          | 'pFear'
          | 'pAnger'
          | 'pDisgust'
          | 'pContempt'
          | 'pNeutral';
      pushSeries(
        signal.key,
        signal.label,
        signal.color,
        data.emotionFrames.map((frame) => ({
          timeMs: frame.frameWallMs,
          value: Number(frame[prop] ?? Number.NaN),
        })),
      );
    }

    for (const signal of LEARNING_STATE_SIGNALS) {
      pushSeries(
        signal.key,
        signal.label,
        signal.color,
        data.emotionFrames.map((frame) => {
          const scores = predictLearningState(
            {
              neutral: frame.pNeutral ?? 0,
              disgust: frame.pDisgust ?? 0,
              happy: frame.pHappiness ?? 0,
              sad: frame.pSadness ?? 0,
              anger: frame.pAnger ?? 0,
              surprise: frame.pSurprise ?? 0,
              fear: frame.pFear ?? 0,
            },
            learningThresholds,
          ).scores;
          const value =
            signal.key === 'engagementScore'
              ? scores.engagement
              : signal.key === 'boredomScore'
                ? scores.boredom
                : signal.key === 'confusionScore'
                  ? scores.confusion
                  : scores.frustration;
          return {
            timeMs: frame.frameWallMs,
            value,
          };
        }),
      );
    }

    for (const signal of AU_SIGNALS) {
      pushSeries(
        signal.key,
        signal.label,
        signal.color,
        data.auResults.map((result) => ({
          timeMs: new Date(result.wallTime).getTime(),
          value: Number(result[signal.key] ?? Number.NaN),
        })),
      );
    }

    return series;
  }, [baseWallClockMs, data, durationMs, learningThresholds, selectedSignals]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      iframe.contentWindow?.scrollTo(currentSnapshot?.scrollX ?? 0, currentScrollY);
    } catch {
      // Ignore iframe scroll sync failures
    }
  }, [currentScrollY, currentSnapshot]);

  const viewportWidth = currentViewport?.width ?? currentSnapshot?.width ?? 1280;
  const viewportHeight = currentViewport?.height ?? currentSnapshot?.height ?? 720;
  const scaledViewportWidth = Math.max(1, Math.round(viewportWidth * contentScale));
  const scaledViewportHeight = Math.max(1, Math.round(viewportHeight * contentScale));

  useEffect(() => {
    const host = viewportHostRef.current;
    if (!host) return;

    const updateScale = () => {
      const available = host.clientWidth;
      if (!available || !viewportWidth) return;
      setContentScale(Math.min(1, available / viewportWidth));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(host);
    window.addEventListener('resize', updateScale);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateScale);
    };
  }, [viewportWidth]);

  if (isLoading) {
    return <div className="text-xs text-gray-400 text-center py-12">Loading replay…</div>;
  }

  if (error) {
    return <div className="text-sm text-red-500">Failed to load replay: {error}</div>;
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-sm text-gray-500">
        Replay metadata not available.
      </div>
    );
  }

  if (isLoadingSnapshots && data.snapshots.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-sm text-gray-500">
        Loading full-detail replay snapshots ({snapshotLoadProgress.loaded} /{' '}
        {snapshotLoadProgress.total || '?'}).
      </div>
    );
  }

  if (data.snapshots.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-sm text-gray-500">
        No DOM replay snapshots have been recorded for this session yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <button
          onClick={() => setIsPlaying((prev) => !prev)}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          onClick={() => {
            setIsPlaying(false);
            setCurrentTimeMs(0);
          }}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Restart
        </button>
        <input
          type="range"
          min={0}
          max={durationMs}
          value={currentTimeMs}
          onChange={(event) => {
            setIsPlaying(false);
            setCurrentTimeMs(Number(event.target.value));
          }}
          className="min-w-[240px] flex-1"
        />
        <div className="text-xs font-mono text-gray-500">
          {formatDuration(currentTimeMs)} / {formatDuration(durationMs)}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-gray-900">Signal Timeline</h3>
          <div className="text-xs text-gray-500">Click chart to seek replay</div>
        </div>
        <div className="mb-3 flex max-h-24 flex-wrap gap-2 overflow-y-auto">
          {[...EMOTION_SIGNALS, ...LEARNING_STATE_SIGNALS, ...AU_SIGNALS].map((signal) => {
            const active = selectedSignals.has(signal.key);
            return (
              <button
                key={signal.key}
                type="button"
                onClick={() =>
                  setSelectedSignals((prev) => {
                    const next = new Set(prev);
                    if (next.has(signal.key)) next.delete(signal.key);
                    else next.add(signal.key);
                    return next;
                  })
                }
                className={`rounded-full border px-2 py-1 text-[11px] ${
                  active
                    ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                    : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                <span
                  className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ backgroundColor: signal.color }}
                />
                {signal.label}
              </button>
            );
          })}
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-2">
          <svg
            viewBox="0 0 1000 200"
            className="h-52 w-full min-w-[680px]"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
              setIsPlaying(false);
              setCurrentTimeMs(Math.round(durationMs * ratio));
            }}
          >
            <line x1="0" y1="180" x2="1000" y2="180" stroke="#d1d5db" strokeWidth="1" />
            <line x1="0" y1="20" x2="0" y2="180" stroke="#d1d5db" strokeWidth="1" />
            <line x1="0" y1="20" x2="1000" y2="20" stroke="#e5e7eb" strokeDasharray="4 4" strokeWidth="1" />
            <line x1="0" y1="100" x2="1000" y2="100" stroke="#e5e7eb" strokeDasharray="4 4" strokeWidth="1" />
            {[
              {
                signalKey: 'engagementScore',
                label: `Eng threshold ${learningThresholds.engagement_score.toFixed(2)}`,
                color: '#16a34a',
                value: learningThresholds.engagement_score,
              },
              {
                signalKey: 'boredomScore',
                label: `Boredom threshold ${learningThresholds.boredom_score.toFixed(2)}`,
                color: '#6b7280',
                value: learningThresholds.boredom_score,
              },
            ]
              .filter((guide) => selectedSignals.has(guide.signalKey))
              .map((guide) => {
                const y = 180 - Math.min(1, Math.max(0, guide.value)) * 160;
                return (
                  <g key={guide.signalKey}>
                    <line
                      x1="0"
                      y1={y}
                      x2="1000"
                      y2={y}
                      stroke={guide.color}
                      strokeWidth="1.5"
                      strokeDasharray="6 4"
                      opacity="0.9"
                    />
                    <text
                      x="995"
                      y={Math.max(12, y - 4)}
                      textAnchor="end"
                      fill={guide.color}
                      fontSize="10"
                      fontWeight="600"
                    >
                      {guide.label}
                    </text>
                  </g>
                );
              })}
            {chartSeries.map((series) => (
              <polyline
                key={series.key}
                points={series.points}
                fill="none"
                stroke={series.color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            <line
              x1={(currentTimeMs / durationMs) * 1000}
              y1="20"
              x2={(currentTimeMs / durationMs) * 1000}
              y2="180"
              stroke="#111827"
              strokeWidth="2"
              opacity="0.7"
            />
          </svg>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-2xl border border-gray-200 bg-slate-950 p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between text-xs text-slate-200">
            <span>Original viewport size</span>
            <span className="font-mono">
              {viewportWidth} x {viewportHeight}
            </span>
          </div>
          <div
            ref={viewportHostRef}
            className="max-h-[75vh] overflow-auto rounded-xl border border-slate-700 bg-slate-900 p-3"
          >
            <div className="mb-3 rounded-lg border border-slate-700 bg-slate-950/50 p-2">
              <div className="mb-2 flex items-center justify-between text-[11px] text-slate-300">
                <span>Pixel Replay (1 FPS)</span>
                <span className="font-mono">
                  {formatTimestamp(currentAbsoluteMs)}
                  {isUsingDomFallbackImage ? ' • DOM fallback' : ''}
                </span>
              </div>
              {currentSnapshotImageDataUrl ? (
                <img
                  src={currentSnapshotImageDataUrl}
                  alt="Pixel screenshot replay"
                  className="w-full rounded-md border border-slate-700 bg-black object-contain"
                  style={{ aspectRatio: `${Math.max(1, viewportWidth)} / ${Math.max(1, viewportHeight)}` }}
                />
              ) : !hasCurrentSnapshotContent ? (
                <div className="flex aspect-video items-center justify-center rounded-md bg-slate-900 text-xs text-slate-400">
                  Loading pixel snapshot...
                </div>
              ) : (
                <div className="flex aspect-video items-center justify-center rounded-md bg-slate-900 text-xs text-slate-400">
                  No pixel snapshot available.
                </div>
              )}
            </div>
            <div
              className="relative overflow-hidden rounded-lg bg-white shadow-[0_0_0_1px_rgba(148,163,184,0.25)]"
              style={{
                width: `${scaledViewportWidth}px`,
                height: `${scaledViewportHeight}px`,
                minWidth: `${scaledViewportWidth}px`,
                minHeight: `${scaledViewportHeight}px`,
              }}
            >
              <iframe
                key={currentSnapshot?.id}
                ref={iframeRef}
                title="Session replay"
                sandbox="allow-same-origin"
                srcDoc={currentSnapshotWithContent?.html}
                className="absolute left-0 top-0 bg-white"
                style={{
                  width: `${viewportWidth}px`,
                  height: `${viewportHeight}px`,
                  transform: `scale(${contentScale})`,
                  transformOrigin: 'top left',
                }}
                onLoad={() => {
                  try {
                    iframeRef.current?.contentWindow?.scrollTo(
                      currentSnapshot?.scrollX ?? 0,
                      currentScrollY,
                    );
                  } catch {
                    // Ignore iframe sync failures
                  }
                }}
              />

              {currentGaze && (
                <div
                  className="pointer-events-none absolute z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-100 bg-cyan-400/80 shadow-[0_0_18px_rgba(34,211,238,0.8)]"
                  style={{
                    left: `${(currentGaze.gazeX / viewportWidth) * 100}%`,
                    top: `${(currentGaze.gazeY / viewportHeight) * 100}%`,
                  }}
                />
              )}

              {currentClick && (
                <div
                  className="pointer-events-none absolute z-10 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-200 bg-amber-400/25"
                  style={{
                    left: `${(currentClick.x / viewportWidth) * 100}%`,
                    top: `${(currentClick.y / viewportHeight) * 100}%`,
                  }}
                />
              )}

            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600">
            <h3 className="text-sm font-semibold text-gray-900">Camera Frame</h3>
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-2">
              {currentRecordingSegment ? (
                segmentVideoUrls[currentRecordingSegment.id] === undefined ? (
                  <div className="flex aspect-video items-center justify-center rounded-md bg-gray-100 text-gray-500">
                    Loading camera segment...
                  </div>
                ) : segmentVideoUrls[currentRecordingSegment.id] ? (
                  <video
                    key={currentRecordingSegment.id}
                    ref={cameraVideoRef}
                    src={segmentVideoUrls[currentRecordingSegment.id]}
                    className="aspect-video w-full rounded-md bg-black"
                    muted
                    playsInline
                    controls
                    preload="metadata"
                  />
                ) : (
                  <div className="flex aspect-video items-center justify-center rounded-md bg-gray-100 text-gray-500">
                    Camera segment unavailable.
                  </div>
                )
              ) : (
                <div className="flex aspect-video items-center justify-center rounded-md bg-gray-100 text-gray-500">
                  No camera recording segment for current replay time.
                </div>
              )}
            </div>
            {currentRecordingSegment && (
              <p className="mt-2 text-[11px] text-gray-500">
                Segment window: {formatTimestamp(new Date(currentRecordingSegment.startWallTime).getTime())}
                {' - '}
                {currentRecordingSegment.endWallTime
                  ? formatTimestamp(new Date(currentRecordingSegment.endWallTime).getTime())
                  : 'ongoing'}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600">
            <h3 className="text-sm font-semibold text-gray-900">Facial Signals</h3>
            <div className="mt-3 space-y-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-400">
                  Emotion probabilities
                </p>
                {currentEmotionFrame ? (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {[
                      ['Happy', currentEmotionFrame.pHappiness],
                      ['Sad', currentEmotionFrame.pSadness],
                      ['Surprise', currentEmotionFrame.pSurprise],
                      ['Fear', currentEmotionFrame.pFear],
                      ['Anger', currentEmotionFrame.pAnger],
                      ['Disgust', currentEmotionFrame.pDisgust],
                      ['Contempt', currentEmotionFrame.pContempt],
                      ['Neutral', currentEmotionFrame.pNeutral],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-md bg-gray-50 px-2 py-1.5">
                        <div className="text-[11px] text-gray-500">{label}</div>
                        <div className="font-medium text-gray-800">
                          {typeof value === 'number' ? value.toFixed(2) : '-'}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2">No nearby emotion frame.</p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] uppercase tracking-wide text-gray-400">Learning state</p>
                  <button
                    type="button"
                    onClick={() => setLearningThresholds(DEFAULT_THRESHOLDS)}
                    className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50"
                  >
                    Reset thresholds
                  </button>
                </div>
                {learningState ? (
                  <div className="mt-2 space-y-2">
                    <div className="rounded-md bg-gray-50 px-2 py-1.5">
                      <div className="text-[11px] text-gray-500">Predicted state</div>
                      <div className="font-medium text-gray-800">{learningState.predicted}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(learningState.scores).map(([state, score]) => (
                        <div key={state} className="rounded-md bg-gray-50 px-2 py-1.5">
                          <div className="text-[11px] capitalize text-gray-500">{state} score</div>
                          <div className="font-medium text-gray-800">{score.toFixed(3)}</div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2 rounded-md border border-gray-200 bg-white p-2">
                      {(
                        [
                          ['engagement_score', 'Engagement score'],
                          ['boredom_score', 'Boredom score'],
                          ['confusion_surprise', 'Confusion surprise'],
                          ['confusion_fear', 'Confusion fear'],
                          ['confusion_anger', 'Confusion anger'],
                          ['confusion_disgust', 'Confusion disgust'],
                          ['frustration_sad', 'Frustration sad'],
                          ['frustration_anger', 'Frustration anger'],
                          ['frustration_disgust', 'Frustration disgust'],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key} className="block">
                          <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-gray-500">
                            <span>{label}</span>
                            <span className="font-mono text-gray-700">
                              {learningThresholds[key].toFixed(2)}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={learningThresholds[key]}
                            onChange={(event) => {
                              const nextValue = Number(event.target.value);
                              setLearningThresholds((prev) => ({ ...prev, [key]: nextValue }));
                            }}
                            className="w-full"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-2">No nearby emotion frame.</p>
                )}
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-400">Top action units</p>
                <div className="mt-2 space-y-2">
                  {topAus.length > 0 ? (
                    topAus.map((au) => (
                      <div key={au.key} className="flex items-center justify-between gap-3">
                        <span className="font-medium text-gray-700">{au.label}</span>
                        <span className="font-mono text-gray-800">{(au.value ?? 0).toFixed(2)}</span>
                      </div>
                    ))
                  ) : (
                    <p>No nearby AU frame.</p>
                  )}
                </div>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-400">Pupil size</p>
                <div className="mt-2 rounded-md bg-gray-50 px-2 py-1.5">
                  <div className="text-[11px] text-gray-500">Pupil diameter</div>
                  <div className="font-medium text-gray-800">
                    {currentPupil ? currentPupil.pupilDiameter.toFixed(2) : 'No recent pupil sample'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-900">Replay State</h3>
            <dl className="mt-3 space-y-2 text-xs text-gray-600">
              <div className="flex items-start justify-between gap-3">
                <dt>URL</dt>
                <dd className="max-w-[210px] break-all text-right font-mono text-[11px]">
                  {currentSnapshot?.pageUrl}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt>Snapshot trigger</dt>
                <dd className="font-medium text-gray-800">{currentSnapshot?.trigger}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt>Viewport</dt>
                <dd className="font-medium text-gray-800">
                  {viewportWidth} x {viewportHeight}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt>Captured at</dt>
                <dd className="font-medium text-gray-800">
                  {currentSnapshot ? formatTimestamp(currentSnapshot.capturedAt) : 'Unknown'}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt>Scroll Y</dt>
                <dd className="font-medium text-gray-800">{Math.round(currentScrollY)} px</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt>Eye gaze</dt>
                <dd className="font-medium text-gray-800">
                  {currentGaze
                    ? `${Math.round(currentGaze.gazeX)}, ${Math.round(currentGaze.gazeY)}`
                    : 'No recent gaze sample'}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt>Expression</dt>
                <dd className="font-medium text-gray-800">
                  {currentEmotionFrame?.dominantEmotion ?? 'No recent face frame'}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt>Last click</dt>
                <dd className="max-w-[210px] text-right text-gray-800">
                  {currentClick?.elementText?.trim() || currentClick?.elementSelector || 'None'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600">
            <h3 className="text-sm font-semibold text-gray-900">Coverage</h3>
            <div className="mt-3 space-y-2">
              <p>{data.snapshots.length} DOM snapshots captured</p>
              {isLoadingSnapshots && (
                <p className="text-gray-500">
                  Loading remaining snapshots: {snapshotLoadProgress.loaded} /{' '}
                  {snapshotLoadProgress.total || data.snapshotCount || '?'}
                </p>
              )}
              <p>
                DOM cadence:{' '}
                {snapshotStats.averageGapMs
                  ? `avg every ${formatDuration(snapshotStats.averageGapMs)}`
                  : 'single snapshot only'}
              </p>
              <p>
                Recording mode: fixed periodic snapshots every 1s
              </p>
              <p>{data.clickLogs.length} click events recorded</p>
              <p>{data.gazeLogs.length} gaze samples recorded</p>
              <p>{data.pupilLogs.length} pupil-size samples recorded</p>
              <p>{data.scrollLogs.length} scroll updates recorded</p>
              <p>{data.emotionFrames.length} emotion frames available</p>
              <p>{data.auResults.length} AU frames available</p>
              <p>
                {data.diagnostics?.recordingSegments.length ?? 0} recording segments in this session
              </p>
              <p>
                OpenFace3 jobs:{' '}
                {data.diagnostics?.openface3Jobs.length
                  ? data.diagnostics.openface3Jobs.map((job) => job.status).join(', ')
                  : 'none'}
              </p>
              <p>
                PyFeat jobs:{' '}
                {data.diagnostics?.pyfeatJobs.length
                  ? data.diagnostics.pyfeatJobs.map((job) => job.status).join(', ')
                  : 'none'}
              </p>
              {failedPyfeatJobs.length > 0 && (
                <div className="pt-2">
                  <button
                    type="button"
                    disabled={isRetryingPyfeat}
                    onClick={async () => {
                      setIsRetryingPyfeat(true);
                      try {
                        await Promise.all(
                          failedPyfeatJobs.map((job) => api.post(`/pyfeat/jobs/${job.id}/retry`)),
                        );
                        await refresh();
                      } finally {
                        setIsRetryingPyfeat(false);
                      }
                    }}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRetryingPyfeat
                      ? 'Retrying failed PyFeat jobs...'
                      : `Retry failed PyFeat jobs (${failedPyfeatJobs.length})`}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
