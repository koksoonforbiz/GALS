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
