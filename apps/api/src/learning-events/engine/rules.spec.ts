import { defaultParams, resolveParams } from './params';
import { prepareActions } from './prepare';
import { RULES, runRules } from './rules';
import type { EngineInput, RawAction } from './types';

const ITEM = 'item-1';
let n = 0;
const T0 = Date.UTC(2026, 9, 7, 9, 0, 0);

/** Fixture builder: `at` in seconds from T0. */
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
    courseId: 'course-1',
    moduleItemId: ITEM,
    interventionId: null,
    meta: { libraryVersion: 'v2', seq: n, ...meta },
    ...extra,
  };
}

function input(actions: RawAction[], over: Partial<EngineInput> = {}): EngineInput {
  return {
    actions: prepareActions(actions).actions,
    visibility: [],
    prior: { visits: new Map(), commits: new Set() },
    params: defaultParams(),
    ...over,
  };
}

const byRule = (i: EngineInput, id: string) => runRules(i).filter((d) => d.ruleId === id);

describe('library parameters', () => {
  it('come from the workbook (library.v2.json) in ms', () => {
    const p = defaultParams();
    expect(p).toMatchObject({
      T_read: 10_000,
      T_orient: 15_000,
      T_idle: 120_000,
      T_rapid: 15_000,
      eps_chars: 10,
      W_seq: 600_000,
      E_edit: 0.15,
    });
    expect(p.T_out).toEqual({ minSeconds: 5, wordsPerSecond: 4 });
  });

  it('a stored set overrides only the keys it names', () => {
    const p = resolveParams({ T_rapid: 30_000, bogus: 1, T_read: -5 });
    expect(p.T_rapid).toBe(30_000);
    expect(p.T_read).toBe(10_000);
  });

  it('registers all 36 workbook rules', () => {
    expect(RULES.map((r) => r.id)).toHaveLength(36);
    expect(RULES.find((r) => r.id === 'M10')?.notApplicable).toMatch(/M15/);
  });
});

describe('prepareActions', () => {
  it('drops double-posted copies (same action, time and metadata incl. seq)', () => {
    const a = act('SLIDE_ENTERED', 1, { slideKey: 's1-1' });
    const copy = { ...a, id: 'other-row-id' };
    const { actions, duplicates } = prepareActions([
      a,
      copy,
      act('SLIDE_EXITED', 2, { slideKey: 's1-1' }),
    ]);
    expect(duplicates).toBe(1);
    expect(actions.map((x) => x.id)).toEqual([a.id, expect.any(String)]);
  });

  it('orders same-millisecond events by seq', () => {
    const enter = act('SLIDE_ENTERED', 5, { slideKey: 's1-2', seq: 11 });
    const exit = act('SLIDE_EXITED', 5, { slideKey: 's1-1', seq: 10 });
    expect(prepareActions([enter, exit]).actions.map((x) => x.action)).toEqual([
      'SLIDE_EXITED',
      'SLIDE_ENTERED',
    ]);
  });
});

