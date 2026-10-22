import * as fs from 'fs';
import * as path from 'path';
import {
  autoScore,
  cohensKappa,
  maxMarksOf,
  scoreMcq,
  scoreSata,
  studentItems,
  writtenTotal,
  type KnowledgeTestItem,
} from '@ats/shared';
import { planAssignments, sessionOrder, STUDY_ORDERS, studyOrder } from './assignment';
import { bankDefinitions, itemsHash, type BankFile } from './bank';
import { REASON, testStatus, type StatusStep } from './status';

const BANK_FILE = path.resolve(__dirname, '../../../../docs/assessment/knowledge_tests_v2.json');
const bank = JSON.parse(fs.readFileSync(BANK_FILE, 'utf8')) as BankFile;

const sata: KnowledgeTestItem = {
  slot: 1,
  type: 'sata',
  stem: 's',
  options: ['A', 'B', 'C', 'D', 'E'].map((id) => ({
    id,
    text: id,
    correct: ['A', 'B', 'C'].includes(id),
  })),
};
const mcq: KnowledgeTestItem = {
  slot: 2,
  type: 'mcq',
  stem: 'm',
  options: ['A', 'B', 'C', 'D'].map((id) => ({ id, text: id, correct: id === 'C' })),
};

describe('scoring', () => {
  it('mcq: 1 for the key, 0 otherwise, blank = 0', () => {
    expect(scoreMcq(mcq, { option: 'C' })).toBe(1);
    expect(scoreMcq(mcq, { option: 'A' })).toBe(0);
    expect(scoreMcq(mcq, undefined)).toBe(0);
  });

  it.each([
    [['A', 'B', 'C'], 1], // 3/3
    [['A', 'B', 'C', 'D', 'E'], 1 / 3], // 3 + 2 (all five)
    [['A', 'B'], 2 / 3], // 2 + 0
    [['D', 'E'], 0], // 0 + 2 → floored at 0
    [[], 0], // blank
  ])('sata %j → %d', (options, expected) => {
    expect(scoreSata(sata, { options: options as string[] })).toBeCloseTo(expected as number, 6);
  });

  it('autoScore sums mcq + sata, leaves open to raters, counts omissions', () => {
    const open: KnowledgeTestItem = {
      slot: 3,
      type: 'open',
      stem: 'o',
      maxMarks: 2,
      rubric: 'D1 (1 mark) D2 (1 mark)',
    };
    const s = autoScore([sata, mcq, open], { '1': { options: ['A', 'B'] }, '3': { text: '   ' } });
    expect(s.perSlot).toEqual({ '1': 0.6667, '2': 0, '3': null });
    expect(s.autoTotal).toBeCloseTo(2 / 3, 3);
    expect(s.omittedSlots).toEqual([2, 3]);
  });

  it('written total: two agreeing raters, or the adjudicator', () => {
    expect(writtenTotal([{ role: 'RATER', total: 2 }])).toBeNull();
    expect(
      writtenTotal([
        { role: 'RATER', total: 2 },
        { role: 'RATER', total: 2 },
      ]),
    ).toBe(2);
    expect(
      writtenTotal([
        { role: 'RATER', total: 2 },
        { role: 'RATER', total: 1 },
      ]),
    ).toBeNull();
    expect(
      writtenTotal([
        { role: 'RATER', total: 2 },
        { role: 'RATER', total: 1 },
        { role: 'ADJUDICATOR', total: 1 },
      ]),
    ).toBe(1);
  });

  it('κ: perfect = 1, chance = 0; quadratic weights penalise near misses less', () => {
    expect(
      cohensKappa(
        [
          [0, 0],
          [1, 1],
        ],
        'none',
        [0, 1],
      ),
    ).toBe(1);
    expect(
      cohensKappa(
        [
          [0, 0],
          [0, 1],
          [1, 0],
          [1, 1],
        ],
        'none',
        [0, 1],
      ),
    ).toBe(0);
    const near: Array<[number, number]> = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 4],
      [0, 0],
    ];
    const far: Array<[number, number]> = [
      [0, 4],
      [1, 3],
      [2, 0],
      [3, 1],
      [4, 4],
      [0, 0],
    ];
    expect(cohensKappa(near, 'quadratic', [0, 1, 2, 3, 4])!).toBeGreaterThan(
      cohensKappa(far, 'quadratic', [0, 1, 2, 3, 4])!,
    );
  });
});

