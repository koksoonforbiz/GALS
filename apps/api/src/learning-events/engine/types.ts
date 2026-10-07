/**
 * Learning-event engine types (prompting course, plan Phase 4). The engine
 * is pure: given one session's raw actions and a parameter set it returns
 * learning-event drafts. All I/O lives in LearningEventsService.
 */

export interface RawAction {
  id: string;
  action: string;
  /** Client wall-clock ms (ActivityLog.occurredAt). */
  at: number;
  courseId: string | null;
  moduleItemId: string | null;
  interventionId: string | null;
  meta: Record<string, unknown>;
}

/** visibility_logs rows (tab hidden / window blurred / visible). */
export interface VisibilitySignal {
  at: number;
  state: string;
}

export interface Params {
  T_read: number;
  T_orient: number;
  T_out: { minSeconds: number; wordsPerSecond: number };
  T_idle: number;
  T_rapid: number;
  eps_chars: number;
  W_seq: number;
  W_plan: number;
  W_mon: number;
  W_recover: number;
  N_fail: number;
  E_edit: number;
}

/** What the learner already did before this session (for visitNo / revisions). */
export interface PriorHistory {
  /** `${moduleItemId}|${slideKey}` → SLIDE_ENTERED count before this session */
  visits: Map<string, number>;
  /** commit keys (`${moduleItemId}|${slideKey}|${item}`) committed before this session */
  commits: Set<string>;
}

export interface Draft {
  ruleId: string;
  outcome?: string | null;
  start: number;
  end: number;
  sources: RawAction[];
  moduleItemId?: string | null;
  slideKey?: string | null;
  detail?: Record<string, unknown>;
}

export interface EngineInput {
  actions: RawAction[];
  visibility: VisibilitySignal[];
  prior: PriorHistory;
  params: Params;
}

export interface RuleDef {
  id: string;
  /** Raw actions whose presence means the rule *could* fire (coverage report). */
  inputs: string[];
  /** Why a rule can never fire on this course, if so. */
  notApplicable?: string;
  run(input: EngineInput): Draft[];
}

/** T_out for an AI reply of `words` words (workbook: max(5 s, words ÷ 4)). */
export function tOutMs(p: Params, words: number): number {
  return Math.max(p.T_out.minSeconds, words / p.T_out.wordsPerSecond) * 1000;
}
