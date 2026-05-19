// ─── Input Types ────────────────────────────────────────

export interface KcEvalScope {
  type: 'course' | 'pages';
  pageIds?: string[];
}

export type KcEvalDepth = 'quick' | 'deep';

export interface StartKcEvaluationInput {
  courseId: string;
  userId: string;
  scope: KcEvalScope;
  depth: KcEvalDepth;
}

// ─── Internal data shapes ───────────────────────────────

export interface PageInfo {
  id: string;
  title: string;
  moduleId: string;
  moduleTitle: string;
  orderIndex: number;
  moduleOrderIndex: number;
  contentMdx: string | null;
  learningOutcomes: string[] | null;
  blockCount: number;
  /** Global sequential position across the entire course */
  globalOrder: number;
}

export interface KcInfo {
  id: string;
  name: string;
  description: string | null;
  status: string;
  confidenceLevel: string;
}

export interface MappingInfo {
  id: string;
  kcId: string;
  kcName: string;
  pageId: string;
  strength: string; // LOW | MEDIUM | HIGH
  blockIds: string[];
}

export interface EdgeInfo {
  fromKcId: string;
  toKcId: string;
  relationship: string; // prerequisite | builds_on | related
  weight: number;
}

// ─── Output Types (machine-readable results) ────────────

export type KcStatus = 'well_supported' | 'weak' | 'missing';

export interface KcFinding {
  kcId: string;
  kcName: string;
  status: KcStatus;
  evidenceCount: number;
  highStrengthCount: number;
  mediumStrengthCount: number;
  lowStrengthCount: number;
  issues: KcIssue[];
}

export interface KcIssue {
  type: 'NO_CONTENT' | 'WEAK_SUPPORT' | 'NEVER_REINFORCED' | 'PREREQ_NOT_TAUGHT';
  description: string;
  severity: 'error' | 'warning' | 'info';
  relatedPageIds?: string[];
}

export type PageIssueType =
  | 'PREREQ_VIOLATION'
  | 'COGNITIVE_OVERLOAD'
  | 'OUTCOME_GAP'
  | 'OUTCOME_NO_KC'
  | 'KC_NO_OUTCOME';

export interface PageFinding {
  pageId: string;
  pageTitle: string;
  moduleName: string;
  issues: PageIssueDetail[];
}

export interface PageIssueDetail {
  type: PageIssueType;
  description: string;
  relatedKCs: Array<{ id: string; name: string }>;
  severity: 'error' | 'warning' | 'info';
}

export type RecommendationType =
  | 'ADD_REINFORCEMENT'
  | 'REORDER_CONTENT'
  | 'SPLIT_PAGE'
  | 'ADD_SCAFFOLDING'
  | 'MAP_OUTCOMES'
  | 'TEACH_PREREQUISITE';

export interface Recommendation {
  type: RecommendationType;
  target: string; // page/KC name
  targetId?: string;
  rationale: string;
  priority: 'high' | 'medium' | 'low';
}

export interface KcEvaluationSummary {
  totalKCs: number;
  wellSupportedKCs: number;
  weakKCs: number;
  missingKCs: number;
  prerequisiteViolations: number;
  overloadedPages: number;
  outcomeMismatches: number;
  totalRecommendations: number;
}

export interface KcEvaluationOutput {
  summary: KcEvaluationSummary;
  kcFindings: KcFinding[];
  pageFindings: PageFinding[];
  recommendations: Recommendation[];
  metadata: {
    courseId: string;
    depth: KcEvalDepth;
    evaluatedAt: string;
    pagesEvaluated: number;
    totalApprovedKCs: number;
  };
}
