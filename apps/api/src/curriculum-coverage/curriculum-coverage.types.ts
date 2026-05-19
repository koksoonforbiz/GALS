// ─── Input Types ────────────────────────────────────────

export interface StartCoverageInput {
  courseId: string;
  userId: string;
  syllabusText: string;
}

// ─── Parsed Syllabus Outcomes ───────────────────────────

export interface SyllabusOutcome {
  id: string; // generated sequential e.g. "SO-1", "SO-2"
  code: string; // original code if found, else same as id
  description: string;
  bloomLevel: string | null; // e.g. "Apply", "Analyze"
  category: string | null; // grouping/section from syllabus
}

// ─── Outcome → KC Mapping ───────────────────────────────

export interface OutcomeKcMap {
  outcomeId: string;
  kcId: string;
  kcName: string;
  confidence: number; // 0.0–1.0
  rationale: string;
}

// ─── Coverage Analysis Output ───────────────────────────

export interface CoverageAnalysisOutput {
  summary: CoverageSummary;
  unmappedOutcomes: UnmappedOutcome[];
  weaklyMappedOutcomes: WeaklyMappedOutcome[];
  overrepresentedKCs: OverrepresentedKC[];
  lateIntroducedKCs: LateIntroducedKC[];
  coverageMatrix: CoverageCell[];
  timeline: TimelineEntry[];
  recommendations: CoverageRecommendation[];
  metadata: CoverageMetadata;
}

export interface CoverageSummary {
  totalOutcomes: number;
  mappedOutcomes: number;
  unmappedOutcomeCount: number;
  weaklyMappedOutcomeCount: number;
  totalApprovedKCs: number;
  kcsWithOutcomeLink: number;
  orphanKCs: number; // KCs not linked to any outcome
  overrepresentedKCCount: number;
  lateIntroducedKCCount: number;
  coveragePercent: number; // mapped/total * 100
}

export interface UnmappedOutcome {
  outcomeId: string;
  outcomeCode: string;
  description: string;
  reason: string;
}

export interface WeaklyMappedOutcome {
  outcomeId: string;
  outcomeCode: string;
  description: string;
  bestConfidence: number;
  linkedKCs: Array<{ kcId: string; kcName: string; confidence: number }>;
}

export interface OverrepresentedKC {
  kcId: string;
  kcName: string;
  outcomeCount: number;
  pageCount: number;
  linkedOutcomeIds: string[];
}

export interface LateIntroducedKC {
  kcId: string;
  kcName: string;
  firstPageGlobalOrder: number;
  firstPageTitle: string;
  linkedOutcomeIds: string[];
  expectedEarlierBecause: string;
}

export interface CoverageCell {
  outcomeId: string;
  outcomeCode: string;
  kcId: string;
  kcName: string;
  confidence: number;
  strength: string | null; // from KcContentMapping if exists
}

export interface TimelineEntry {
  pageId: string;
  pageTitle: string;
  globalOrder: number;
  moduleTitle: string;
  kcIds: string[];
  outcomeIds: string[]; // outcomes addressed on this page (via KC mappings)
  newOutcomesCovered: string[]; // first time these outcomes appear
}

export interface CoverageRecommendation {
  type: 'ADD_CONTENT' | 'STRENGTHEN_MAPPING' | 'REORDER_CONTENT' | 'REVIEW_OVERLAP' | 'ADD_KC';
  target: string;
  targetId?: string;
  rationale: string;
  priority: 'high' | 'medium' | 'low';
}

export interface CoverageMetadata {
  courseId: string;
  analyzedAt: string;
  totalPages: number;
  syllabusLength: number;
}
