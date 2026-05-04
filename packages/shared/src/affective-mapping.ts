export type EmotionField =
  | 'pHappiness'
  | 'pSadness'
  | 'pSurprise'
  | 'pFear'
  | 'pAnger'
  | 'pDisgust'
  | 'pContempt'
  | 'pNeutral';

export interface EmotionGroup {
  op: 'max' | 'min' | 'mean' | 'sum';
  fields: EmotionField[];
}

export type Term = EmotionField | EmotionGroup;

export interface WeightedTerm {
  term: Term;
  weight: number;
}

export interface AffectiveStateRule {
  state: 'engagement' | 'boredom' | 'confusion' | 'frustration';
  combinator: 'weighted_sum' | 'disjunctive' | 'conjunctive' | 'product';
  terms: WeightedTerm[];
  lowArousalModifier?: { fields: EmotionField[] };
  threshold?: number;
  clamp01?: boolean;
}

export interface MappingRuleSet {
  schemaVersion: 1;
  rules: AffectiveStateRule[];
}

export const DEFAULT_MAPPING: MappingRuleSet = {
  schemaVersion: 1,
  rules: [
    {
      state: 'engagement',
      combinator: 'weighted_sum',
      terms: [
        { term: 'pNeutral', weight: 0.45 },
        { term: 'pHappiness', weight: 0.35 },
        { term: 'pSurprise', weight: 0.2 },
      ],
      clamp01: true,
    },
    {
      state: 'frustration',
      combinator: 'disjunctive',
      terms: [
        { term: 'pDisgust', weight: 1 },
        { term: 'pAnger', weight: 1 },
        { term: { op: 'max', fields: ['pSadness', 'pContempt'] }, weight: 1 },
      ],
      clamp01: true,
    },
    {
      state: 'confusion',
      combinator: 'conjunctive',
      terms: [
        { term: 'pAnger', weight: 1 },
        { term: 'pDisgust', weight: 1 },
        { term: { op: 'max', fields: ['pSurprise', 'pFear'] }, weight: 1 },
      ],
      clamp01: true,
    },
    {
      state: 'boredom',
      combinator: 'weighted_sum',
      terms: [
        { term: 'pNeutral', weight: 0.55 },
        { term: 'pSadness', weight: 0.3 },
        { term: 'pDisgust', weight: 0.15 },
      ],
      lowArousalModifier: {
        fields: ['pSurprise', 'pHappiness', 'pAnger', 'pFear'],
      },
      clamp01: true,
    },
  ],
};