describe('reading and orientation', () => {
  it('M01: objectives read ≥ T_orient before the first attempt', () => {
    const i = input([
      act('SLIDE_ENTERED', 0, { slideKey: 's1-1', slideType: 'objectives' }),
      act('SLIDE_EXITED', 20, { slideKey: 's1-1', slideType: 'objectives', dwellMs: 20_000 }),
      act('ATTEMPT_STARTED', 40, { slideKey: 's1-3', fieldKey: 'think' }),
    ]);
    expect(byRule(i, 'M01')).toEqual([
      expect.objectContaining({ outcome: 'objectives_and_criteria' }),
    ]);
  });

  it('M01 does not fire for a skim below T_orient', () => {
    const i = input([
      act('SLIDE_EXITED', 5, { slideKey: 's1-1', slideType: 'objectives', dwellMs: 5_000 }),
    ]);
    expect(byRule(i, 'M01')).toHaveLength(0);
  });

  it('M03 first reading vs M03b re-reading (visits counted across sessions)', () => {
    const first = input([
      act('SLIDE_ENTERED', 0, { slideKey: 's1-5', slideType: 'theory' }),
      act('SLIDE_EXITED', 30, { slideKey: 's1-5', slideType: 'theory', dwellMs: 30_000 }),
    ]);
    expect(byRule(first, 'M03')).toHaveLength(1);
    const again = input(
      [
        act('SLIDE_ENTERED', 0, { slideKey: 's1-5', slideType: 'theory' }),
        act('SLIDE_EXITED', 30, { slideKey: 's1-5', slideType: 'theory', dwellMs: 30_000 }),
      ],
      { prior: { visits: new Map([[`${ITEM}|s1-5`, 1]]), commits: new Set() } },
    );
    expect(byRule(again, 'M03')).toHaveLength(0);
    expect(byRule(again, 'M03b')).toEqual([
      expect.objectContaining({
        outcome: 're_reading',
        detail: expect.objectContaining({ visitNo: 2 }),
      }),
    ]);
  });

  it('M21: a revisit followed by a revised answer is knowledge-based regulation, not M03b', () => {
    const i = input(
      [
        act('SLIDE_ENTERED', 0, { slideKey: 's1-7', slideType: 'theory' }),
        act('SLIDE_EXITED', 20, { slideKey: 's1-7', slideType: 'theory', dwellMs: 20_000 }),
        act('SELF_CHECK_SUBMITTED', 60, { slideKey: 's1-18', item: 1, chars: 40 }),
      ],
      { prior: { visits: new Map([[`${ITEM}|s1-7`, 1]]), commits: new Set([`${ITEM}|s1-18|1`]) } },
    );
    expect(byRule(i, 'M21')).toHaveLength(1);
    expect(byRule(i, 'M03b')).toHaveLength(0);
  });
});

