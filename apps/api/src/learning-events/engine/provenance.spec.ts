/**
 * Library v2.1 (the approved rule changes) against v2, and the provenance
 * every detection carries (Prompt B, P4).
 */
import { LIBRARIES, defaultParams, ruleParameters } from './params';
import { prepareActions } from './prepare';
import { NO_PATTERN, UNRESOLVED, detectionKey, enrich, residuals, stableJson } from './provenance';
import { RULES, rulesFor, runRules } from './rules';
import type { EngineInput, LibraryVersion, RawAction } from './types';

const T0 = Date.UTC(2026, 10, 26, 9, 0, 0);
const ITEM = 'item-1';
let n = 0;
function act(
  action: string,
  atSec: number,
  meta: Record<string, unknown> = {},
  extra: Partial<RawAction> = {},
): RawAction {
  n++;
  return {
    id: `a${n}`,
    action,
    at: T0 + atSec * 1000,
    courseId: 'c1',
    moduleItemId: ITEM,
    interventionId: null,
    meta: { libraryVersion: 'v2', seq: n, ...meta },
    ...extra,
  };
}
function input(
  actions: RawAction[],
  library: LibraryVersion,
  over: Partial<EngineInput> = {},
): EngineInput {
  return {
    actions: prepareActions(actions).actions,
    visibility: [],
    prior: { visits: new Map(), commits: new Set() },
    params: defaultParams(library),
    library,
    ...over,
  };
}
const outcomes = (i: EngineInput, rule: string) =>
  runRules(i)
    .filter((d) => d.ruleId === rule)
    .map((d) => d.outcome);
const S = { slideKey: 's1-21' };

describe('library v2.1 vs v2', () => {
  it('has M34L and T_break; v2 is unchanged', () => {
    expect(LIBRARIES['v2.1'].rules.map((r) => r.id)).toContain('M34L');
    expect(defaultParams('v2.1').T_break).toBe(300_000);
    expect(rulesFor({ library: 'v2' } as EngineInput)).toBe(RULES);
    expect(rulesFor({ library: 'v2.1' } as EngineInput).map((r) => r.id)).toContain('M34L');
  });

  it('M34 counts system suggestions only; M34L reports learner-launched strategies', () => {
    const rows = () => [
      act(
        'INTERVENTION_TRIGGERED',
        10,
        { triggerReason: 'rule_triggered', shown: true },
        { interventionId: 'n1' },
      ),
      act(
        'INTERVENTION_TRIGGERED',
        20,
        { triggerReason: 'chip_clicked' },
        { interventionId: 's1' },
      ),
      act('INTERVENTION_COMPLETED', 60, {}, { interventionId: 's1' }),
      act('INTERVENTION_TRIGGERED', 90, { initiator: 'learner' }, { interventionId: 's2' }),
    ];
    const v2 = input(rows(), 'v2');
    expect(outcomes(v2, 'M34')).toEqual(['not_taken_up', 'completed', 'not_taken_up']);
    expect(outcomes(v2, 'M34L')).toEqual([]);
    const v21 = input(rows(), 'v2.1');
    expect(outcomes(v21, 'M34')).toEqual(['not_taken_up']);
    expect(outcomes(v21, 'M34L')).toEqual(['completed', 'not_taken_up']);
  });

  it('M30 needs a prior view of the AI output in v2.1', () => {
    const rows = () => [act('OUTPUT_VERIFIED', 10, { runId: 'r1', verdict: 'supported' })];
    expect(outcomes(input(rows(), 'v2'), 'M30')).toEqual(['supported']);
    expect(outcomes(input(rows(), 'v2.1'), 'M30')).toEqual([]);
    const viewed = [
      act('AI_OUTPUT_VIEWED', 5, { runId: 'r1' }),
      act('OUTPUT_VERIFIED', 10, { runId: 'r1', verdict: 'supported' }),
    ];
    expect(outcomes(input(viewed, 'v2.1'), 'M30')).toEqual(['supported']);
  });

  it('M31/M32 look at every edit after the paste in v2.1, not only the first', () => {
    const rows = () => [
      act('OUTPUT_PASTED', 0, { ...S, targetField: 'results', matchesAiOutput: true, runId: 'r1' }),
      act('OUTPUT_EDITED', 30, { ...S, targetField: 'results', editRatio: 0.05, runId: 'r1' }),
      act('OUTPUT_EDITED', 90, { ...S, targetField: 'results', editRatio: 0.5, runId: 'r1' }),
    ];
    expect(outcomes(input(rows(), 'v2'), 'M31')).toEqual(['passive_reliance_candidate']);
    expect(outcomes(input(rows(), 'v2'), 'M32')).toEqual([]);
    expect(outcomes(input(rows(), 'v2.1'), 'M32')).toEqual(['active_use']);
    expect(outcomes(input(rows(), 'v2.1'), 'M31')).toEqual([]);
  });

  it('M20/M25 give one label per off-task interval in v2.1 (T_break)', () => {
    const rows = () => [
      act('IDLE_STARTED', 0),
      act('IDLE_ENDED', 180, { idleMs: 180_000 }), // 3 min: idle
      act('IDLE_STARTED', 400),
      act('IDLE_ENDED', 1_000, { idleMs: 600_000 }), // 10 min: a break
      act('SLIDE_ENTERED', 1_010, { slideKey: 's1-2', slideType: 'theory' }),
    ];
    const v2 = input(rows(), 'v2');
    expect(outcomes(v2, 'M25')).toEqual(['idle', 'idle']);
    expect(outcomes(v2, 'M20')).toEqual(['interruption_resumed', 'interruption_resumed']);
    const v21 = input(rows(), 'v2.1');
    expect(outcomes(v21, 'M25')).toEqual(['idle']);
    expect(outcomes(v21, 'M20')).toEqual(['interruption_resumed']);
  });

  it('M05 keeps a low-effort prediction that M24 cannot flag (no reveal) in v2.1', () => {
    const rows = () => [
      act('PREDICTION_COMMITTED', 0, {
        slideKey: 's1-8',
        kind: 'think',
        chars: 22,
        msOnSlide: 5_000,
      }),
    ];
    expect(outcomes(input(rows(), 'v2'), 'M05')).toEqual([]);
    expect(outcomes(input(rows(), 'v2'), 'M24')).toEqual([]);
    expect(outcomes(input(rows(), 'v2.1'), 'M05')).toEqual(['think_low_effort']);
  });

  it('visibility intervals carry their visibility_logs ids as source refs', () => {
    const i = input([act('SLIDE_ENTERED', 0, { slideKey: 's1-2' })], 'v2.1', {
      visibility: [
        { id: 'v1', at: T0 + 10_000, state: 'hidden' },
        { id: 'v2', at: T0 + 200_000, state: 'visible' },
      ],
    });
    const m25 = runRules(i).find((d) => d.ruleId === 'M25');
    expect(m25?.sourceRefs).toEqual(['visibility_logs:v1', 'visibility_logs:v2']);
  });
});

