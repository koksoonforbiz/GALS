import { Injectable } from '@nestjs/common';
import type {
  MappingRuleSet,
  AffectiveStateRule,
  Term,
  EmotionGroup,
} from '@ats/shared/src/affective-mapping';

interface EmotionMeans {
  pHappiness: number;
  pSadness: number;
  pSurprise: number;
  pFear: number;
  pAnger: number;
  pDisgust: number;
  pContempt: number;
  pNeutral: number;
}

export interface WindowResult {
  engagement: number;
  boredom: number;
  confusion: number;
  frustration: number;
  dominantState: string;
  means: EmotionMeans;
}

function resolveTerm(term: Term, means: EmotionMeans): number {
  if (typeof term === 'string') {
    return means[term] ?? 0;
  }
  const group = term as EmotionGroup;
  const values = group.fields.map((f) => means[f] ?? 0);
  if (values.length === 0) return 0;
  switch (group.op) {
    case 'max':
      return Math.max(...values);
    case 'min':
      return Math.min(...values);
    case 'mean':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    default:
      return 0;
  }
}

function evaluateRule(rule: AffectiveStateRule, means: EmotionMeans): number {
  const termValues = rule.terms.map((wt) => ({
    value: resolveTerm(wt.term, means),
    weight: wt.weight,
  }));

  let result: number;

  switch (rule.combinator) {
    case 'weighted_sum':
      result = termValues.reduce((acc, tv) => acc + tv.value * tv.weight, 0);
      break;
    case 'disjunctive':
      result = Math.max(...termValues.map((tv) => tv.value));
      break;
    case 'conjunctive':
      result = Math.min(...termValues.map((tv) => tv.value));
      break;
    case 'product':
      result = termValues.reduce((acc, tv) => acc * Math.pow(tv.value, tv.weight), 1);
      break;
    default:
      result = 0;
  }

  if (rule.lowArousalModifier) {
    const arousalMax = Math.max(...rule.lowArousalModifier.fields.map((f) => means[f] ?? 0));
    result *= 1 - arousalMax;
  }

  if (rule.threshold && result < rule.threshold) {
    result = 0;
  }

  if (rule.clamp01 !== false) {
    result = Math.max(0, Math.min(1, result));
  }

  return Math.round(result * 1000) / 1000;
}

@Injectable()
export class MappingEngineService {
  computeWindow(
    frames: Array<{
      faceDetected: boolean;
      pHappiness: number | null;
      pSadness: number | null;
      pSurprise: number | null;
      pFear: number | null;
      pAnger: number | null;
      pDisgust: number | null;
      pContempt: number | null;
      pNeutral: number | null;
    }>,
    ruleSet: MappingRuleSet,
    minFramesPerWindow: number,
  ): WindowResult | null {
    const faceFrames = frames.filter((f) => f.faceDetected);
    if (faceFrames.length < minFramesPerWindow) return null;

    const n = faceFrames.length;
    const means: EmotionMeans = {
      pHappiness: faceFrames.reduce((s, f) => s + (f.pHappiness ?? 0), 0) / n,
      pSadness: faceFrames.reduce((s, f) => s + (f.pSadness ?? 0), 0) / n,
      pSurprise: faceFrames.reduce((s, f) => s + (f.pSurprise ?? 0), 0) / n,
      pFear: faceFrames.reduce((s, f) => s + (f.pFear ?? 0), 0) / n,
      pAnger: faceFrames.reduce((s, f) => s + (f.pAnger ?? 0), 0) / n,
      pDisgust: faceFrames.reduce((s, f) => s + (f.pDisgust ?? 0), 0) / n,
      pContempt: faceFrames.reduce((s, f) => s + (f.pContempt ?? 0), 0) / n,
      pNeutral: faceFrames.reduce((s, f) => s + (f.pNeutral ?? 0), 0) / n,
    };

    const scores: Record<string, number> = {};
    for (const rule of ruleSet.rules) {
      scores[rule.state] = evaluateRule(rule, means);
    }

    const states = ['engagement', 'boredom', 'confusion', 'frustration'];
    let dominantState = 'none';
    let maxScore = 0;
    for (const s of states) {
      if ((scores[s] ?? 0) > maxScore) {
        maxScore = scores[s] ?? 0;
        dominantState = s;
      }
    }

    return {
      engagement: scores['engagement'] ?? 0,
      boredom: scores['boredom'] ?? 0,
      confusion: scores['confusion'] ?? 0,
      frustration: scores['frustration'] ?? 0,
      dominantState,
      means,
    };
  }
}
