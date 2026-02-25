interface SM2Input {
  ease: number;
  interval: number;
  repetitions: number;
}

interface SM2Result {
  ease: number;
  interval: number;
  repetitions: number;
  nextReviewAt: Date;
}

export const QUALITY_MAP = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 5,
} as const;

export type QualityRating = keyof typeof QUALITY_MAP;

export function calculateNextReview(quality: number, current: SM2Input): SM2Result {
  let { ease, interval, repetitions } = current;

  if (quality >= 3) {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.round(interval * ease);
    repetitions += 1;
  } else {
    repetitions = 0;
    interval = 1;
  }

  ease = Math.max(1.3, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));

  const nextReviewAt = new Date();
  nextReviewAt.setDate(nextReviewAt.getDate() + interval);

  return { ease, interval, repetitions, nextReviewAt };
}

export function previewAllRatings(current: SM2Input): Record<QualityRating, SM2Result> {
  return {
    again: calculateNextReview(QUALITY_MAP.again, current),
    hard: calculateNextReview(QUALITY_MAP.hard, current),
    good: calculateNextReview(QUALITY_MAP.good, current),
    easy: calculateNextReview(QUALITY_MAP.easy, current),
  };
}
