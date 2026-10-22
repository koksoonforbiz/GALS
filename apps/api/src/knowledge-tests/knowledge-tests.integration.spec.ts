/**
 * Knowledge tests over HTTP: gate order warm-up → pre-study → S1 pre →
 * S1 lesson → S1 post → … → S8 post → post-study → post-study warm-up,
 * server-side refusals (with KNOWLEDGE_TEST_GATE_BLOCKED), no keys on the
 * student door, append-only attempts, staff exports, blinded two-rater
 * scoring with adjudication, and inter-rater agreement.
 */
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import type { KnowledgeTestStatus, KnowledgeTestStudentItem } from '@ats/shared';
import { PrismaService } from '../prisma';
import { createTestApp, cleanDatabase } from '../test/setup';
import { bankDefinitions, type BankFile } from './bank';

process.env.RESEARCH_EXPORT_SALT ??= 'knowledge-tests-integration-salt';
const PASSWORD = 'Test-Passw0rd!';
const bank = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../../docs/assessment/knowledge_tests_v2.json'),
    'utf8',
  ),
) as BankFile;

describe('Knowledge tests (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let raterToken: string;
  let studentToken: string;
  let studentId: string;
  let courseId: string;
  let sessionId: string;
  const lessons: Array<{ moduleId: string; itemId: string }> = [];
  const efGates: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const asStudent = (r: request.Test) =>
    r.set('Authorization', `Bearer ${studentToken}`).set('x-session-id', sessionId);
  const as = (t: string, r: request.Test) => r.set('Authorization', `Bearer ${t}`);
  const kt = (p: string) => `/api/knowledge-tests${p}`;
  const admin = (p: string) => `/api/knowledge-tests-admin${p}`;
  const status = async () =>
    (await asStudent(http().get(kt(`/courses/${courseId}/status`))).expect(200))
      .body as KnowledgeTestStatus;
  const stateOf = async (kind: string, n: number | null = null) =>
    (await status()).tests.find((t) => t.kind === kind && t.sessionNo === n)!;
  const start = (kind: string, sessionNo?: number) =>
    asStudent(http().post(kt(`/courses/${courseId}/attempts`))).send({
      kind,
      ...(sessionNo ? { sessionNo } : {}),
    });
  /** Answer every item (first option / three options / text) and submit. */
  async function take(
    kind: string,
    sessionNo?: number,
    text = 'Because the model samples; repeat the prompt five times.',
  ) {
    const s = await start(kind, sessionNo).expect(201);
    const responses: Record<string, unknown> = {};
    for (const it of s.body.items as KnowledgeTestStudentItem[]) {
      responses[it.slot] =
        it.type === 'mcq'
          ? { option: it.options![0]!.id }
          : it.type === 'sata'
            ? { options: it.options!.slice(0, 3).map((o) => o.id) }
            : { text };
    }
    await asStudent(http().patch(kt(`/attempts/${s.body.attemptId}`)))
      .send({ responses })
      .expect(200);
    const sub = await asStudent(http().post(kt(`/attempts/${s.body.attemptId}/submit`)))
      .send({})
      .expect(201);
    expect(sub.body).toEqual({ submitted: true });
    return s.body.attemptId as string;
  }
  const finishLesson = (n: number) =>
    prisma.lessonSlideState.create({
      data: {
        studentId,
        moduleItemId: lessons[n - 1]!.itemId,
        slideKey: `s${n}-2`,
        state: { fields: { a: 'x' } },
      },
    });
  const lessonGet = (n: number) =>
    asStudent(http().get(`/api/interactive-lessons/items/${lessons[n - 1]!.itemId}`));

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanDatabase(prisma);
    const reg = async (email: string, role: string) =>
      (
        await http()
          .post('/api/auth/register')
          .send({ email, password: PASSWORD, termsAccepted: true, name: email, role })
      ).body;
    const owner = await reg('kt-owner@test.com', 'teacher');
    const rater = await reg('kt-rater@test.com', 'teacher');
    const student = await reg('kt-student@test.com', 'student');
    [ownerToken, raterToken, studentToken] = [owner, rater, student].map((u) => u.accessToken);
    studentId = student.user.id;
    courseId = (
      await prisma.course.create({
        data: {
          title: 'KT course',
          description: 'x',
          teacherId: owner.user.id,
          status: 'PUBLISHED',
        },
      })
    ).id;
    for (let n = 1; n <= 9; n++) {
      const title = n <= 8 ? `Session ${n}: topic ${n}` : 'Appendix: References';
      const m = await prisma.courseModule.create({ data: { courseId, title, orderIndex: n - 1 } });
      const item = await prisma.moduleItem.create({
        data: {
          moduleId: m.id,
          title: `Lesson ${n}`,
          type: 'INTERACTIVE_LESSON',
          orderIndex: 0,
          lessonJson: {
            version: 1,
            session: n,
            slides: [
              { key: `s${n}-1`, t: 'title' },
              { key: `s${n}-2`, t: 'reflect' },
            ],
          },
        },
      });
      lessons.push({ moduleId: m.id, itemId: item.id });
    }
    // EF warm-up gates (T0 before Session 1, T2 after the last module).
    for (const [kind, occasion, position, moduleId, sequence] of [
      ['EF_QUESTIONNAIRE', 'T0', 'BEFORE_MODULE', lessons[0]!.moduleId, 10],
      ['EF_TESTS', 'T0', 'BEFORE_MODULE', lessons[0]!.moduleId, 20],
      ['EF_TESTS', 'T2', 'AFTER_MODULE', lessons[8]!.moduleId, 920],
    ] as const) {
      efGates[`${kind}:${occasion}`] = (
        await prisma.courseGate.create({
          data: { courseId, kind, occasion, position, moduleId, sequence },
        })
      ).id;
    }
    await prisma.enrollment.create({ data: { studentId, courseId, status: 'ACTIVE' } });
    await prisma.efaRaterAssignment.create({
      data: { courseId, taskCode: 'w4', raterId: rater.user.id },
    });
    sessionId = (
      await http()
        .post('/api/activity-log/session/open')
        .set('Authorization', `Bearer ${studentToken}`)
    ).body.sessionId;
    await asStudent(http().patch('/api/activity-log/session/course'))
      .send({ courseId })
      .expect(200);
  }, 120_000);

  afterAll(async () => {
    await prisma.efaRaterAssignment.deleteMany({ where: { courseId } });
    await prisma.knowledgeTestAssignment.deleteMany({ where: { courseId } });
    await prisma.knowledgeTestDefinition.deleteMany({ where: { courseId } });
    await prisma.courseGate.deleteMany({ where: { courseId } });
    await cleanDatabase(prisma);
    await app.close();
  });

  it('setup: staff only; needs the item bank; then places 18 gates in course order', async () => {
    await as(studentToken, http().get(admin(`/courses/${courseId}/setup`))).expect(403);
    await as(ownerToken, http().put(admin(`/courses/${courseId}/setup`)))
      .send({ enabled: true })
      .expect(409);
    for (const d of bankDefinitions(bank)) {
      await prisma.knowledgeTestDefinition.create({
        data: {
          courseId,
          scope: d.scope,
          sessionNo: d.sessionNo,
          form: d.form,
          version: d.version,
          items: d.items as never,
          maxMarks: d.maxMarks,
        },
      });
    }
    const s = (
      await as(ownerToken, http().put(admin(`/courses/${courseId}/setup`)))
        .send({ enabled: true })
        .expect(200)
    ).body;
    expect(s.enabled).toBe(true);
    expect(s.gates).toHaveLength(18);
    expect(s.sessions).toHaveLength(8);
    const g = (o: string) => s.gates.find((x: { occasion: string }) => x.occasion === o);
    expect(g('PRE_STUDY')).toEqual(
      expect.objectContaining({
        position: 'BEFORE_MODULE',
        sequence: 30,
        moduleId: lessons[0]!.moduleId,
      }),
    );
    expect(g('S3_PRE')).toEqual(
      expect.objectContaining({
        position: 'BEFORE_MODULE',
        sequence: 40,
        moduleId: lessons[2]!.moduleId,
      }),
    );
    expect(g('S3_POST')).toEqual(
      expect.objectContaining({
        position: 'AFTER_MODULE',
        sequence: 800,
        moduleId: lessons[2]!.moduleId,
      }),
    );
    expect(g('POST_STUDY')).toEqual(
      expect.objectContaining({
        position: 'AFTER_MODULE',
        sequence: 900,
        moduleId: lessons[7]!.moduleId,
      }),
    );
  });

  it('pre-study is refused before the warm-up, with a reason and a GATE_BLOCKED event', async () => {
    const pre = await stateOf('PRE_STUDY');
    expect(pre).toEqual(expect.objectContaining({ state: 'locked', reasonCode: 'PREVIOUS_STEP' }));
    expect(pre.reason).toContain('About you and how you feel today');
    const r = await start('PRE_STUDY').expect(403);
    expect(r.body.code).toBe('PREVIOUS_STEP');
    const ev = await prisma.activityLog.findFirst({
      where: { userId: studentId, action: 'KNOWLEDGE_TEST_GATE_BLOCKED' },
    });
    expect(ev?.metadata).toEqual(
      expect.objectContaining({ kind: 'PRE_STUDY', reason: 'PREVIOUS_STEP' }),
    );
    expect(await prisma.knowledgeTestAssignment.count({ where: { studentId } })).toBe(18);
  });

  it('after the warm-up: the student payload has no keys; autosave; submit returns nothing else; attempts are append-only', async () => {
    for (const k of ['EF_QUESTIONNAIRE:T0', 'EF_TESTS:T0'])
      await prisma.studentGateCompletion.create({
        data: { gateId: efGates[k]!, studentId, source: 'auto' },
      });
    await lessonGet(1).expect(403); // Session 1 still locked
    const s = await start('PRE_STUDY').expect(201);
    expect(JSON.stringify(s.body)).not.toMatch(/"correct"|"rubric"|"objective"|autoScore|maxMarks/);
    expect(s.body.items).toHaveLength(24);
    const assignment = await prisma.knowledgeTestAssignment.findFirstOrThrow({
      where: { studentId, kind: 'PRE_STUDY' },
    });
    expect(s.body.form).toBe(assignment.form);
    // resume returns the same attempt
    expect((await start('PRE_STUDY').expect(201)).body.attemptId).toBe(s.body.attemptId);
    await asStudent(http().patch(kt(`/attempts/${s.body.attemptId}`)))
      .send({ responses: { '1': { option: 'Z' } } })
      .expect(400);
    await asStudent(http().patch(kt(`/attempts/${s.body.attemptId}`)))
      .send({ responses: { '99': { option: 'A' } } })
      .expect(400);
    await asStudent(http().patch(kt(`/attempts/${s.body.attemptId}`)))
      .send({ responses: { '1': { option: 'A' } } })
      .expect(200);
    const sub = await asStudent(http().post(kt(`/attempts/${s.body.attemptId}/submit`)))
      .send({})
      .expect(201);
    expect(sub.body).toEqual({ submitted: true });
    const row = await prisma.knowledgeTestAttempt.findUniqueOrThrow({
      where: { id: s.body.attemptId },
    });
    expect(row).toEqual(expect.objectContaining({ status: 'SUBMITTED', autosaveOnly: true }));
    expect((row.autoScore as { omitted: number }).omitted).toBe(23);
    // immutable
    await asStudent(http().patch(kt(`/attempts/${s.body.attemptId}`)))
      .send({ responses: { '1': { option: 'B' } } })
      .expect(403);
    await asStudent(http().post(kt(`/attempts/${s.body.attemptId}/submit`)))
      .send({})
      .expect(403);
    expect((await start('PRE_STUDY').expect(403)).body.code).toBe('ALREADY_SUBMITTED');
    expect(
      await prisma.activityLog.count({
        where: { userId: studentId, action: 'KNOWLEDGE_TEST_SUBMITTED' },
      }),
    ).toBe(1);
  });

  it('the browser cannot forge a submission event', async () => {
    await asStudent(http().post('/api/activity-log/batch'))
      .send({
        sessionId,
        events: [{ action: 'KNOWLEDGE_TEST_SUBMITTED', occurredAt: new Date().toISOString() }],
      })
      .expect(400);
  });

  it('Session 1: lesson opens only after its pre-test; post-test only after the reflect slide; Session 2 only after that', async () => {
    await lessonGet(1).expect(403);
    await take('PRE_SESSION', 1);
    await lessonGet(1).expect(200);
    await lessonGet(2).expect(403);
    expect(await stateOf('POST_SESSION', 1)).toEqual(
      expect.objectContaining({ state: 'locked', reasonCode: 'LESSON_NOT_FINISHED' }),
    );
    expect((await start('POST_SESSION', 1).expect(403)).body.code).toBe('LESSON_NOT_FINISHED');
    await finishLesson(1);
    expect((await stateOf('POST_SESSION', 1)).state).toBe('available');
    expect((await stateOf('PRE_SESSION', 2)).state).toBe('locked');
    await take('POST_SESSION', 1);
    await lessonGet(2).expect(403); // S2 pre first
    expect((await stateOf('PRE_SESSION', 2)).state).toBe('available');
  });

  it('through Session 8; post-study opens last; then the post-study warm-up is next', async () => {
    for (let n = 2; n <= 8; n++) {
      await take('PRE_SESSION', n);
      await finishLesson(n);
      await take('POST_SESSION', n);
    }
    await lessonGet(9).expect(403); // appendix after the post-study test
    const postId = await take('POST_STUDY');
    expect(postId).toBeTruthy();
    await lessonGet(9).expect(200);
    const course = (await asStudent(http().get(`/api/courses/${courseId}`)).expect(200)).body;
    const t2 = course.gateSteps.find((g: { occasion: string }) => g.occasion === 'T2');
    expect(t2).toEqual(expect.objectContaining({ next: true, done: false }));
    expect((await status()).tests.every((t) => t.state === 'submitted')).toBe(true);
  });

  it('exports: assignments, attempts and responses, pseudonymised', async () => {
    const get = async (f: string) =>
      (await as(ownerToken, http().get(admin(`/courses/${courseId}/${f}`))).expect(200)).text;
    const assignments = await get('assignments.csv');
    const attempts = await get('attempts.csv');
    const responses = await get('responses.csv');
    expect(assignments.trim().split('\n')).toHaveLength(19);
    expect(attempts.trim().split('\n')).toHaveLength(19); // 18 submitted
    expect(attempts.split('\n')[0]).toBe(
      'pid,attempt_id,kind,session_no,form,order,started_at,submitted_at,duration_ms,omitted_count,auto_total,auto_max,written_total,max_marks,status,flags',
    );
    expect(responses).toContain(',open,Because the model samples');
    for (const body of [assignments, attempts]) expect(body).not.toContain(studentId);
    await as(raterToken, http().get(admin(`/courses/${courseId}/attempts.csv`))).expect(403);
  });

  it('blinded written scoring: two raters, adjudication when they disagree, inter-rater agreement', async () => {
    const next = (
      await as(ownerToken, http().get(admin(`/courses/${courseId}/written/next`))).expect(200)
    ).body;
    expect(next.remaining).toBe(20); // 16 session + 2 × 2 study open answers
    const item = next.next;
    expect(Object.keys(item).sort()).toEqual([
      'attemptId',
      'maxMarks',
      'needsAdjudication',
      'rubric',
      'scoredByMe',
      'shownAt',
      'slot',
      'stem',
      'text',
    ]);
    expect(JSON.stringify(item)).not.toContain(studentId);
    const url = admin(`/attempts/${item.attemptId}/written/${item.slot}/score`);
    const ones = Array(item.maxMarks).fill(1);
    const zeros = Array(item.maxMarks).fill(0);
    await as(ownerToken, http().post(url))
      .send({ dimensionScores: [1], shownAt: item.shownAt })
      .expect(item.maxMarks === 1 ? 201 : 400);
    await as(ownerToken, http().post(url))
      .send({ dimensionScores: ones, shownAt: item.shownAt })
      .expect(201);
    await as(ownerToken, http().post(url)).send({ dimensionScores: ones }).expect(409); // no second score
    await as(raterToken, http().post(url)).send({ dimensionScores: zeros }).expect(201);
    expect(
      (
        await as(
          ownerToken,
          http().get(admin(`/courses/${courseId}/written/disagreements`)),
        ).expect(200)
      ).body.items,
    ).toHaveLength(1);
    await as(raterToken, http().post(url))
      .send({ dimensionScores: ones, role: 'ADJUDICATOR' })
      .expect(403); // an assigned rater who doesn't own the course can't adjudicate
    const third = await http()
      .post('/api/auth/register')
      .send({
        email: 'kt-admin2@test.com',
        password: PASSWORD,
        termsAccepted: true,
        name: 'x',
        role: 'teacher',
      });
    await as(third.body.accessToken, http().post(url))
      .send({ dimensionScores: ones, role: 'ADJUDICATOR' })
      .expect(403); // not course staff
    await as(
      ownerToken,
      http().post(admin(`/attempts/${item.attemptId}/written/${item.slot}/score`)),
    )
      .send({ dimensionScores: zeros, role: 'ADJUDICATOR' })
      .expect(409); // owner already scored as rater

    // Score every remaining open answer twice in agreement → attempts SCORED.
    for (;;) {
      const n = (
        await as(ownerToken, http().get(admin(`/courses/${courseId}/written/next`))).expect(200)
      ).body.next;
      if (!n) break;
      const u = admin(`/attempts/${n.attemptId}/written/${n.slot}/score`);
      await as(ownerToken, http().post(u))
        .send({ dimensionScores: Array(n.maxMarks).fill(1) })
        .expect(201);
      await as(raterToken, http().post(u))
        .send({ dimensionScores: Array(n.maxMarks).fill(1) })
        .expect(201);
    }
    const ir = (
      await as(ownerToken, http().get(admin(`/courses/${courseId}/inter-rater`))).expect(200)
    ).body.items;
    const four = ir.find((x: { maxMarks: number }) => x.maxMarks === 4);
    expect(four).toEqual(
      expect.objectContaining({ scope: 'study', totalKappaWeighting: 'quadratic' }),
    );
    expect(ir.reduce((s: number, x: { n: number }) => s + x.n, 0)).toBe(20);
    const scored = await prisma.knowledgeTestAttempt.count({
      where: { assignment: { courseId }, status: 'SCORED' },
    });
    expect(scored).toBe(17); // all but the attempt whose disagreement is still open
  });
});
