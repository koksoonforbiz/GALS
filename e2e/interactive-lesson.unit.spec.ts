/**
 * Unit tests for the interactive-lesson event layer (prompting course,
 * Phase 2). Runs under the Playwright test runner but needs no browser and
 * no running stack: it imports the pure modules directly.
 *
 *   pnpm exec playwright test e2e/interactive-lesson.unit.spec.ts
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  commitKey,
  mapLessonEvent,
  revealCommitKey,
  TEXT_CAP,
  type LessonEventContext,
  type LessonEventName,
} from '../apps/web/src/components/interactive-lesson/lessonEvents';
import { mcqOrder } from '../apps/web/src/components/interactive-lesson/mcqOrder';

const ctx = (over: Partial<LessonEventContext> = {}): LessonEventContext => ({
  slideKey: 's1-3',
  slideType: 'think',
  msOnSlide: 12_345.6,
  msSinceEnter: 20_000,
  msSinceCommit: null,
  captureText: false,
  ...over,
});

test.describe('mapLessonEvent — course event → ActivityAction', () => {
  test('every event carries slideKey, slideType and libraryVersion v2', () => {
    const names: LessonEventName[] = [
      'think_submitted',
      'predict_submitted',
      'reflect_submitted',
      'predict_revealed',
      'check_answered',
      'check_revealed',
      'check_missed_noted',
      'mcq_rationale',
      'mcq_answered',
      'misconception_committed',
      'misconception_opened',
      'misconception_changed',
      'results_submitted',
      'expect_revealed',
      'selfscore_set',
      'attempt_started',
      'confidence_rated',
    ];
    for (const n of names) {
      const m = mapLessonEvent(n, { text: 'x', question: 1, item: 1 }, ctx());
      expect(m, n).not.toBeNull();
      expect(m!.metadata).toMatchObject({
        slideKey: 's1-3',
        slideType: 'think',
        libraryVersion: 'v2',
      });
    }
  });

  test('a scripted Session-1 interaction yields the expected ordered actions', () => {
    const script: Array<[LessonEventName, Record<string, unknown>]> = [
      ['attempt_started', { fieldKey: 'think' }],
      ['think_submitted', { chars: 40, text: 'Tokens are sub-word pieces, so letters…' }],
      ['predict_submitted', { chars: 30, text: 'x' }],
      ['predict_revealed', { auto: true }],
      ['confidence_rated', { value: 4, timing: 'after' }],
      ['check_answered', { question: 1, chars: 25, text: 'x' }],
      ['check_revealed', { question: 1 }],
      ['check_missed_noted', { question: 1, chars: 0, text: '' }],
      ['mcq_rationale', { chars: 30, text: 'x' }],
      ['confidence_rated', { value: 3, timing: 'before' }],
      [
        'mcq_answered',
        {
          option: 2,
          correct: false,
          misconceptionId: 's1-16-m4',
          misconceptionTagStatus: 'proposed',
          confidence: 3,
        },
      ],
      ['misconception_committed', { item: 1, choice: 'agree', chars: 12, text: 'x' }],
      ['misconception_opened', { item: 1, auto: true }],
      ['misconception_changed', { item: 1, changed: 'yes' }],
      ['results_submitted', { chars: 60, text: 'x' }],
      ['expect_revealed', {}],
      ['selfscore_set', { criterion: 1, value: 2 }],
      [
        'reflect_submitted',
        {
          chars: 50,
          text: 'x',
          parts: { appraisal: 'a', implementationIntention: 'In my next real task…' },
        },
      ],
    ];
    const actions = script.map(([n, d]) => mapLessonEvent(n, d, ctx())!.action);
    expect(actions).toEqual([
      'ATTEMPT_STARTED',
      'PREDICTION_COMMITTED',
      'PREDICTION_COMMITTED',
      'REFERENCE_REVEALED',
      'CONFIDENCE_RATED',
      'SELF_CHECK_SUBMITTED',
      'REFERENCE_REVEALED',
      'GAP_NOTED',
      'RATIONALE_SUBMITTED',
      'CONFIDENCE_RATED',
      'MCQ_ANSWERED',
      'BELIEF_COMMITTED',
      'REFERENCE_REVEALED',
      'BELIEF_REVISED',
      'RESULTS_RECORDED',
      'REFERENCE_REVEALED',
      'CRITERION_SELF_SCORED',
      'REFLECTION_SUBMITTED',
    ]);
  });

  test('without text consent only character counts are logged', () => {
    const m = mapLessonEvent(
      'think_submitted',
      { chars: 31, text: 'My prediction is about tokens.' },
      ctx(),
    );
    expect(m!.metadata).toMatchObject({ kind: 'think', chars: 31, msOnSlide: 12346 });
    expect(m!.metadata).not.toHaveProperty('text');
    const r = mapLessonEvent(
      'reflect_submitted',
      { text: 'ab', parts: { appraisal: 'a', implementationIntention: 'b' } },
      ctx({ slideType: 'reflect' }),
    );
    expect(r!.metadata).toMatchObject({ partChars: { appraisal: 1, implementationIntention: 1 } });
    expect(r!.metadata).not.toHaveProperty('parts');
    expect(r!.metadata).not.toHaveProperty('text');
  });

  test('with text consent, text is attached and capped', () => {
    const long = 'x'.repeat(TEXT_CAP + 500);
    const m = mapLessonEvent('results_submitted', { text: long }, ctx({ captureText: true }));
    expect((m!.metadata.text as string).length).toBe(TEXT_CAP);
    expect(m!.metadata.chars).toBe(long.length);
  });

  test('an empty "what I missed" is logged explicitly as no gap stated', () => {
    const m = mapLessonEvent('check_missed_noted', { question: 2, chars: 0, text: '' }, ctx());
    expect(m!.metadata).toMatchObject({ item: 2, chars: 0, noGapStated: true });
  });

  test('reveals carry revealKind, auto flag and msSinceCommit', () => {
    const p = mapLessonEvent('predict_revealed', { auto: true }, ctx({ msSinceCommit: 3 }));
    expect(p!.metadata).toMatchObject({ revealKind: 'predict', auto: true, msSinceCommit: 3 });
    const c = mapLessonEvent('check_revealed', { question: 2 }, ctx({ msSinceCommit: 9000 }));
    expect(c!.metadata).toMatchObject({
      revealKind: 'check',
      item: 2,
      auto: false,
      msSinceCommit: 9000,
    });
  });

  test('reveals pair with the commit they follow', () => {
    expect(commitKey('check_answered', 's1-18', { question: 2 })).toBe(
      revealCommitKey('check_revealed', 's1-18', { question: 2 }),
    );
    expect(commitKey('misconception_committed', 's1-16', { item: 3 })).toBe(
      revealCommitKey('misconception_opened', 's1-16', { item: 3 }),
    );
    expect(commitKey('results_submitted', 's1-19', {})).toBe(
      revealCommitKey('expect_revealed', 's1-19', {}),
    );
    expect(commitKey('check_revealed', 's1-18', { question: 2 })).toBeNull();
  });

  test('ATTEMPT_STARTED uses wall-clock time since slide entry', () => {
    const m = mapLessonEvent('attempt_started', { fieldKey: 'q1' }, ctx({ msSinceEnter: 4321.4 }));
    expect(m!.metadata).toMatchObject({ fieldKey: 'q1', msFromSlideEnter: 4321 });
  });
});

test.describe('mcqOrder — parity with the course HTML', () => {
  // Evaluate the HTML's own shuffle code, extracted from the file, and
  // compare with the React port for every MCQ slide key.
  const html = fs.readFileSync(
    path.resolve(__dirname, '../docs/process-mining/course_slides.html'),
    'utf8',
  );
  const seedSrc = html.match(/let seed=0;for\(const ch of key\)[^;]*;/)![0];
  const orderSrc = html.match(/const order=s\.options\.map[^;]*;/)![0];
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const original = new Function('key', 's', `${seedSrc}${orderSrc}return order;`) as (
    key: string,
    s: { options: unknown[] },
  ) => number[];

  for (const key of ['s1-9', 's2-12', 's3-12', 's4-13', 's5-12', 's6-14', 's7-14', 's8-14']) {
    test(`same option order for ${key}`, () => {
      expect(mcqOrder(key, 3)).toEqual(original(key, { options: [0, 1, 2] }));
    });
  }
});

// ── Phase 3: Prompt Lab client helpers ─────────────────────────────────────
import {
  _resetOutputs,
  matchPaste,
  notePaste,
  rememberOutput,
  takePaste,
} from '../apps/web/src/components/interactive-lesson/prompt-lab/aiOutputs';
import { editRatio } from '../apps/web/src/components/interactive-lesson/prompt-lab/wordDiff';

test.describe('Prompt Lab — paste matching (client-side only)', () => {
  test.beforeEach(() => _resetOutputs());

  test('an exact excerpt of a recent output matches that run', () => {
    rememberOutput('run-1', 'The warranty covers parts and labour for two years from purchase.');
    expect(matchPaste('covers parts and labour for two years')).toEqual({
      runId: 'run-1',
      kind: 'exact',
    });
  });

  test('punctuation edits still match exactly; a one-word change is a near match', () => {
    rememberOutput(
      'run-2',
      'Answer in three bullet points, each under twelve words, citing the brief and naming the product line for every point.',
    );
    expect(
      matchPaste('Answer in three bullet points each under twelve words citing the brief!')?.kind,
    ).toBe('exact');
    expect(
      matchPaste(
        'Answer in three bullet points, each under twelve words, citing the brief and naming the product range for every point.',
      ),
    ).toEqual({ runId: 'run-2', kind: 'near' });
    expect(matchPaste('Completely different text about something else entirely.')).toBeNull();
  });

  test('very short pastes are ignored', () => {
    rememberOutput('run-3', 'yes');
    expect(matchPaste('yes')).toBeNull();
  });

  test('identical outputs: the most recently remembered (or copied) run wins', () => {
    const same = 'The warranty covers parts and labour for two years.';
    rememberOutput('old', same);
    rememberOutput('new', same);
    expect(matchPaste(same)?.runId).toBe('new');
    rememberOutput('old', same); // copied again from the older run
    expect(matchPaste(same)?.runId).toBe('old');
  });

  test('paste memory is consumed once per field', () => {
    notePaste('results', 'pasted', 'run-9');
    expect(takePaste('results')).toEqual({ text: 'pasted', runId: 'run-9' });
    expect(takePaste('results')).toBeNull();
  });

  test('editRatio mirrors the API word-level measure', () => {
    expect(editRatio('a b c d', 'a b c d')).toBe(0);
    expect(editRatio('a b c d', 'a x c d e')).toBe(0.75);
    expect(editRatio('', 'x')).toBe(1);
  });
});

test.describe('Prompt Lab — event mapping', () => {
  test('lab events map to the v2 AI-interaction actions without any text', () => {
    const c = ctx({ slideKey: 's1-21', slideType: 'task' });
    const cases: Array<[LessonEventName, Record<string, unknown>, string]> = [
      ['run_settings_recorded', { model: 'm', temperature: 0.7 }, 'RUN_SETTINGS_RECORDED'],
      ['prompt_goal_declared', { chars: 30, text: 'goal' }, 'PROMPT_GOAL_DECLARED'],
      ['prompt_submitted', { runId: 'r1', promptTokens: 400 }, 'PROMPT_SUBMITTED'],
      ['output_regenerated', { runId: 'r2', parentRunId: 'r1' }, 'OUTPUT_REGENERATED'],
      ['ai_output_viewed', { runId: 'r1', dwellMs: 9000, responseWords: 120 }, 'AI_OUTPUT_VIEWED'],
      [
        'prompt_version_saved',
        { versionId: 'v1', versionNo: 1, tokenCount: 380 },
        'PROMPT_VERSION_SAVED',
      ],
      [
        'prompt_revision_tagged',
        { versionId: 'v1', tags: ['compression'] },
        'PROMPT_REVISION_TAGGED',
      ],
      [
        'token_count_checked',
        { chars: 1600, tokens: 400, learnerGuess: 350 },
        'TOKEN_COUNT_CHECKED',
      ],
      ['test_case_run', { versionId: 'v1', testCaseKey: 'c1', runId: 'r3' }, 'TEST_CASE_RUN'],
      [
        'test_result_recorded',
        { versionId: 'v1', testCaseKey: 'c1', pass: false, failureReason: 'missing_fact' },
        'TEST_RESULT_RECORDED',
      ],
      ['output_rated', { runId: 'r1', criteria: { correct: 4 } }, 'OUTPUT_RATED'],
      ['output_verified', { runId: 'r1', verdict: 'supported', claimChars: 40 }, 'OUTPUT_VERIFIED'],
      ['output_copied', { runId: 'r1', chars: 200 }, 'OUTPUT_COPIED'],
      [
        'output_pasted',
        { targetField: 'results', chars: 200, matchesAiOutput: true, runId: 'r1' },
        'OUTPUT_PASTED',
      ],
      ['output_edited', { targetField: 'results', editRatio: 0.2, runId: 'r1' }, 'OUTPUT_EDITED'],
    ];
    for (const [name, data, action] of cases) {
      const m = mapLessonEvent(name, data, c);
      expect(m?.action, name).toBe(action);
      expect(m!.metadata, name).not.toHaveProperty('text');
      expect(m!.metadata).toMatchObject({ slideKey: 's1-21', libraryVersion: 'v2' });
    }
    expect(
      mapLessonEvent('output_regenerated', { runId: 'r', declaredExperiment: true }, c)!.metadata,
    ).toMatchObject({
      declaredExperiment: true,
    });
    expect(mapLessonEvent('run_settings_recorded', { model: 'm' }, c)!.metadata).toMatchObject({
      toolsEnabled: false,
    });
  });
});

test.describe('Replay CSV — lesson actions as named rows (Phase 7 #2)', () => {
  test('lesson and Prompt Lab actions fill their own rows, without free text', async () => {
    const { exportReplayCsv } =
      await import('../apps/web/src/pages/teacher/student-logs/lib/exportReplayCsv');
    const base = Date.UTC(2026, 9, 7, 9);
    const log = (action: string, sec: number, metadata: Record<string, unknown>) => ({
      id: `${action}-${sec}`,
      action,
      occurredAt: new Date(base + sec * 1000).toISOString(),
      metadata: { libraryVersion: 'v2', ...metadata },
    });
    const csv = exportReplayCsv(
      {
        session: { startedAt: new Date(base).toISOString() },
        snapshots: [],
        clickLogs: [],
        scrollLogs: [],
        gazeLogs: [],
        pupilLogs: [],
        emotionFrames: [],
        auResults: [],
        activityLogs: [
          log('PREDICTION_COMMITTED', 2, {
            slideKey: 's1-6',
            kind: 'predict',
            chars: 26,
            text: 'it sees tokens not letters',
          }),
          log('REFERENCE_REVEALED', 2, { slideKey: 's1-6', revealKind: 'predict' }),
          log('OUTPUT_PASTED', 4, { slideKey: 's1-18', chars: 107, matchesAiOutput: true }),
        ],
      },
      base,
      6_000,
    );
    const row = (name: string) => csv.split('\n').find((l) => l.startsWith(`${name},`)) ?? '';
    expect(row('prediction_committed')).toContain('s1-6');
    expect(row('prediction_committed')).toContain('chars=26');
    expect(row('reference_revealed')).toContain('reveal=predict');
    expect(row('output_pasted')).toContain('s1-18');
    expect(csv).not.toContain('it sees tokens not letters');
  });
});
