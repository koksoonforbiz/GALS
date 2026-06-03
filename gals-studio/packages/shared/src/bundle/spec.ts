/**
 * Bundle format constants — version 1. Mirrors tools/gals-export/BUNDLE_SPEC.md.
 * Kept in one place so the importer, validators, and exporter agree.
 */
export const BUNDLE_VERSION = 1 as const;

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
  mastery: 'kc/mastery.jsonl',
  cards: 'kc/cards.jsonl',
  attempts: 'kc/attempts.jsonl',
  probes: 'probes/probes.jsonl',
  questionnaires: 'questionnaires/questionnaires.jsonl',
  annotations: 'annotations/annotations.jsonl',
  codes: 'annotations/codes.jsonl',
} as const;

export type StreamKey = keyof typeof STREAM_FILES;

export const REQUIRED_FILES = [
  'manifest.json',
  'session.json',
  'snapshots/index.json',
  'webcam/index.json',
] as const;

/** Fixed coding-window length, in ms (methods-review requirement). */
export const WINDOW_MS = 20_000;

/** Deterministic coding-window id. */
export const windowId = (sessionId: string, index: number): string => `${sessionId}:${index}`;

/** Number of 20s windows spanning a session duration. */
export const windowCount = (durationMs: number): number =>
  Math.max(1, Math.ceil(durationMs / WINDOW_MS));
