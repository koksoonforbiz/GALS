/**
 * Phase 7 verification (docs/process-mining/PHASE7_VERIFICATION.md), the
 * API-checkable items, end to end through HTTP on the isolated test DB:
 *   #2  new lesson actions are stored as named rows (data side of Replay/CSV)
 *   #4  no clipboard text is stored for copy/paste events
 *   #5  learning_events for a scripted Session 1 run match a hand-written list
 *   #6  changing T_rapid changes the M24 rows
 *   #7  two ReplayAnnotations → validation report computes
 *   #8  process-mining CSV satisfies bupaR::eventlog() requirements
 *   #9  no nudge with policies disabled; enabled in a test course it fires
 *   #10 revoking text consent → later events carry chars only
 * Items 1, 3 and the click-through half of 2/4 are checked in the browser.
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { createTestApp, cleanDatabase } from '../test/setup';

const TEST_PASSWORD = 'Test-Passw0rd!';
process.env.RESEARCH_EXPORT_SALT ??= 'phase7-integration-test-salt';

type Meta = Record<string, unknown>;

/** Hand-written expected learning events for the scripted run below. */
const EXPECTED: Array<[string, string, string | null]> = [
  // [ruleId, outcome, slideKey]
  ['M01', 'objectives_and_criteria', 's1-1'],
  ['M03', 'first_reading', 's1-4'],
  ['M24', 'low_effort_candidate', 's1-6'],
  ['M15', 'reference_exposure', 's1-6'],
  ['M13', 'judgement_of_confidence', 's1-9'],
  ['M06', 'answer', 's1-9'],
  ['M07', 'incorrect', 's1-9'],
  ['M23', 'overconfident', 's1-9'],
  ['M04', 'self_explanation', 's1-9'],
  ['M03b', 're_reading', 's1-4'],
  ['M16', 'persistent_misconception', 's1-16'],
  ['M14', 'self_check', 's1-18'],
  ['M15', 'self_identified_gap', 's1-18'],
  ['M14', 'self_scored', 's1-24'],
  ['M14', 'rubric_after_attempt', 's1-24'],
  ['M25', 'idle', null],
  ['M20', 'interruption_resumed', null],
];

const key = (r: { ruleId: string; outcome: string | null; slideKey: string | null }) =>
  `${r.ruleId}|${r.outcome}|${r.slideKey ?? ''}`;

/** Parse a CSV this API wrote (csvCell quoting). */
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur || row.length) rows.push([...row, cur]);
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ''])));
}

/**
 * The checks bupaR::eventlog() makes on load (bupaR 0.5): mapped columns
 * exist and are non-missing, timestamps parse, lifecycle values are known,
 * and every activity instance belongs to exactly one case and activity.
 */
function bupaEventlogProblems(rows: Array<Record<string, string>>): string[] {
  const problems: string[] = [];
  const cols = ['case_id', 'activity', 'activity_instance', 'lifecycle', 'timestamp', 'resource'];
  for (const c of cols) if (rows.length && !(c in rows[0]!)) problems.push(`missing column ${c}`);
  const lifecycles = new Set([
    'schedule',
    'assign',
    'reassign',
    'start',
    'suspend',
    'resume',
    'abort_activity',
    'abort_case',
    'complete',
    'manualskip',
    'autoskip',
  ]);
  const instances = new Map<
    string,
    { case: string; activity: string; resource: string; life: Map<string, number> }
  >();
  rows.forEach((r, i) => {
    for (const c of cols) if (!r[c]) problems.push(`row ${i}: empty ${c}`);
    const t = Date.parse(r.timestamp!);
    if (!Number.isFinite(t)) problems.push(`row ${i}: bad timestamp ${r.timestamp}`);
    if (!lifecycles.has(r.lifecycle!)) problems.push(`row ${i}: unknown lifecycle ${r.lifecycle}`);
    const inst = instances.get(r.activity_instance!) ?? {
      case: r.case_id!,
      activity: r.activity!,
      resource: r.resource!,
      life: new Map(),
    };
    if (inst.case !== r.case_id || inst.activity !== r.activity)
      problems.push(`instance ${r.activity_instance} spans cases/activities`);
    inst.life.set(r.lifecycle!, t);
    instances.set(r.activity_instance!, inst);
  });
  for (const [id, inst] of instances) {
    const s = inst.life.get('start');
    const c = inst.life.get('complete');
    if (s == null || c == null) problems.push(`instance ${id} lacks start/complete`);
    else if (s > c) problems.push(`instance ${id} completes before it starts`);
  }
  return problems;
}

