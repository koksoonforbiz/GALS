/**
 * Bundle format types (v2 since 2026-11-26) + the data-source contract the
 * exporter consumes. v2 = v1 + ids and the event envelope on activity rows,
 * keystroke/clipboard text and copy provenance, learning-event provenance,
 * capture quality, the intervention ledger, LLM turns and outcomes
 * (docs/process-mining/BUNDLE_SCHEMA.md). Every v1 file and field is kept,
 * so a v1 reader still loads a v2 bundle (it ignores the new files).
 *
 * The export orchestration depends ONLY on `SessionDataSource`, never on
 * Prisma directly, so the smoke test can feed an in-memory fixture and the
 * real CLI can feed a Prisma-backed source — same bundle either way.
 */

export const BUNDLE_VERSION = 2 as const;
export const EXPORTER_VERSION = '2.0.0' as const;

/** A single integrity entry for a written file. */
export interface FileIntegrity {
  sha256: string;
  byteSize: number;
}

export interface BundleManifest {
  bundleVersion: typeof BUNDLE_VERSION;
  exporterVersion: string;
  exportedAt: string;
  sessionId: string;
  userId: string;
  courseId: string;
  moduleId?: string;
  timezone: string;
  baseWallClockMs: number;
  durationMs: number;
  counts: Record<string, number>;
  files: Record<string, FileIntegrity>;
  notes: string[];
}

export interface SessionJson {
  session: {
    id: string;
    userId: string;
    courseId: string;
    moduleId?: string;
    startedAt: string;
    endedAt?: string | null;
    durationSecs?: number | null;
    userAgent?: string | null;
    device?: string | null;
    /** v2: how the session ended and how to regroup it (Prompt B, P2). */
    closeReason?: string | null;
    paramsVersion?: string | null;
    previousSessionId?: string | null;
    episodeKey?: string | null;
    clockOffsetMs?: number | null;
  };
  syncAnchor: {
    wallClockMs: number;
    monotonicMs: number;
    serverReceiveMs: number;
    timezone?: string | null;
    userAgent?: string | null;
  } | null;
  context: {
    userDisplayName?: string | null;
    courseTitle?: string | null;
    moduleTitle?: string | null;
  };
}

export interface SnapshotRecord {
  snapshotId: string;
  wallMs: number;
  trigger: string;
  pageUrl: string;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  aois: unknown;
  scrollHosts: unknown;
  pdfCurrentPage: number | null;
  pdfTotalPages: number | null;
  /** Raw DOM HTML, written verbatim to <snapshotId>.html. */
  html: string;
  /** data:image/jpeg;base64,... decoded to <snapshotId>.jpg when present. */
  screenshotDataUrl: string | null;
}

export interface WebcamSegmentSource {
  segmentId: string;
  startWallMs: number;
  endWallMs: number | null;
  durationMs: number | null;
  mimeType: string;
  /** blob storage key to fetch the bytes from (MinIO/S3). */
  blobKey: string;
}

/** A wall-clock-stamped JSONL record (the line written to a stream file). */
export type StreamRecord = { wallMs: number } & Record<string, unknown>;

/**
 * The set of stream files the exporter writes. Keep in sync with BUNDLE_SPEC.md.
 */
export const STREAM_FILES = {
  webgazer: 'streams/webgazer.jsonl',
  pupil: 'streams/pupil.jsonl',
  emotion_frames: 'streams/emotion_frames.jsonl',
  au_results: 'streams/au_results.jsonl',
  clicks: 'streams/clicks.jsonl',
  scrolls: 'streams/scrolls.jsonl',
  cursors: 'streams/cursors.jsonl',
  keystrokes: 'streams/keystrokes.jsonl',
  clipboard: 'streams/clipboard.jsonl',
  visibility: 'streams/visibility.jsonl',
  viewport: 'streams/viewport.jsonl',
  activity: 'streams/activity.jsonl',
  chatbot: 'messages/chatbot.jsonl',
  dialogue: 'messages/dialogue.jsonl',
  interventions: 'messages/interventions.jsonl',
  ef_detections: 'messages/ef_detections.jsonl',
  cards: 'kc/cards.jsonl',
  attempts: 'kc/attempts.jsonl',
  probes: 'probes/probes.jsonl',
  questionnaires: 'questionnaires/questionnaires.jsonl',
  annotations: 'annotations/annotations.jsonl',
  codes: 'annotations/codes.jsonl',
  // Prompting course: server-derived learning events (apps/api learning-events)
  learning_events: 'derived/learning_events.jsonl',
  // ── v2 (Prompt B, P7) ──
  parse_runs: 'derived/parse_runs.jsonl',
  coverage: 'derived/coverage.jsonl',
  parameter_snapshots: 'derived/parameter_snapshots.jsonl',
  library: 'derived/library.jsonl',
  ingest_issues: 'quality/ingest_issues.jsonl',
  capture_quality: 'quality/capture_quality.jsonl',
  intervention_ledger: 'interventions/ledger.jsonl',
  llm_turns: 'messages/llm_turns.jsonl',
  knowledge_tests: 'outcomes/knowledge_tests.jsonl',
  knowledge_test_scores: 'outcomes/knowledge_test_scores.jsonl',
  efa_occasions: 'outcomes/efa_occasions.jsonl',
  efa_task_runs: 'outcomes/efa_task_runs.jsonl',
  efa_trials: 'outcomes/efa_trials.jsonl',
  efa_answers: 'outcomes/efa_answers.jsonl',
  efa_task_scores: 'outcomes/efa_task_scores.jsonl',
  promptlab_runs: 'promptlab/runs.jsonl',
  promptlab_versions: 'promptlab/versions.jsonl',
  promptlab_test_cases: 'promptlab/test_cases.jsonl',
  promptlab_test_results: 'promptlab/test_results.jsonl',
  promptlab_ratings: 'promptlab/ratings.jsonl',
  slide_states: 'lesson/slide_states.jsonl',
  study_notes: 'notes/study_notes.jsonl',
} as const;

