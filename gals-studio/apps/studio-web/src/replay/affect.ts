/**
 * Rule-based affective-state prediction from the 8-class emotion probabilities,
 * with adjustable thresholds (engagement / boredom / confusion / frustration).
 * Mirrors the live tab's local-state predictor — sliders drive the live
 * prediction and the timeline guide lines.
 */

export interface EmotionProbs {
  happiness?: number;
  sadness?: number;
  surprise?: number;
  fear?: number;
  anger?: number;
  disgust?: number;
  contempt?: number;
  neutral?: number;
}

export interface AffectThresholds {
  engagement: number;
  boredom: number;
  confusion: number;
  frustration: number;
}

export const DEFAULT_THRESHOLDS: AffectThresholds = {
  engagement: 0.5,
  boredom: 0.4,
  confusion: 0.35,
  frustration: 0.4,
};

export interface AffectScores {
  engagement: number;
  boredom: number;
  confusion: number;
  frustration: number;
}

/** Heuristic mapping of emotion probabilities to the 4 academic affect states. */
export function affectScores(e: EmotionProbs): AffectScores {
  const g = (v?: number) => v ?? 0;
  // engagement ~ neutral focus + mild happiness; boredom ~ neutral + sadness low arousal;
  // confusion ~ surprise + fear; frustration ~ anger + disgust + contempt.
  return {
    engagement: Math.min(1, 0.6 * g(e.neutral) + 0.6 * g(e.happiness)),
    boredom: Math.min(1, 0.5 * g(e.sadness) + 0.4 * g(e.neutral) - 0.3 * g(e.happiness)),
    confusion: Math.min(1, 0.6 * g(e.surprise) + 0.5 * g(e.fear)),
    frustration: Math.min(1, 0.5 * g(e.anger) + 0.4 * g(e.disgust) + 0.4 * g(e.contempt)),
  };
}

export function predictAffect(e: EmotionProbs, t: AffectThresholds): { state: string; scores: AffectScores } {
  const scores = affectScores(e);
  const candidates: [string, number, number][] = [
    ['frustration', scores.frustration, t.frustration],
    ['confusion', scores.confusion, t.confusion],
    ['boredom', scores.boredom, t.boredom],
    ['engaged_concentration', scores.engagement, t.engagement],
  ];
  let best = 'neutral';
  let bestMargin = 0;
  for (const [name, score, thr] of candidates) {
    const margin = score - thr;
    if (margin > bestMargin) {
      bestMargin = margin;
      best = name;
    }
  }
  return { state: best, scores };
}
