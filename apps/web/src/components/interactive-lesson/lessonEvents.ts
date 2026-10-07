/**
 * Course event → ActivityAction mapping for interactive lessons.
 *
 * Pure (no React, no I/O) so it can be unit-tested. The names on the left
 * are the course HTML's own `logEvent` types (course_slides.html); the
 * actions on the right are Process Mining Library v2 names
 * (docs/process-mining/Process_Mining_Library_v2.xlsx, Course Crosswalk;
 * PHASE0_DISCOVERY.md §9). Every event carries slideKey, slideType and
 * libraryVersion; course/module/item ids travel as ActivityLog columns.
 *
 * Text policy (plan rule 5, Phase 6 consent): free text is only attached
 * when `captureText` is true, capped at TEXT_CAP; otherwise `chars` only.
 */
import type { ActivityAction } from '../../lib/activity-log/types';

export const LIBRARY_VERSION = 'v2';
export const TEXT_CAP = 4000;

export type LessonEventName =
  | 'think_submitted'
  | 'predict_submitted'
  | 'reflect_submitted'
  | 'predict_revealed'
  | 'check_answered'
  | 'check_revealed'
  | 'check_missed_noted'
  | 'mcq_rationale'
  | 'mcq_answered'
  | 'misconception_committed'
  | 'misconception_opened'
  | 'misconception_changed'
  | 'results_submitted'
  | 'expect_revealed'
  | 'selfscore_set'
  | 'attempt_started'
  | 'confidence_rated';

export interface LessonEventContext {
  slideKey: string;
  slideType: string;
  /** Active (visible, non-idle) ms on the slide so far. */
  msOnSlide: number;
  /** Wall-clock ms since the slide was entered. */
  msSinceEnter: number;
  /** ms since the commit this reveal follows (same slide + item), if any. */
  msSinceCommit?: number | null;
  /** Consent for storing submitted free text (Phase 6); default false. */
  captureText: boolean;
}

export interface MappedEvent {
  action: ActivityAction;
  metadata: Record<string, unknown>;
}

type Data = Record<string, unknown>;

function textFields(data: Data, captureText: boolean): Data {
  const text = typeof data.text === 'string' ? data.text : '';
  const out: Data = { chars: typeof data.chars === 'number' ? data.chars : text.length };
  if (captureText && text) out.text = text.slice(0, TEXT_CAP);
  return out;
}

/**
 * Commit events: the reveal that follows is matched to them by
 * `commitKey()` to compute msSinceCommit.
 */
export function commitKey(name: LessonEventName, slideKey: string, data: Data): string | null {
  switch (name) {
    case 'think_submitted':
    case 'predict_submitted':
    case 'results_submitted':
      return slideKey;
    case 'check_answered':
      return `${slideKey}:q${String(data.question)}`;
    case 'misconception_committed':
      return `${slideKey}:m${String(data.item)}`;
    default:
      return null;
  }
}

/** The commit a reveal belongs to (same keying as commitKey). */
export function revealCommitKey(
  name: LessonEventName,
  slideKey: string,
  data: Data,
): string | null {
  switch (name) {
    case 'predict_revealed':
    case 'expect_revealed':
      return slideKey;
    case 'check_revealed':
      return `${slideKey}:q${String(data.question)}`;
    case 'misconception_opened':
      return `${slideKey}:m${String(data.item)}`;
    default:
      return null;
  }
}

