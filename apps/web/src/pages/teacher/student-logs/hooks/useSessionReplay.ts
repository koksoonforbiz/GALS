import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../../lib/api';

export interface SessionReplayAoiRect {
  region: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Per-snapshot inner-scroll-host state. window.scrollY is a dead
// signal in the docked course-view layout because the lesson MDX and
// the PDF reader scroll inside inner `overflow-y-auto` containers,
// so this is where the actual reading position lives. See the
// recorder doc-comment for the coordinate contract.
export interface SessionReplayScrollHost {
  region: string | null;
  selector: string | null;
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  clientHeight: number;
  clientWidth: number;
  scrollTopPercent: number;
}

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
  // Nullable for legacy rows captured before AOI support shipped. Also
  // null when the page had no `[data-replay-region]` markers (e.g.
  // teacher pages, dialogue mode) — the recorder simply omits the
  // field there.
  aois?: SessionReplayAoiRect[] | null;
  // Nullable for the same reasons as `aois` — legacy rows captured
  // before the per-host capture shipped (prompt 06), plus any page
  // where capture failed inside the recorder's defensive try/catch.
  scrollHosts?: SessionReplayScrollHost[] | null;
  // 1-based PDF current page + total. Present only when a PdfReader
  // was mounted at capture time. Used by the replay restore as a
  // fallback target when scroll-host restoration is unreliable
  // (canvas → <img> swap may still be decoding when iframe.onload
  // fires) and by the CSV exporter as a per-bin row.
  pdfCurrentPage?: number | null;
  pdfTotalPages?: number | null;
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

// Backend now also surfaces intervention activity, EF text-mining
// detections, and chat turns so the Replay timeline can show what the
// student *did* alongside what they *looked at*.
export interface SessionReplayActivityLog {
  id: string;
  action: string;
  occurredAt: string;
  courseId?: string | null;
  moduleId?: string | null;
  moduleItemId?: string | null;
  interventionId?: string | null;
  attemptId?: string | null;
  dialogueSessionId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SessionReplayEfDetection {
  id: string;
  messageId: string;
  constructKey: string;
  label: string;
  confidence?: number | null;
  severity?: number | null;
  rationale?: string | null;
  createdAt: string;
}

export interface SessionReplayDialogueMessage {
  id: string;
  sessionId: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  tokenUsage?: unknown;
  createdAt: string;
}

export interface SessionReplayChatbotMessage {
  id: string;
  // Present so the Coverage panel can distinguish session-anchored
  // turns from time-window fallback recoveries. Most turns will
  // match the current session's id.
  studentSessionId?: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  contextSource?: string | null;
  selectedText?: string | null;
  suggestedStrategy?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  model?: string | null;
  moduleItemId?: string | null;
  createdAt: string;
}

// Lightweight interaction streams surfaced for CSV export. Stored
// per-batch summaries (keystroke counts per field, mouse trajectory
// samples, copy/paste events, tab-visibility transitions).
export interface SessionReplayKeystrokeLog {
  id: string;
  fieldId: string;
  keystrokeCount: number;
  pauseDurationMs: number;
  typingSpeedWPM?: number | null;
  timestamp: number;
}

export interface SessionReplayCursorLog {
  id: string;
  x: number;
  y: number;
  pageUrl: string;
  elementTarget?: string | null;
  timestamp: number;
}

export interface SessionReplayClipboardLog {
  id: string;
  action: string;
  textLength: number;
  sourceElement?: string | null;
  pageUrl: string;
  timestamp: number;
}

export interface SessionReplayVisibilityLog {
  id: string;
  visibleState: string;
  pageUrl: string;
  hiddenDurationMs?: number | null;
  timestamp: number;
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
    // Per-source message counts. Used by the Coverage panel to flag
    // dropped turns — a non-zero `chatbotFromFallback` means the
    // student+time-window union recovered messages whose session id
    // didn't match, which is a signal the chatbot's session-id
    // wiring is missing some turns.
    messageCounts?: {
      dialogueFetched: number;
      chatbotFetched: number;
      chatbotSessionAnchored: number;
      chatbotFromFallback: number;
      messageWindowStartIso: string | null;
      messageWindowEndIso: string | null;
    };
  };
  activityLogs?: SessionReplayActivityLog[];
  efDetections?: SessionReplayEfDetection[];
  dialogueMessages?: SessionReplayDialogueMessage[];
  chatbotMessages?: SessionReplayChatbotMessage[];
  keystrokeLogs?: SessionReplayKeystrokeLog[];
  cursorLogs?: SessionReplayCursorLog[];
  clipboardLogs?: SessionReplayClipboardLog[];
  visibilityLogs?: SessionReplayVisibilityLog[];
  /**
   * Per-intervention review payload. Each entry is a hydrated
   * LearningIntervention row whose `sessionData` JSON carries the
   * LLM-generated questions, the student's answers, the graded
   * results, and the final score. Frontend renders one expandable
   * card per entry. May be missing on legacy sessions captured
   * before this field shipped.
   */
  interventions?: SessionReplayIntervention[];
}

/**
 * One intervention session. The shape of `sessionData` varies by
 * intervention type — Practice Testing carries `{ questions[],
 * userAnswers{}, results[], score }`; Interrogative Elaboration carries
 * a different layout. The UI handles each type tolerantly: if a
 * field is missing or malformed, that part of the card renders an
 * empty/pending state rather than crashing.
 */
export interface SessionReplayIntervention {
  id: string;
  type: string;
  status: string;
  selectedText: string;
  sessionData: SessionReplayInterventionSessionData | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  contentId: string | null;
  courseId: string;
  pageType: string | null;
}

/**
 * Tagged union per intervention type. Each one persists a different
 * shape into `LearningIntervention.sessionData`; the renderer
 * dispatches on `intervention.type`. Optional everywhere because
 * the JSON column has no schema enforcement — defend with
 * `Array.isArray` / typeof checks before reading.
 */
export interface SessionReplayInterventionSessionData {
  // ─── PRACTICE_TESTING ────────────────────────────
  questions?: Array<{
    question: string;
    type?: string;
    options?: string[];
    correctAnswer?: string | number;
    explanation?: string;
  }>;
  userAnswers?: Record<string, string | number>;
  results?: Array<{
    question: string;
    userAnswer: string | number | null;
    correctAnswer: string | number;
    correct: boolean;
    feedback?: string;
    explanation?: string;
  }>;
  score?: number;

