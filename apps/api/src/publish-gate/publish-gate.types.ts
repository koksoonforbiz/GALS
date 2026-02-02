// ─── Gate Check Types ───────────────────────────────────

export type GateCheckId =
  | 'GRAPH_NO_CYCLES'
  | 'GRAPH_NO_ISOLATED_CORE_KCS'
  | 'PREREQ_COMPLETENESS'
  | 'KC_EVIDENCE_THRESHOLD'
  | 'EVAL_CRITICAL_RESOLVED';

export type GateCheckStatus = 'pass' | 'fail' | 'warn';

export interface GateCheckDetail {
  id: GateCheckId;
  label: string;
  description: string;
  status: GateCheckStatus;
  details: string[];
  /** IDs of entities causing the failure, for linking to fix */
  relatedIds?: string[];
}

export interface PublishGateOutput {
  overallPass: boolean;
  checks: GateCheckDetail[];
  meta: {
    courseId: string;
    checkedAt: string;
    approvedKcCount: number;
    edgeCount: number;
    mappingCount: number;
    pageCount: number;
    latestEvalRunId: string | null;
  };
}

// ─── Internal data shapes ───────────────────────────────

export interface GateKcInfo {
  id: string;
  name: string;
  status: string;
  confidenceLevel: string;
}

export interface GateEdgeInfo {
  id: string;
  fromKcId: string;
  toKcId: string;
  relationship: string;
  weight: number;
}

export interface GateMappingInfo {
  id: string;
  kcId: string;
  pageId: string;
  strength: string;
}

export interface GatePageInfo {
  id: string;
  title: string;
  globalOrder: number;
}

export interface GateEvalSummary {
  runId: string;
  missingKCs: number;
  prerequisiteViolations: number;
  overloadedPages: number;
  highPriorityRecs: number;
  errorIssues: Array<{ type: string; description: string }>;
}