export function mapLessonEvent(
  name: LessonEventName,
  data: Data,
  ctx: LessonEventContext,
): MappedEvent | null {
  const base: Data = {
    slideKey: ctx.slideKey,
    slideType: ctx.slideType,
    libraryVersion: LIBRARY_VERSION,
  };
  const msOnSlide = Math.round(ctx.msOnSlide);
  const reveal = (revealKind: string, extra: Data = {}): MappedEvent => ({
    action: 'REFERENCE_REVEALED',
    metadata: {
      ...base,
      revealKind,
      ...extra,
      // predict and misconception reveals fire in the same click as the
      // commit (course design), so they are flagged `auto` — not a choice.
      auto: data.auto === true,
      msSinceCommit: ctx.msSinceCommit ?? null,
    },
  });

  switch (name) {
    case 'think_submitted':
    case 'predict_submitted':
      return {
        action: 'PREDICTION_COMMITTED',
        metadata: {
          ...base,
          kind: name === 'think_submitted' ? 'think' : 'predict',
          ...textFields(data, ctx.captureText),
          msOnSlide,
        },
      };
    case 'reflect_submitted': {
      const parts = (data.parts ?? {}) as Record<string, string>;
      const partChars = Object.fromEntries(
        Object.entries(parts).map(([k, v]) => [k, (v ?? '').length]),
      );
      return {
        action: 'REFLECTION_SUBMITTED',
        metadata: {
          ...base,
          ...textFields(data, ctx.captureText),
          partChars,
          ...(ctx.captureText
            ? {
                parts: Object.fromEntries(
                  Object.entries(parts).map(([k, v]) => [k, (v ?? '').slice(0, TEXT_CAP)]),
                ),
              }
            : {}),
          msOnSlide,
        },
      };
    }
    case 'predict_revealed':
      return reveal('predict');
    case 'expect_revealed':
      return reveal('expect');
    case 'check_revealed':
      return reveal('check', { item: data.question });
    case 'misconception_opened':
      return reveal('misconception', { item: data.item });
    case 'check_answered':
      return {
        action: 'SELF_CHECK_SUBMITTED',
        metadata: { ...base, item: data.question, ...textFields(data, ctx.captureText), msOnSlide },
      };
    case 'check_missed_noted': {
      const t = textFields(data, ctx.captureText);
      return {
        action: 'GAP_NOTED',
        // chars: 0 is logged explicitly as "no gap stated" (workbook M15).
        metadata: { ...base, item: data.question, ...t, noGapStated: t.chars === 0 },
      };
    }
    case 'mcq_rationale':
      return {
        action: 'RATIONALE_SUBMITTED',
        metadata: { ...base, ...textFields(data, ctx.captureText), msOnSlide },
      };
    case 'mcq_answered':
      return {
        action: 'MCQ_ANSWERED',
        metadata: {
          ...base,
          option: data.option,
          correct: data.correct,
          attemptNo: typeof data.attemptNo === 'number' ? data.attemptNo : 1,
          misconceptionId: data.misconceptionId ?? null,
          misconceptionTagStatus: data.misconceptionTagStatus ?? null,
          confidence: typeof data.confidence === 'number' ? data.confidence : null,
          msOnSlide,
        },
      };
    case 'misconception_committed':
      return {
        action: 'BELIEF_COMMITTED',
        metadata: {
          ...base,
          item: data.item,
          choice: data.choice,
          ...textFields(data, ctx.captureText),
          msOnSlide,
        },
      };
    case 'misconception_changed':
      return {
        action: 'BELIEF_REVISED',
        metadata: { ...base, item: data.item, changed: data.changed },
      };
    case 'results_submitted':
      return {
        action: 'RESULTS_RECORDED',
        metadata: { ...base, ...textFields(data, ctx.captureText), msOnSlide },
      };
    case 'selfscore_set':
      return {
        action: 'CRITERION_SELF_SCORED',
        metadata: { ...base, criterion: data.criterion, value: data.value },
      };
    case 'confidence_rated':
      return {
        action: 'CONFIDENCE_RATED',
        metadata: {
          ...base,
          item: data.item ?? ctx.slideKey,
          value: data.value,
          timing: data.timing,
        },
      };
    case 'attempt_started':
      return {
        action: 'ATTEMPT_STARTED',
        metadata: {
          ...base,
          fieldKey: data.fieldKey,
          msFromSlideEnter: Math.round(ctx.msSinceEnter),
        },
      };
    default:
      return null;
  }
}