  // ─── INTERROGATIVE_ELABORATION ───────────────────
  suggestedQuestions?: Array<{
    question: string;
    type?: 'why' | 'how';
    topic?: string;
    difficulty?: 'beginner' | 'intermediate' | 'advanced';
  }>;
  keyConcepts?: string[];
  conversation?: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
    wasSuggested?: boolean;
  }>;
  selectedText?: string;
  questionsAsked?: number;

  // ─── STEPWISE_LEARNING ───────────────────────────
  steps?: Array<{
    stepNumber: number;
    title: string;
    content: string;
    comprehensionCheck?: {
      question: string;
      hint?: string;
      sampleAnswer?: string;
    };
  }>;
  summary?: string;
  currentStep?: number;
  stepResults?: Record<
    string,
    {
      attempts: number;
      passed: boolean;
      userResponses: Array<{
        response: string;
        feedback?: string;
        isCorrect: boolean;
        timestamp?: string;
      }>;
    }
  >;

  // ─── DISTRIBUTED_PRACTICE ────────────────────────
  cards?: Array<{ front: string; back: string }>;

  // Free-form so unknown future types don't break the read.
  [key: string]: unknown;
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
  const [snapshotLoadProgress, setSnapshotLoadProgress] = useState<{
    loaded: number;
    total: number;
  }>({
    loaded: 0,
    total: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [snapshotContentById, setSnapshotContentById] = useState<
    Record<string, SessionReplaySnapshot>
  >({});

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
          const query: string = cursor
            ? `?cursor=${encodeURIComponent(cursor)}&limit=120&includeContent=false`
            : '?limit=120&includeContent=false';
          const page: SessionReplaySnapshotPage = await api.get<SessionReplaySnapshotPage>(
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