describe('course-native evaluation rules', () => {
  it('M15: check answer → reveal → gap noted = self-identified gap', () => {
    const i = input([
      act('SELF_CHECK_SUBMITTED', 0, { slideKey: 's1-18', item: 1, chars: 60, msOnSlide: 40_000 }),
      act('REFERENCE_REVEALED', 5, {
        slideKey: 's1-18',
        item: 1,
        revealKind: 'check',
        auto: false,
      }),
      act('GAP_NOTED', 30, { slideKey: 's1-18', item: 1, chars: 35 }),
    ]);
    expect(byRule(i, 'M15')).toEqual([expect.objectContaining({ outcome: 'self_identified_gap' })]);
  });

  it('M15 pairs an automatic reveal with its commit even when stored in reverse order', () => {
    const commit = act('PREDICTION_COMMITTED', 10, {
      slideKey: 's2-7',
      kind: 'predict',
      chars: 52,
      msOnSlide: 20_000,
      seq: undefined,
    });
    const reveal = act('REFERENCE_REVEALED', 10, {
      slideKey: 's2-7',
      revealKind: 'predict',
      auto: true,
      seq: undefined,
    });
    reveal.id = 'a0000'; // sorts first on id
    const i = input([reveal, commit]);
    expect(byRule(i, 'M15')).toEqual([expect.objectContaining({ outcome: 'reference_exposure' })]);
  });

  it('M15: an empty "what I missed" leaves only reference exposure', () => {
    const i = input([
      act('SELF_CHECK_SUBMITTED', 0, { slideKey: 's1-18', item: 2, chars: 60, msOnSlide: 40_000 }),
      act('REFERENCE_REVEALED', 5, { slideKey: 's1-18', item: 2, revealKind: 'check' }),
      act('GAP_NOTED', 30, { slideKey: 's1-18', item: 2, chars: 0 }),
    ]);
    expect(byRule(i, 'M15')).toEqual([expect.objectContaining({ outcome: 'reference_exposure' })]);
  });

  it('M10 never fires on a gated reveal', () => {
    const i = input([
      act('MCQ_ANSWERED', 0, { slideKey: 's1-9', correct: false }),
      act('REFERENCE_REVEALED', 1, { slideKey: 's1-18', item: 1, revealKind: 'check' }),
      act('SLIDE_ENTERED', 2, { slideKey: 's1-19' }),
    ]);
    expect(byRule(i, 'M10')).toHaveLength(0);
  });

  it.each([
    ['agree', 'yes', 'regulation'],
    ['agree', 'no', 'persistent_misconception'],
    ['disagree', 'no', 'confirmation'],
    ['disagree', 'yes', 'reason_refined'],
  ])('M16: commit %s, changed %s → %s', (choice, changed, outcome) => {
    const i = input([
      act('BELIEF_COMMITTED', 0, { slideKey: 's1-16', item: 1, choice, chars: 12 }),
      act('REFERENCE_REVEALED', 0, {
        slideKey: 's1-16',
        item: 1,
        revealKind: 'misconception',
        auto: true,
      }),
      act('BELIEF_REVISED', 20, { slideKey: 's1-16', item: 1, changed }),
    ]);
    expect(byRule(i, 'M16')).toEqual([expect.objectContaining({ outcome })]);
  });

  it('M24 flags a fast near-minimum prediction and M05 then skips it', () => {
    const fast = input([
      act('PREDICTION_COMMITTED', 0, {
        slideKey: 's1-8',
        kind: 'predict',
        chars: 22,
        msOnSlide: 6_000,
      }),
      act('REFERENCE_REVEALED', 0, { slideKey: 's1-8', revealKind: 'predict', auto: true }),
    ]);
    expect(byRule(fast, 'M24')).toHaveLength(1);
    expect(byRule(fast, 'M05')).toHaveLength(0);
    const considered = input([
      act('PREDICTION_COMMITTED', 0, {
        slideKey: 's1-8',
        kind: 'predict',
        chars: 140,
        msOnSlide: 60_000,
      }),
    ]);
    expect(byRule(considered, 'M05')).toHaveLength(1);
  });

  it('M24 reacts to T_rapid: a stricter parameter set changes the result', () => {
    const rows = [
      act('PREDICTION_COMMITTED', 0, {
        slideKey: 's1-8',
        kind: 'predict',
        chars: 25,
        msOnSlide: 20_000,
      }),
      act('REFERENCE_REVEALED', 0, { slideKey: 's1-8', revealKind: 'predict', auto: true }),
    ];
    expect(byRule(input(rows), 'M24')).toHaveLength(0); // 20 s ≥ default 15 s
    expect(byRule(input(rows, { params: resolveParams({ T_rapid: 30_000 }) }), 'M24')).toHaveLength(
      1,
    );
  });

  it('M22 splits appraisal from forward planning', () => {
    const i = input([
      act('REFLECTION_SUBMITTED', 0, {
        slideKey: 's1-25',
        partChars: { appraisal: 80, implementationIntention: 60 },
      }),
    ]);
    expect(byRule(i, 'M22').map((d) => d.outcome)).toEqual(['self_appraisal', 'forward_planning']);
  });

  it('M23 computes calibration bias from confidence-before vs correctness', () => {
    const i = input([
      act('CONFIDENCE_RATED', 0, { slideKey: 's1-9', value: 5, timing: 'before' }),
      act('MCQ_ANSWERED', 5, { slideKey: 's1-9', correct: false }),
    ]);
    expect(byRule(i, 'M23')).toEqual([
      expect.objectContaining({
        outcome: 'overconfident',
        detail: expect.objectContaining({ bias: 1 }),
      }),
    ]);
  });
});

describe('off-task and interruption', () => {
  it('M25/M20 from idle events and visibility intervals', () => {
    const i = input([act('IDLE_STARTED', 200, {}), act('IDLE_ENDED', 400, { idleMs: 320_000 })], {
      visibility: [
        { at: T0 + 500_000, state: 'blurred' },
        { at: T0 + 530_000, state: 'visible' },
      ],
    });
    const m25 = byRule(i, 'M25');
    expect(m25).toEqual([
      expect.objectContaining({
        outcome: 'idle',
        detail: expect.objectContaining({ durationMs: 320_000 }),
      }),
    ]);
    expect(byRule(i, 'M20').map((d) => d.outcome)).toEqual(['interruption_resumed']);
  });
});

