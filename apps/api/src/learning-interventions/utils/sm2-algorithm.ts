/**
 * SM-2 Spaced Repetition Algorithm
 *
 * Implementation of the SuperMemo 2 algorithm for optimal review scheduling.
 * https://www.supermemo.com/en/archives1990-2015/english/ol/sm2
 */

export interface SM2Input {
  ease: number; // current ease factor (starts at 2.5)
  interval: number; // current interval in days
  repetitions: number; // number of consecutive successful reviews
}

export interface SM2Result {
  ease: number;
  interval: number;
  repetitions: number;
  nextReviewAt: Date;
}

/**
 * SM-2 Spaced Repetition Algorithm
 * @param quality - 0-5 rating (0=complete blackout, 5=perfect recall)
 *   Mapped from user buttons: Again=1, Hard=2, Good=3, Easy=5
 */
export function calculateNextReview(quality: number, current: SM2Input): SM2Result {
  let { ease, interval, repetitions } = current;

  if (quality >= 3) {
    // Successful recall
    if (repetitions === 0) {
      interval = 1; // First successful review: 1 day
    } else if (repetitions === 1) {
      interval = 6; // Second successful review: 6 days
    } else {
      interval = Math.round(interval * ease);
    }
    repetitions += 1;
  } else {
    // Failed recall — reset
    repetitions = 0;
    interval = 1;
  }

  // Update ease factor (minimum 1.3)
  ease = Math.max(1.3, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));

  const nextReviewAt = new Date();
  nextReviewAt.setDate(nextReviewAt.getDate() + interval);

  return { ease, interval, repetitions, nextReviewAt };
}

/**
 * Map user-facing button labels to SM-2 quality scores
 */
export const QUALITY_MAP = {
  again: 1, // Complete failure — show again soon
  hard: 2, // Struggled significantly
  good: 3, // Correct with some effort
  easy: 5, // Perfect, effortless recall
} as const;

export type QualityRating = keyof typeof QUALITY_MAP;

/**
 * Calculate preview intervals for each rating option
 * This is used to show the user what interval each button will result in
 */
export function calculatePreviewIntervals(current: SM2Input): Record<QualityRating, number> {
  return {
    again: 1,
    hard: 1,
    good: calculateNextReview(QUALITY_MAP.good, current).interval,
    easy: calculateNextReview(QUALITY_MAP.easy, current).interval,
  };
}

/**
 * Get initial SM2 values for a new card
 */
export function getInitialSM2Values(): SM2Input {
  return {
    ease: 2.5,
    interval: 0,
    repetitions: 0,
  };
}