describe('student payload', () => {
  it('never contains correct flags, rubrics or objectives', () => {
    for (const d of bankDefinitions(bank)) {
      const json = JSON.stringify(studentItems(d.items));
      expect(json).not.toMatch(/"correct"|"rubric"|"objective"/);
      expect(studentItems(d.items)).toHaveLength(d.items.length);
    }
  });
});

describe('item bank', () => {
  it('has 16 session forms (9 marks) and 3 study forms (29 marks), stored verbatim', () => {
    const defs = bankDefinitions(bank);
    expect(defs.filter((d) => d.scope === 'session')).toHaveLength(16);
    expect(defs.filter((d) => d.scope === 'study').map((d) => d.form)).toEqual(['A', 'B', 'C']);
    for (const d of defs) expect(d.maxMarks).toBe(d.scope === 'session' ? 9 : 29);
    expect(defs[0]!.items).toBe(bank.sessionTests.s1!.forms.A); // same objects, nothing rewritten
    expect(maxMarksOf(bank.studyTests.A!)).toBe(29);
  });

  it('hashes items independently of object key order (jsonb reorders keys)', () => {
    const items = bank.sessionTests.s1!.forms.A!;
    const reordered = JSON.parse(
      JSON.stringify(items, (_k, v) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(Object.entries(v).reverse())
          : v,
      ),
    );
    expect(itemsHash(reordered)).toBe(itemsHash(items));
    expect(itemsHash(bank.sessionTests.s1!.forms.B!)).not.toBe(itemsHash(items));
  });

  it('refuses a bank that breaks its design', () => {
    const broken = JSON.parse(JSON.stringify(bank)) as BankFile;
    broken.sessionTests.s2!.forms.B![0]!.options!.forEach((o) => (o.correct = true));
    expect(() => bankDefinitions(broken)).toThrow(/s2\.B slot 1: mcq with 4 keyed/);
  });
});

describe('counterbalancing', () => {
  const course = '6e4bea96-ce66-403d-aed2-108ea1c11990';
  it('is deterministic and gives 18 assignments with distinct study forms', () => {
    const a = planAssignments('student-1', course, 0);
    expect(planAssignments('student-1', course, 0)).toEqual(a);
    expect(a).toHaveLength(18);
    const [pre, post] = a;
    expect(pre!.form).not.toBe(post!.form);
    expect(pre!.order).toBe(post!.order);
    expect(STUDY_ORDERS).toContain(pre!.order);
  });

  it('session forms alternate by enrolment order and across sessions; each session uses both forms', () => {
    expect(sessionOrder(0, 1)).not.toBe(sessionOrder(1, 1));
    expect(sessionOrder(0, 1)).not.toBe(sessionOrder(0, 2));
    const per = planAssignments('x', course, 3).filter((p) => p.sessionNo === 5);
    expect(per.map((p) => p.form).sort()).toEqual(['A', 'B']);
  });

  it('is balanced across students', () => {
    const ids = Array.from({ length: 600 }, (_, i) => `student-${i}`);
    const counts = new Map<string, number>();
    for (const id of ids)
      counts.set(studyOrder(id, course), (counts.get(studyOrder(id, course)) ?? 0) + 1);
    for (const o of STUDY_ORDERS) expect(counts.get(o)!).toBeGreaterThan(60); // ~100 each
    const ab = ids.filter((_, rank) => sessionOrder(rank, 1) === 'AB').length;
    expect(ab).toBe(300);
  });
});

