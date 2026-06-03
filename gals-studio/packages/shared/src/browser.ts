// Browser-safe barrel: everything EXCEPT the node-only bundle validator
// (which imports node:fs/node:crypto). The web app imports from here.
export * from './bundle/spec.js';
export * from './bundle/schemas.js';
export * from './codebook/index.js';
export * from './analysis/index.js';

export type CodingPass =
  | 'primary_rater_1'
  | 'primary_rater_2'
  | 'tiebreaker'
  | 'gold_consensus';
export type CoderRole = 'trained_rater' | 'tiebreaker' | 'teacher' | 'expert';