describe('provenance', () => {
  // One session that makes many rules fire.
  const session = () => [
    act('SLIDE_ENTERED', 0, { slideKey: 's1-1', slideType: 'objectives' }),
    act('SLIDE_EXITED', 20, { slideKey: 's1-1', slideType: 'objectives', dwellMs: 20_000 }),
    act('PREDICTION_COMMITTED', 30, {
      slideKey: 's1-8',
      kind: 'predict',
      chars: 140,
      msOnSlide: 60_000,
    }),
    act('CONFIDENCE_RATED', 40, { slideKey: 's1-9', item: 'q1', value: 70, timing: 'before' }),
    act('OUTPUT_PASTED', 50, { ...S, targetField: 'results', matchesAiOutput: true, runId: 'r1' }),
    act('OUTPUT_EDITED', 60, { ...S, targetField: 'results', editRatio: 0.6, runId: 'r1' }),
    act('INTERVENTION_TRIGGERED', 70, { initiator: 'learner' }, { interventionId: 's1' }),
    act('IDLE_STARTED', 100),
    act('IDLE_ENDED', 300, { idleMs: 200_000 }),
  ];

  it('every detection records the thresholds its rule uses and its measured values', () => {
    const i = input(session(), 'v2.1');
    const drafts = runRules(i);
    expect(new Set(drafts.map((d) => d.ruleId)).size).toBeGreaterThanOrEqual(5);
    const params = ruleParameters('v2.1');
    for (const e of enrich(drafts, i, 'v2.1')) {
      expect(Object.keys(e.computedValues.thresholds).sort()).toEqual(
        [...(params.get(e.ruleId) ?? [])].sort(),
      );
      expect(e.computedValues.measured).toEqual(
        expect.objectContaining({ spanMs: e.end - e.start, ...(e.detail ?? {}) }),
      );
      expect(e.evidenceClass).not.toBeUndefined();
    }
  });

  it('every library rule maps to known parameters', () => {
    for (const v of ['v2', 'v2.1'] as const) {
      const p = ruleParameters(v);
      for (const r of rulesFor({ library: v } as EngineInput)) expect(p.has(r.id)).toBe(true);
    }
  });

  it('alternatives list the other rules on the same evidence', () => {
    const shared = act('PREDICTION_COMMITTED', 0, { slideKey: 's', kind: 'predict', chars: 1 });
    const drafts = [
      { ruleId: 'A', start: 0, end: 0, sources: [shared] },
      { ruleId: 'B', start: 0, end: 0, sources: [shared] },
    ];
    const e = enrich(drafts, input([], 'v2.1'), 'v2.1');
    expect(e.map((x) => x.alternatives)).toEqual([['B'], ['A']]);
  });

  it('residuals: unexplained active time is NO_PATTERN, an unexplained trigger is UNRESOLVED', () => {
    const rows = [
      act('SLIDE_ENTERED', 0, { slideKey: 's1-3', slideType: 'mcq' }),
      act('SLIDE_ENTERED', 40, { slideKey: 's1-4', slideType: 'mcq' }),
      act('SLIDE_ENTERED', 80, { slideKey: 's1-5', slideType: 'mcq' }),
      act('OUTPUT_VERIFIED', 100, { runId: 'r9', verdict: 'supported' }), // no view: v2.1 M30 skips
    ];
    const i = input(rows, 'v2.1');
    const { residual, coverage } = residuals(runRules(i), i);
    expect(residual.filter((r) => r.ruleId === NO_PATTERN)).toHaveLength(1);
    expect(residual.find((r) => r.ruleId === UNRESOLVED)).toMatchObject({
      outcome: 'OUTPUT_VERIFIED',
      computedValues: { measured: expect.objectContaining({ rules: ['M30'] }) },
    });
    expect(coverage).toMatchObject({ actions: 4, explainedActions: 0, activeMs: 100_000 });
    expect(coverage.notApplicable).toEqual(expect.arrayContaining(['M09', 'M10']));
  });

  it('the detection key is stable and changes with the parameters', () => {
    const base = {
      sessionId: 's',
      ruleId: 'M01',
      outcome: 'x',
      parameterHash: 'p1',
      libraryHash: 'l1',
      start: 1000,
      sourceIds: ['b', 'a'],
    };
    expect(detectionKey(base)).toBe(detectionKey({ ...base, sourceIds: ['a', 'b'] }));
    expect(detectionKey(base)).not.toBe(detectionKey({ ...base, parameterHash: 'p2' }));
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});