describe('gate status', () => {
  const step = (
    occasion: string,
    kind = 'KNOWLEDGE_TEST',
    o: Partial<StatusStep> = {},
  ): StatusStep => ({
    gateId: occasion,
    kind,
    occasion,
    label: occasion,
    done: false,
    next: false,
    ...o,
  });
  const course = (doneUpTo: number) => {
    const order = [
      step('T0', 'EF_QUESTIONNAIRE', { label: 'About you and how you feel today' }),
      step('T0', 'EF_TESTS', { label: 'Attention and memory puzzles' }),
      step('PRE_STUDY'),
      step('S1_PRE'),
      step('S1_POST'),
      step('S2_PRE'),
      step('S2_POST'),
      step('POST_STUDY'),
      step('T2', 'EF_TESTS', { label: 'Attention and memory puzzles' }),
    ];
    return order.map((s, i) => ({ ...s, done: i < doneUpTo, next: i === doneUpTo }));
  };
  const none = new Map<string, 'in_progress' | 'submitted'>();
  const find = (st: ReturnType<typeof testStatus>, kind: string, n: number | null = null) =>
    st.find((t) => t.kind === kind && t.sessionNo === n)!;

  it('pre-study waits for the warm-up, and says so', () => {
    const st = testStatus(course(1), none, () => false);
    expect(find(st, 'PRE_STUDY')).toEqual(
      expect.objectContaining({
        state: 'locked',
        reasonCode: REASON.PREVIOUS_STEP,
        reason: 'Complete “Attention and memory puzzles” first.',
      }),
    );
  });

  it('pre-study opens once the warm-up is done; S1 pre waits for it', () => {
    const st = testStatus(course(2), none, () => false);
    expect(find(st, 'PRE_STUDY').state).toBe('available');
    expect(find(st, 'PRE_SESSION', 1).state).toBe('locked');
  });

  it('post-session needs the lesson finished as well as its turn', () => {
    expect(
      find(
        testStatus(course(4), none, () => false),
        'POST_SESSION',
        1,
      ),
    ).toEqual(expect.objectContaining({ state: 'locked', reasonCode: REASON.LESSON_NOT_FINISHED }));
    expect(
      find(
        testStatus(course(4), none, (n) => n === 1),
        'POST_SESSION',
        1,
      ).state,
    ).toBe('available');
  });

  it('S2 pre waits for S1 post; post-study waits for the last session', () => {
    const st = testStatus(course(4), none, () => true);
    expect(find(st, 'PRE_SESSION', 2).state).toBe('locked');
    expect(find(st, 'POST_STUDY').state).toBe('locked');
    expect(
      find(
        testStatus(course(7), none, () => true),
        'POST_STUDY',
      ).state,
    ).toBe('available');
  });

  it('in progress and submitted states', () => {
    const st = testStatus(course(2), new Map([['PRE_STUDY', 'in_progress']]), () => false);
    expect(find(st, 'PRE_STUDY').state).toBe('in_progress');
    expect(
      find(
        testStatus(course(3), none, () => false),
        'PRE_STUDY',
      ).state,
    ).toBe('submitted');
  });
});

describe('door classification', () => {
  // Every route of the two controllers must be listed in docs/two-door/api-classification.md.
  const doc = fs.readFileSync(
    path.resolve(__dirname, '../../../../docs/two-door/api-classification.md'),
    'utf8',
  );
  const routes = (file: string, prefix: string) => {
    const src = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
    return [...src.matchAll(/@(Get|Post|Patch|Put|Delete)\('([^']+)'\)/g)].map(
      ([, m, p]) => `${m!.toUpperCase()} \`/api/${prefix}/${p!.replace(':file', ':file.csv')}\``,
    );
  };
  it.each([
    ...routes('knowledge-tests.controller.ts', 'knowledge-tests'),
    ...routes('knowledge-tests-admin.controller.ts', 'knowledge-tests-admin'),
  ])('%s is classified', (route) => {
    const [method, p] = route.split(' ');
    const rows = doc.split('\n').filter((l) => l.startsWith('|'));
    const cells = rows.map((l) => l.split('|').map((c) => c.trim()));
    expect(cells.some((c) => c[1] === method && c[2] === p)).toBe(true);
  });
});