describe('Phase 7 verification — prompting course (API)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let teacherToken: string;
  let studentToken: string;
  let teacherId: string;
  let studentId: string;
  let courseId: string;
  let moduleId: string;
  let itemId: string;
  let sessionId: string;
  let T0: number;
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const asTeacher = (r: request.Test) => r.set('Authorization', `Bearer ${teacherToken}`);
  const asStudent = (r: request.Test) =>
    r.set('Authorization', `Bearer ${studentToken}`).set('x-session-id', sessionId);

  /** One lesson event as the web client sends it (lessonEvents.ts). */
  const ev = (
    action: string,
    atMs: number,
    slideKey: string,
    slideType: string,
    meta: Meta = {},
  ) => ({
    action,
    occurredAt: new Date(atMs).toISOString(),
    courseId,
    moduleId,
    moduleItemId: itemId,
    metadata: { libraryVersion: 'v2', seq: ++seq, slideKey, slideType, ...meta },
  });
  const at = (sec: number) => T0 + sec * 1000;

  const batch = (events: unknown[]) =>
    asStudent(http().post('/api/activity-log/batch')).send({ sessionId, events }).expect(201);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanDatabase(prisma);

    const t = await http().post('/api/auth/register').send({
      email: 'p7-teacher@test.com',
      password: TEST_PASSWORD,
      termsAccepted: true,
      name: 'Phase Seven Teacher',
      role: 'teacher',
    });
    teacherToken = t.body.accessToken;
    teacherId = t.body.user.id;
    const s = await http().post('/api/auth/register').send({
      email: 'p7-student@test.com',
      password: TEST_PASSWORD,
      termsAccepted: true,
      name: 'Phase Seven Student',
      role: 'student',
    });
    studentToken = s.body.accessToken;
    studentId = s.body.user.id;

    const course = await prisma.course.create({
      data: {
        title: 'Prompting course (Phase 7 test)',
        description: 'scripted verification',
        teacherId,
        status: 'PUBLISHED',
      },
    });
    courseId = course.id;
    const mod = await prisma.courseModule.create({
      data: { courseId, title: 'Session 1', orderIndex: 0 },
    });
    moduleId = mod.id;
    const item = await prisma.moduleItem.create({
      data: { moduleId, type: 'INTERACTIVE_LESSON', title: 'Session 1', orderIndex: 0 },
    });
    itemId = item.id;
    await prisma.enrollment.create({ data: { studentId, courseId, status: 'ACTIVE' } });

    const open = await http()
      .post('/api/activity-log/session/open')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(201);
    sessionId = open.body.sessionId;
    await asStudent(http().patch('/api/activity-log/session/course'))
      .send({ courseId })
      .expect(200);

    // Script the run five minutes in the past so the replay base (session
    // start) precedes it and every annotation offset is positive.
    T0 = Date.now() - 6 * 60_000;
    await prisma.studentSession.update({
      where: { id: sessionId },
      data: { startedAt: new Date(T0 - 1000) },
    });
  }, 60_000);

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  it('records consent (answer text + research use)', async () => {
    const res = await asStudent(http().put(`/api/text-consent/courses/${courseId}`))
      .send({ answerText: true, promptsAndOutputs: false, researchUse: true })
      .expect(200);
    expect(res.body.decision).toMatchObject({ answerText: true, researchUse: true });
  });

  it('#2/#5 a scripted Session 1 run parses into the hand-written learning events', async () => {
    const S = (k: number) => `s1-${k}`;
    await batch([
      ev('SLIDE_ENTERED', at(0), S(1), 'objectives', { visitNo: 1 }),
      ev('SLIDE_EXITED', at(20), S(1), 'objectives', { dwellMs: 20_000, exitReason: 'navigate' }),
      ev('SLIDE_ENTERED', at(20), S(4), 'theory', { visitNo: 1 }),
      ev('SLIDE_EXITED', at(40), S(4), 'theory', { dwellMs: 20_000, exitReason: 'navigate' }),
      ev('SLIDE_ENTERED', at(40), S(6), 'predict', { visitNo: 1 }),
      ev('ATTEMPT_STARTED', at(42), S(6), 'predict', { fieldKey: 'predict' }),
      ev('PREDICTION_COMMITTED', at(45), S(6), 'predict', {
        kind: 'predict',
        text: 'it sees tokens not letters',
        chars: 26,
        msOnSlide: 5_000,
      }),
      ev('REFERENCE_REVEALED', at(45), S(6), 'predict', {
        auto: true,
        revealKind: 'predict',
        msSinceCommit: 1,
      }),
      ev('SLIDE_EXITED', at(50), S(6), 'predict', { dwellMs: 10_000, exitReason: 'navigate' }),
      ev('SLIDE_ENTERED', at(50), S(9), 'mcq', { visitNo: 1 }),
      ev('CONFIDENCE_RATED', at(52), S(9), 'mcq', { value: 4, timing: 'before' }),
      ev('MCQ_ANSWERED', at(55), S(9), 'mcq', { option: 'B', correct: false }),
      ev('RATIONALE_SUBMITTED', at(60), S(9), 'mcq', {
        text: 'B, because longer words always cost more tokens',
        chars: 47,
      }),
      ev('SLIDE_EXITED', at(65), S(9), 'mcq', { dwellMs: 15_000, exitReason: 'navigate' }),
      ev('SLIDE_ENTERED', at(65), S(4), 'theory', { visitNo: 2 }),
      ev('SLIDE_EXITED', at(80), S(4), 'theory', { dwellMs: 15_000, exitReason: 'navigate' }),
      ev('SLIDE_ENTERED', at(80), S(16), 'misconception', { visitNo: 1 }),
      ev('BELIEF_COMMITTED', at(90), S(16), 'misconception', {
        item: 1,
        choice: 'agree',
        text: 'more context is always better',
        chars: 29,
        msOnSlide: 10_000,
      }),
      ev('REFERENCE_REVEALED', at(91), S(16), 'misconception', {
        item: 1,
        revealKind: 'misconception',
      }),
      ev('BELIEF_REVISED', at(100), S(16), 'misconception', { item: 1, changed: 'no' }),
      ev('SLIDE_EXITED', at(105), S(16), 'misconception', {
        dwellMs: 25_000,
        exitReason: 'navigate',
      }),
      ev('SLIDE_ENTERED', at(105), S(18), 'check', { visitNo: 1 }),
      ev('ATTEMPT_STARTED', at(106), S(18), 'check', { fieldKey: 'q1' }),
      ev('SELF_CHECK_SUBMITTED', at(120), S(18), 'check', {
        item: 1,
        text: 'Because the tokenizer merges letters into subword units.',
        chars: 56,
        msOnSlide: 15_000,
      }),
      ev('REFERENCE_REVEALED', at(120), S(18), 'check', { item: 1, revealKind: 'check' }),
      ev('GAP_NOTED', at(130), S(18), 'check', {
        item: 1,
        text: 'I forgot the cost of rare words.',
        chars: 32,
      }),
      ev('SLIDE_EXITED', at(135), S(18), 'check', { dwellMs: 30_000, exitReason: 'navigate' }),
      ev('SLIDE_ENTERED', at(135), S(24), 'selfscore', { visitNo: 1 }),
      ev('CRITERION_SELF_SCORED', at(140), S(24), 'selfscore', { criterion: 'c1', value: 2 }),
      ev('SLIDE_EXITED', at(160), S(24), 'selfscore', { dwellMs: 25_000, exitReason: 'navigate' }),
      ev('IDLE_STARTED', at(165), S(25), 'reflect', {}),
      ev('IDLE_ENDED', at(315), S(25), 'reflect', { idleMs: 150_000 }),
      ev('SLIDE_ENTERED', at(316), S(25), 'reflect', { visitNo: 1 }),
    ]);

    // #2: stored as named rows (what the Replay timeline and CSV read).
    const rows = await prisma.activityLog.findMany({
      where: { sessionId, moduleItemId: itemId },
      orderBy: { occurredAt: 'asc' },
    });
    const actions = new Set(rows.map((r) => r.action));
    for (const a of [
      'SLIDE_ENTERED',
      'SLIDE_EXITED',
      'PREDICTION_COMMITTED',
      'REFERENCE_REVEALED',
      'MCQ_ANSWERED',
      'BELIEF_COMMITTED',
      'BELIEF_REVISED',
      'SELF_CHECK_SUBMITTED',
      'GAP_NOTED',
      'CRITERION_SELF_SCORED',
      'CONFIDENCE_RATED',
    ])
      expect(actions).toContain(a);
    // consent (a) given → text kept
    const commit = rows.find((r) => r.action === 'PREDICTION_COMMITTED')!;
    expect(commit.metadata).toMatchObject({ text: 'it sees tokens not letters', chars: 26 });

    // Closing the session runs the parser (session.closed).
    await asStudent(http().post('/api/activity-log/session/close')).expect(201);
    let events: Array<{ ruleId: string; outcome: string | null; slideKey: string | null }> = [];
    for (let i = 0; i < 50 && events.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
      events = await prisma.learningEvent.findMany({ where: { sessionId } });
    }
    expect(events.map(key).sort()).toEqual(
      EXPECTED.map(([ruleId, outcome, slideKey]) => key({ ruleId, outcome, slideKey })).sort(),
    );

    // Spot-check timing: M01 covers the 20 s on the objectives slide,
    // M25 the 150 s idle interval.
    const all = await prisma.learningEvent.findMany({ where: { sessionId } });
    const m01 = all.find((e) => e.ruleId === 'M01')!;
    expect([m01.startAt.getTime(), m01.endAt.getTime()]).toEqual([at(0), at(20)]);
    const m25 = all.find((e) => e.ruleId === 'M25')!;
    expect([m25.startAt.getTime(), m25.endAt.getTime()]).toEqual([at(165), at(315)]);
    expect(all.every((e) => e.confidence === 'candidate')).toBe(true);
  });

  it('#6 changing T_rapid changes the M24 rows', async () => {
    await asTeacher(http().get(`/api/learning-events/sessions/${sessionId}`)).expect(200);
    const baseVersion = (await prisma.learningEvent.findFirstOrThrow({ where: { sessionId } }))
      .parameterSetVersion;

    const set = await asTeacher(http().post('/api/learning-events/parameter-sets'))
      .send({ values: { T_rapid: 3_000 }, note: 'Phase 7 #6: T_rapid 15 s → 3 s' })
      .expect(201);
    const res = await asTeacher(
      http().post(
        `/api/learning-events/sessions/${sessionId}/recompute?parameterSetVersion=${set.body.version}`,
      ),
    ).expect(201);
    expect(res.body.byRule.M24 ?? 0).toBe(0);
    // the 5 s prediction is no longer "rapid", so it counts as a prediction (M05)
    expect(res.body.byRule.M05).toBe(1);

    // back to the original parameters: M24 returns
    const back = await asTeacher(
      http().post(
        `/api/learning-events/sessions/${sessionId}/recompute?parameterSetVersion=${baseVersion}`,
      ),
    ).expect(201);
    expect(back.body.byRule.M24).toBe(1);
    expect(back.body.byRule.M05 ?? 0).toBe(0);

    // leave the current set equivalent to the workbook defaults
    await asTeacher(http().post('/api/learning-events/parameter-sets'))
      .send({ values: { T_rapid: 15_000 }, note: 'Phase 7 #6: restore T_rapid' })
      .expect(201);
  });

  it('#7 two annotations → validation report computes match rate, sensitivity, specificity', async () => {
    await asTeacher(http().post('/api/learning-events/validation/codes/seed')).expect(201);
    const codes = await prisma.replayCode.findMany({ where: { researcherId: teacherId } });
    const code = (label: string) => codes.find((c) => c.label === label)!.id;
    const base = T0 - 1000; // session start = replay t0
    await asTeacher(http().post('/api/replay-annotations'))
      .send({ sessionId, codeId: code('Orientation'), startMs: at(0) - base, endMs: at(20) - base })
      .expect(201);
    await asTeacher(http().post('/api/replay-annotations'))
      .send({
        sessionId,
        codeId: code('First reading'),
        startMs: at(20) - base,
        endMs: at(40) - base,
      })
      .expect(201);

    const r = await asTeacher(
      http().get(`/api/learning-events/courses/${courseId}/validation`),
    ).expect(200);
    expect(r.body.sessions).toBe(1);
    const row = (id: string) => r.body.rows.find((x: { mappingId: string }) => x.mappingId === id);
    for (const id of ['M01', 'M03']) {
      expect(row(id).tp).toBeGreaterThanOrEqual(1);
      expect(row(id).sensitivity).toBe(1);
      expect(typeof row(id).matchRate).toBe('number');
      expect(typeof row(id).specificity).toBe('number');
    }
    expect(r.body.pooled.total).toBeGreaterThan(0);
  });

  it('#8 the process-mining CSV loads as a bupaR event log', async () => {
    const res = await asTeacher(
      http().get(`/api/learning-events/courses/${courseId}/export/event-log.csv?format=eventlog`),
    ).expect(200);
    const rows = parseCsv(res.text);
    expect(rows).toHaveLength(EXPECTED.length * 2);
    expect(bupaEventlogProblems(rows)).toEqual([]);
    // pseudonymised: no raw ids or names
    expect(res.text).not.toContain(studentId);
    expect(res.text).not.toContain('Phase Seven');

    const activity = await asTeacher(
      http().get(`/api/learning-events/courses/${courseId}/export/event-log.csv`),
    ).expect(200);
    expect(parseCsv(activity.text)).toHaveLength(EXPECTED.length);
  });

  it('#9 no nudge while policies are disabled; an enabled test policy fires', async () => {
    // a fresh session so the nudge check sees only the new quick commit
    const open = await http()
      .post('/api/activity-log/session/open')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(201);
    sessionId = open.body.sessionId;
    const now = Date.now();
    await batch([
      ev('SLIDE_ENTERED', now - 3_000, 's1-3', 'predict', { visitNo: 1 }),
      ev('PREDICTION_COMMITTED', now - 1_000, 's1-3', 'predict', {
        kind: 'predict',
        text: 'it picks likely words!',
        chars: 22,
        msOnSlide: 2_000,
      }),
      ev('REFERENCE_REVEALED', now - 1_000, 's1-3', 'predict', {
        auto: true,
        revealKind: 'predict',
      }),
    ]);
    const evaluate = () =>
      asStudent(http().post('/api/nudges/evaluate'))
        .send({ moduleItemId: itemId, sessionId })
        .expect(201);

    const policies = await asTeacher(http().get(`/api/nudges/policies/courses/${courseId}`)).expect(
      200,
    );
    expect(policies.body.every((p: { enabled: boolean }) => !p.enabled)).toBe(true);
    expect((await evaluate()).body.nudge).toBeNull();

    // not validated → refused unless explicitly overridden (test course only)
    await asTeacher(http().patch(`/api/nudges/policies/courses/${courseId}/M24`))
      .send({ enabled: true })
      .expect(400);
    await asTeacher(http().patch(`/api/nudges/policies/courses/${courseId}/M24`))
      .send({ enabled: true, requiresValidated: false })
      .expect(200);

    const shown = (await evaluate()).body.nudge;
    expect(shown).toMatchObject({ ruleId: 'M24', slideKey: 's1-3' });
    expect(shown.rationale).toBeTruthy();
    const trig = await prisma.activityLog.findFirst({
      where: { sessionId, action: 'INTERVENTION_TRIGGERED', interventionId: shown.id },
    });
    expect(trig?.metadata).toMatchObject({
      triggerReason: 'rule_triggered',
      ruleId: 'M24',
      shown: true,
    });
    // capped: the same trigger does not nudge twice
    expect((await evaluate()).body.nudge).toBeNull();
    await asStudent(http().post(`/api/nudges/${shown.id}/respond`))
      .send({ status: 'dismissed' })
      .expect(201);
    expect((await prisma.ruleNudge.findUnique({ where: { id: shown.id } }))?.status).toBe(
      'dismissed',
    );
  });

  it('#4/#10 copy/paste carry no clipboard text; after revoking consent only chars are kept', async () => {
    await asStudent(http().put(`/api/text-consent/courses/${courseId}`))
      .send({ answerText: false, promptsAndOutputs: false, researchUse: true })
      .expect(200);
    const now = Date.now();
    await batch([
      ev('OUTPUT_COPIED', now, 's1-20', 'lab', { runId: 'r1', chars: 120 }),
      ev('OUTPUT_PASTED', now + 1, 's1-20', 'lab', {
        targetField: 'answer',
        chars: 120,
        matchesAiOutput: true,
        matchKind: 'exact',
        runId: 'r1',
      }),
      ev('PREDICTION_COMMITTED', now + 2, 's1-21', 'predict', {
        kind: 'predict',
        text: 'this text must not be stored',
        chars: 28,
        msOnSlide: 40_000,
      }),
    ]);
    const rows = await prisma.activityLog.findMany({ where: { sessionId } });
    const commit = rows.find(
      (r) => r.action === 'PREDICTION_COMMITTED' && (r.metadata as Meta).slideKey === 's1-21',
    )!;
    expect(commit.metadata).toMatchObject({ chars: 28 });
    expect(commit.metadata).not.toHaveProperty('text');
    const paste = rows.find((r) => r.action === 'OUTPUT_PASTED')!;
    expect(paste.metadata).toMatchObject({ matchesAiOutput: true, chars: 120 });

    // No clipboard text anywhere in this course's activity rows.
    const all = await prisma.activityLog.findMany({ where: { userId: studentId } });
    for (const r of all) {
      const m = (r.metadata ?? {}) as Meta;
      expect(Object.keys(m).filter((k) => /clip/i.test(k))).toEqual([]);
      if (/^OUTPUT_(COPIED|PASTED)$/.test(r.action)) {
        expect(m).not.toHaveProperty('text');
      }
    }
  });
});
