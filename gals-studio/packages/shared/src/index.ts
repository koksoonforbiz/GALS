// Bundle format: spec constants, zod schemas, validator.
export * from './bundle/spec.js';
export * from './bundle/schemas.js';
export * from './bundle/validate.js';

// Canonical codebook.
export * from './codebook/index.js';

// Analysis algorithms (pure, unit-tested).
export * from './analysis/index.js';

// Coding domain types shared by server + web.
export type CodingPass =
  | 'primary_rater_1'
  | 'primary_rater_2'
  | 'tiebreaker'
  | 'gold_consensus';

export type CoderRole = 'trained_rater' | 'tiebreaker' | 'teacher' | 'expert';