describe('Prompt Lab rules', () => {
  const S = { slideKey: 's1-21' };

  it('M26: settings and goal before the first prompt', () => {
    const i = input([
      act('RUN_SETTINGS_RECORDED', 0, S),
      act('PROMPT_GOAL_DECLARED', 1, { ...S, chars: 40 }),
      act('PROMPT_SUBMITTED', 10, { ...S, runId: 'r1' }),
    ]);
    expect(byRule(i, 'M26')).toHaveLength(1);
  });

  it('M27: read → judged → revised version', () => {
    const i = input([
      act('PROMPT_SUBMITTED', 0, { ...S, runId: 'r1' }),
      act('AI_OUTPUT_VIEWED', 40, { ...S, runId: 'r1', dwellMs: 40_000, responseWords: 100 }),
      act('TEST_RESULT_RECORDED', 50, { ...S, pass: false, versionId: 'v1', testCaseKey: 'c1' }),
      act('PROMPT_VERSION_SAVED', 120, { ...S, versionNo: 2, editRatioFromPrev: 0.4 }),
    ]);
    expect(byRule(i, 'M27')).toHaveLength(1);
  });

  it('M28: a quick rerun with no judgement is a candidate; a declared experiment is not', () => {
    const quick = input([
      act('PROMPT_SUBMITTED', 0, { ...S, runId: 'r1' }),
      act('AI_OUTPUT_VIEWED', 3, { ...S, runId: 'r1', dwellMs: 3_000, responseWords: 200 }),
      act('OUTPUT_REGENERATED', 3, { ...S, runId: 'r2', parentRunId: 'r1' }),
    ]);
    expect(byRule(quick, 'M28')).toHaveLength(1);
    const experiment = input([
      act('PROMPT_SUBMITTED', 0, { ...S, runId: 'r1', declaredExperiment: true }),
      act('AI_OUTPUT_VIEWED', 3, { ...S, runId: 'r1', dwellMs: 3_000, responseWords: 200 }),
      act('OUTPUT_REGENERATED', 3, { ...S, runId: 'r2', declaredExperiment: true }),
    ]);
    expect(byRule(experiment, 'M28')).toHaveLength(0);
  });

  it('M29: one version tested on ≥ 2 cases and judged', () => {
    const i = input([
      act('TEST_CASE_RUN', 0, { ...S, versionId: 'v1', testCaseKey: 'c1' }),
      act('TEST_CASE_RUN', 10, { ...S, versionId: 'v1', testCaseKey: 'c2' }),
      act('TEST_RESULT_RECORDED', 20, { ...S, versionId: 'v1', testCaseKey: 'c2', pass: false }),
    ]);
    expect(byRule(i, 'M29')).toEqual([
      expect.objectContaining({ detail: { versionId: 'v1', cases: 2 } }),
    ]);
  });

  it('M31 passive vs M32 active use of a pasted AI output (E_edit)', () => {
    const passive = input([
      act('OUTPUT_PASTED', 0, { ...S, targetField: 'results', matchesAiOutput: true, runId: 'r1' }),
      act('OUTPUT_EDITED', 30, { ...S, targetField: 'results', editRatio: 0.05, runId: 'r1' }),
    ]);
    expect(byRule(passive, 'M31')).toHaveLength(1);
    const active = input([
      act('OUTPUT_PASTED', 0, { ...S, targetField: 'results', matchesAiOutput: true, runId: 'r1' }),
      act('OUTPUT_EDITED', 30, { ...S, targetField: 'results', editRatio: 0.6, runId: 'r1' }),
    ]);
    expect(byRule(active, 'M32')).toHaveLength(1);
    expect(byRule(active, 'M31')).toHaveLength(0);
  });

  it('M31 does not fire for a non-AI paste', () => {
    const i = input([
      act('OUTPUT_PASTED', 0, { ...S, targetField: 'results', matchesAiOutput: false }),
    ]);
    expect(byRule(i, 'M31')).toHaveLength(0);
  });
});
