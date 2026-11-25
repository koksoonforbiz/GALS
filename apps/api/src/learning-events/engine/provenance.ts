/**
 * Provenance for learning events (Prompt B, P4 / B7). Pure, like the rules:
 * what each detection measured and compared, which other rules fired on the
 * same evidence, which active time no rule explains, and a stable key.
 *
 * Nothing here changes what a rule detects: residual outputs (NO_PATTERN,
 * UNRESOLVED) are extra rows next to the rule outputs.
 */
import { createHash } from 'crypto';
import { LIBRARIES, ruleParameters } from './params';
import { rulesFor } from './rules';
import type { Draft, EngineInput, LibraryVersion, Params, RawAction } from './types';

/** Residual rule ids (not library rules). */
export const NO_PATTERN = 'NO_PATTERN';
export const UNRESOLVED = 'UNRESOLVED';
/** Unexplained active time shorter than this is not reported as NO_PATTERN. */
export const NO_PATTERN_MIN_MS = 30_000;

/** Rules whose `inputs` are context, not a trigger: a missing detection is not "unresolved". */
const CONTEXT_INPUT_RULES = new Set(['M20', 'M25', 'M33']);
/** Context actions (navigation, idle): listed as rule inputs, but not triggers. */
const CONTEXT_ACTIONS = new Set(['SLIDE_ENTERED', 'SLIDE_EXITED', 'IDLE_STARTED', 'IDLE_ENDED']);
/** Bookkeeping actions: they take no active time and need no explanation. */
const BOOKKEEPING = new Set(['SESSION_START', 'SESSION_END', 'SESSION_HEARTBEAT', 'PAGE_LEFT']);

export interface Enriched extends Draft {
  computedValues: {
    measured: Record<string, unknown>;
    thresholds: Partial<Record<keyof Params, unknown>>;
  };
  alternatives: string[];
  evidenceClass: string | null;
}

export interface Coverage {
  activeMs: number;
  explainedMs: number;
  actions: number;
  explainedActions: number;
  noPatternSpans: number;
  unresolved: number;
  notApplicable: string[];
}

/** Measured values, the thresholds the rule used, rules that share evidence. */
export function enrich(drafts: Draft[], input: EngineInput, version: LibraryVersion): Enriched[] {
  const params = ruleParameters(version);
  const evidence = new Map(LIBRARIES[version].rules.map((r) => [r.id, r.evidenceClass ?? null]));
  const bySource = new Map<string, Set<string>>();
  for (const d of drafts) {
    for (const s of d.sources) {
      const set = bySource.get(s.id) ?? new Set<string>();
      set.add(d.ruleId);
      bySource.set(s.id, set);
    }
  }
  return drafts.map((d) => {
    const alt = new Set<string>();
    for (const s of d.sources) for (const r of bySource.get(s.id) ?? []) alt.add(r);
    alt.delete(d.ruleId);
    const thresholds: Partial<Record<keyof Params, unknown>> = {};
    for (const k of params.get(d.ruleId) ?? []) thresholds[k] = input.params[k];
    return {
      ...d,
      computedValues: {
        measured: {
          spanMs: d.end - d.start,
          sources: d.sources.length + (d.sourceRefs?.length ?? 0),
          ...(d.detail ?? {}),
        },
        thresholds,
      },
      alternatives: [...alt].sort(),
      evidenceClass: evidence.get(d.ruleId) ?? null,
    };
  });
}

/**
 * Residual outputs and the session's coverage. Active time: each action
 * counts until the next one, at most T_idle. An action is explained when it
 * is a source of some detection.
 *   NO_PATTERN  a run of unexplained actions with >= 30 s of active time
 *   UNRESOLVED  an action that triggers an applicable rule (its first
 *               non-navigation input), unexplained
 */
export function residuals(
  drafts: Draft[],
  input: EngineInput,
): { residual: Enriched[]; coverage: Coverage } {
  const explained = new Set(drafts.flatMap((d) => d.sources.map((s) => s.id)));
  const acts = input.actions.filter((a) => !BOOKKEEPING.has(a.action));
  const activeOf = (i: number) =>
    i + 1 < acts.length ? Math.min(acts[i + 1]!.at - acts[i]!.at, input.params.T_idle) : 0;

  const rules = rulesFor(input);
  const triggers = new Map<string, string[]>();
  for (const r of rules) {
    if (r.notApplicable || CONTEXT_INPUT_RULES.has(r.id)) continue;
    const trigger = r.inputs.find((a) => !CONTEXT_ACTIONS.has(a));
    if (!trigger) continue;
    triggers.set(trigger, [...(triggers.get(trigger) ?? []), r.id]);
  }

  const residual: Enriched[] = [];
  let activeMs = 0;
  let explainedMs = 0;
  let run: { actions: RawAction[]; ms: number } = { actions: [], ms: 0 };
  const closeRun = () => {
    if (run.actions.length && run.ms >= NO_PATTERN_MIN_MS) {
      const first = run.actions[0]!;
      const last = run.actions[run.actions.length - 1]!;
      residual.push(
        residualDraft(NO_PATTERN, 'no_pattern', first.at, last.at, run.actions.slice(0, 200), {
          activeMs: run.ms,
          actions: run.actions.length,
        }),
      );
    }
    run = { actions: [], ms: 0 };
  };
  acts.forEach((a, i) => {
    const ms = activeOf(i);
    activeMs += ms;
    if (explained.has(a.id)) {
      explainedMs += ms;
      closeRun();
      return;
    }
    run.actions.push(a);
    run.ms += ms;
    const rulesFor = triggers.get(a.action);
    if (rulesFor) {
      residual.push(residualDraft(UNRESOLVED, a.action, a.at, a.at, [a], { rules: rulesFor }));
    }
  });
  closeRun();

  return {
    residual,
    coverage: {
      activeMs,
      explainedMs,
      actions: acts.length,
      explainedActions: acts.filter((a) => explained.has(a.id)).length,
      noPatternSpans: residual.filter((r) => r.ruleId === NO_PATTERN).length,
      unresolved: residual.filter((r) => r.ruleId === UNRESOLVED).length,
      notApplicable: rules.filter((r) => r.notApplicable).map((r) => r.id),
    },
  };
}

function residualDraft(
  ruleId: string,
  outcome: string,
  start: number,
  end: number,
  sources: RawAction[],
  measured: Record<string, unknown>,
): Enriched {
  return {
    ruleId,
    outcome,
    start,
    end,
    sources,
    moduleItemId: sources[0]?.moduleItemId ?? null,
    slideKey: typeof sources[0]?.meta.slideKey === 'string' ? sources[0].meta.slideKey : null,
    computedValues: { measured: { spanMs: end - start, ...measured }, thresholds: {} },
    alternatives: [],
    evidenceClass: 'Residual',
  };
}

/**
 * Stable detection key (Prompt D attaches coder verdicts to it): the same
 * evidence under the same rule, library and parameters gives the same key
 * on every recompute.
 */
export function detectionKey(p: {
  sessionId: string;
  ruleId: string;
  outcome?: string | null;
  parameterHash: string;
  libraryHash: string;
  start: number;
  sourceIds: string[];
}): string {
  return createHash('sha256')
    .update(
      [
        p.sessionId,
        p.ruleId,
        p.outcome ?? '',
        p.parameterHash,
        p.libraryHash,
        String(Math.round(p.start)),
        [...p.sourceIds].sort().join(','),
      ].join('|'),
    )
    .digest('hex');
}

/** JSON with sorted keys, so the same parameters always hash the same. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}