export type StreamKey = keyof typeof STREAM_FILES;

/** Streams that may be large and are streamed row-by-row. */
export const LARGE_STREAMS: StreamKey[] = ['webgazer', 'cursors', 'au_results', 'emotion_frames'];

/** Per-student streams (queried by user, not session): never set the session's duration. */
export const USER_SCOPED_STREAMS: StreamKey[] = ['cards', 'attempts'];

/**
 * Rows stamped when they were computed or recorded, not when the learner
 * acted (quality, parse runs, outcomes): they never set the session's
 * duration either.
 */
export const UNTIMED_STREAMS: StreamKey[] = [
  'parse_runs',
  'coverage',
  'parameter_snapshots',
  'library',
  'ingest_issues',
  'capture_quality',
  'intervention_ledger',
  'llm_turns',
  'knowledge_tests',
  'knowledge_test_scores',
  'efa_occasions',
  'efa_task_runs',
  'efa_trials',
  'efa_answers',
  'efa_task_scores',
  'promptlab_runs',
  'promptlab_versions',
  'promptlab_test_cases',
  'promptlab_test_results',
  'promptlab_ratings',
  'slide_states',
  'study_notes',
];

/** Optional streams whose file is omitted entirely when empty. */
export const OPTIONAL_STREAMS: StreamKey[] = [
  'probes',
  'questionnaires',
  'annotations',
  'codes',
  'learning_events',
  'parse_runs',
  'coverage',
  'parameter_snapshots',
  'library',
  'ingest_issues',
  'capture_quality',
  'intervention_ledger',
  'llm_turns',
  'knowledge_tests',
  'knowledge_test_scores',
  'efa_occasions',
  'efa_task_runs',
  'efa_trials',
  'efa_answers',
  'efa_task_scores',
  'promptlab_runs',
  'promptlab_versions',
  'promptlab_test_cases',
  'promptlab_test_results',
  'promptlab_ratings',
  'slide_states',
  'study_notes',
];

export interface SessionMeta {
  sessionId: string;
  userId: string;
  courseId: string;
  moduleId?: string;
  timezone: string;
  startedAtMs: number;
  endedAtMs: number | null;
  durationSecs: number | null;
}

/**
 * The contract the exporter pulls from. A real implementation wraps Prisma +
 * the S3/MinIO client; the test implementation is a plain in-memory fixture.
 */
export interface SessionDataSource {
  /** Core session metadata + the time anchor inputs. */
  getSessionMeta(sessionId: string): Promise<SessionMeta>;
  /** The full session.json payload. */
  getSessionJson(sessionId: string): Promise<SessionJson>;
  /** Earliest sync-anchor wall ms (or null when no anchor). */
  getSyncAnchorWallMs(sessionId: string): Promise<number | null>;
  /** Ordered (by capturedAt) snapshot rows including html + screenshot data url. */
  getSnapshots(sessionId: string): AsyncIterable<SnapshotRecord>;
  /** Webcam segment metadata (bytes fetched separately via getBlob). */
  getWebcamSegments(sessionId: string): Promise<WebcamSegmentSource[]>;
  /** Fetch raw blob bytes for a webcam segment; null/throw when missing. */
  getBlob(blobKey: string): Promise<Buffer | null>;
  /** A JSONL stream's records, each with a finite `wallMs`. */
  getStream(sessionId: string, key: StreamKey): AsyncIterable<StreamRecord>;
}

export interface ExportOptions {
  sessionId: string;
  outDir: string;
  zip?: boolean;
  includeWebcam?: boolean;
  force?: boolean;
  /** Fixed timestamp for deterministic reruns in tests. */
  exportedAt?: string;
  log?: (msg: string) => void;
}

export interface ExportResult {
  bundleDir: string;
  zipPath?: string;
  manifest: BundleManifest;
  missingWebcamSegments: string[];
}
