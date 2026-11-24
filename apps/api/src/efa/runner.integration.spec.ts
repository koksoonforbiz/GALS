/**
 * The puzzle runner end to end over HTTP (Phase 5): fixed order, due-task
 * enforcement, step-by-step submission with server re-scoring, discontinue,
 * stale-step refusal, reload → interrupted (never re-run), the after
 * questions, occasion completion and the course unlocking.
 */
import * as path from 'path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import type { PuzzleQuestionItem, PuzzleQuestionSection, PuzzleStepView } from '@ats/shared';
import { PrismaService } from '../prisma';
import { createTestApp, cleanDatabase, assertSafeToWipe } from '../test/setup';
import { loadBatteryFiles } from './battery/battery-files';
import { seedBattery } from './battery/seed-battery';
import { EFA_NOTICE_VERSION } from './consent-notice';

const PASSWORD = 'Test-Passw0rd!';
const device = {
  userAgent: 'jest',
  screenW: 1920,
  screenH: 1080,
  viewportW: 1600,
  viewportH: 900,
  devicePixelRatio: 1,
  pointerFine: true,
  hoverNone: false,
  keyboardConfirmed: true,
  fullscreenAccepted: false,
};
const answerFor = (i: PuzzleQuestionItem): unknown =>
  i.type === 'number'
    ? (i.min ?? 1)
    : i.type === 'scale'
      ? i.min
      : i.type === 'text'
        ? 'English'
        : i.type === 'text2'
          ? { first: 'E', second: 'E' }
          : { option: i.options![0] };

/** A plausible raw browser result for any step; `wrong` answers sequences incorrectly. */
function resultFor(step: PuzzleStepView, wrong = false) {
  const t = { onsetMs: 10, firstInputMs: 400, submitMs: 900, focusLostMs: 0 };
  const p = step.payload as Record<string, unknown>;
  switch (step.kind) {
    case 'sequence':
      return {
        kind: 'sequence',
        response: wrong ? '0' : (p.items as string[]).join(''),
        shownMs: (p.items as string[]).map(() => 800),
        ...t,
      };
    case 'item':
      return { kind: 'item', response: '1', ...t };
    case 'list':
      return {
        kind: 'list',
        responses: (p.numbers as number[]).map((n, i) => ({
          response: String(n + 3),
          onsetMs: i * 1000,
          submitMs: i * 1000 + 800,
        })),
        startMs: 0,
        endMs: 30_000,
      };
    case 'sentence':
      return { kind: 'sentence', response: 'piano', ...t };
    case 'prompt':
      return {
        kind: 'prompt',
        entries: [
          { text: 'fish', atMs: 1200 },
          { text: 'fox', atMs: 2400 },
        ],
        startMs: 0,
        endMs: 60_000,
      };
    case 'grid':
      return {
        kind: 'grid',
        presses: [{ i: 0, key: 'red', atMs: 300 }],
        startMs: 0,
        endMs: 45_000,
      };
    case 'trail':
      return {
        kind: 'trail',
        clicks: [{ label: '1', atMs: 500 }],
        startMs: 0,
        endMs: 9_000,
        pxPerMm: 3,
      };
  }
}

describe('Puzzle runner (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let studentId: string;
  let courseId: string;
  let sessionId: string;
  let occasionId: string;

  const http = () => request(app.getHttpServer());
  const as = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('x-session-id', sessionId);
  const view = async () =>
    (await as(http().get(`/api/puzzles/courses/${courseId}/occasions/T0`)).expect(200)).body;
  const begin = (task: string) =>
    as(http().post(`/api/puzzles/occasions/${occasionId}/tasks/${task}/begin`));
  const submit = (runId: string, step: PuzzleStepView, wrong = false) =>
    as(http().post(`/api/puzzles/runs/${runId}/steps`)).send({
      stepId: step.id,
      attempt: step.attempt,
      result: resultFor(step, wrong),
    });

  /** Run a whole puzzle; returns the number of steps the server served. */
  async function runTask(task: string, wrong = false) {
    const b = await begin(task).expect(201);
    let step: PuzzleStepView | null = b.body.step;
    let served = 0;
    while (step) {
      served++;
      const r = await submit(b.body.runId, step, wrong).expect(201);
      step = r.body.next;
      if (!step) expect(r.body.done).toBe(true);
    }
    return { runId: b.body.runId as string, served };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanDatabase(prisma);
    await prisma.efaAllocationSlot.deleteMany();
    await prisma.efaStimulusSet.deleteMany();
    await seedBattery(
      prisma as never,
      loadBatteryFiles(path.resolve(__dirname, '../../../../docs/EF_battery_v2')),
    );
    const reg = async (email: string, role: string) =>
      (
        await http()
          .post('/api/auth/register')
          .send({ email, password: PASSWORD, termsAccepted: true, name: email, role })
      ).body;
    const teacher = await reg('run-teacher@test.com', 'teacher');
    const student = await reg('run-student@test.com', 'student');
    token = student.accessToken;
    studentId = student.user.id;
    courseId = (
      await prisma.course.create({
        data: {
          title: 'Run course',
          description: 'x',
          teacherId: teacher.user.id,
          status: 'PUBLISHED',
        },
      })
    ).id;
    const m1 = (
      await prisma.courseModule.create({ data: { courseId, title: 'Session 1', orderIndex: 0 } })
    ).id;
    for (const [kind, sequence] of [
      ['EF_QUESTIONNAIRE', 10],
      ['EF_TESTS', 20],
    ] as const) {
      await prisma.courseGate.create({
        data: { courseId, kind, occasion: 'T0', position: 'BEFORE_MODULE', moduleId: m1, sequence },
      });
    }
    await prisma.enrollment.create({ data: { studentId, courseId, status: 'ACTIVE' } });
    sessionId = (
      await http().post('/api/activity-log/session/open').set('Authorization', `Bearer ${token}`)
    ).body.sessionId;
    await as(http().patch('/api/activity-log/session/course')).send({ courseId }).expect(200);

    // Notice → questionnaire → colour check (passed).
    occasionId = (
      await as(http().post(`/api/puzzles/courses/${courseId}/occasions/T0/start`)).send({
        noticeVersion: EFA_NOTICE_VERSION,
        accepted: true,
        device,
      })
    ).body.occasionId;
    const q = await as(
      http().get(`/api/puzzles/occasions/${occasionId}/questionnaire?part=before`),
    );
    for (const item of (q.body.sections as PuzzleQuestionSection[]).flatMap((s) => s.items)) {
      await as(http().put(`/api/puzzles/occasions/${occasionId}/answers/${item.code}`)).send({
        value: answerFor(item),
      });
    }
    await as(http().post(`/api/puzzles/occasions/${occasionId}/questionnaire/submit`))
      .send({ part: 'before' })
      .expect(201);
    await as(http().post(`/api/puzzles/occasions/${occasionId}/colour-check`))
      .send({ answers: (['red', 'green', 'blue'] as const).map((c) => ({ shown: c, chosen: c })) })
      .expect(201);
  }, 90_000);

  afterAll(async () => {
    assertSafeToWipe(); // before any delete-by-id (ids are undefined if setup was refused)
    await prisma.courseGate.deleteMany({ where: { courseId } });
    await prisma.efaOccasion.deleteMany({ where: { courseId } });
    await prisma.efaAllocationSlot.deleteMany();
    await prisma.efaStimulusSet.deleteMany();
    await cleanDatabase(prisma);
    await app.close();
  });

  it('the first puzzle is due, with neutral numbering; others cannot be started yet', async () => {
    const v = await view();
    expect(v.next).toBe('tasks');
    expect(v.task).toEqual({ code: 'w1', number: 1, of: 7 });
    await begin('w2').expect(409);
  });

  it('W1 all wrong: practice repeated once, each part discontinued after its first length', async () => {
    const { runId, served } = await runTask('w1', true);
    // fwd: practice ×2 + 2 trials; bwd: practice ×2 + 2 trials
    expect(served).toBe(8);
    const run = await prisma.efaTaskRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe('completed');
    expect(run.flags).toEqual(expect.objectContaining({ discontinued: ['fwd', 'bwd'] }));
    const test = await prisma.efaTrial.findMany({ where: { taskRunId: runId, phase: 'test' } });
    expect(test).toHaveLength(4);
    expect(test.every((t) => t.correct === false)).toBe(true);
  });

  it('a stale or replayed step is refused', async () => {
    const b = await begin('w2').expect(201);
    const first: PuzzleStepView = b.body.step;
    await submit(b.body.runId, first).expect(201);
    await submit(b.body.runId, first).expect(409);
    // Leave W2 by loading the page again: it becomes interrupted.
    expect((await view()).task.code).toBe('w3');
    const run = await prisma.efaTaskRun.findUniqueOrThrow({ where: { id: b.body.runId } });
    expect(run.status).toBe('interrupted');
    await submit(b.body.runId, first).expect(409);
  });

  it('a reload mid-puzzle marks it interrupted and moves to the next one, never re-running it', async () => {
    const b = await begin('w3').expect(201);
    await submit(b.body.runId, b.body.step).expect(201);
    const v = await view(); // page reload
    expect(v.task.code).toBe('w4');
    expect(
      (await prisma.efaTaskRun.findUniqueOrThrow({ where: { id: b.body.runId } })).status,
    ).toBe('interrupted');
    await begin('w3').expect(409);
    expect(
      await prisma.activityLog.count({
        where: { userId: studentId, action: 'EF_TASK_INTERRUPTED' },
      }),
    ).toBe(2);
  });

  it('W4–W7 run to completion and store trial-level data', async () => {
    for (const task of ['w4', 'w5', 'w6', 'w7']) await runTask(task);
    const runs = await prisma.efaTaskRun.findMany({
      where: { occasionId },
      orderBy: { createdAt: 'asc' },
    });
    expect(runs.map((r) => `${r.taskCode}:${r.status}`)).toEqual([
      'w1:completed',
      'w2:interrupted',
      'w3:interrupted',
      'w4:completed',
      'w5:completed',
      'w6:completed',
      'w7:completed',
    ]);
    const w5 = runs.find((r) => r.taskCode === 'w5')!;
    expect(await prisma.efaTrial.count({ where: { taskRunId: w5.id, phase: 'test' } })).toBe(30);
  });

  it('then the after questions complete the occasion and open the course', async () => {
    expect((await view()).next).toBe('after');
    const q = await as(
      http().get(`/api/puzzles/occasions/${occasionId}/questionnaire?part=after`),
    ).expect(200);
    for (const item of (q.body.sections as PuzzleQuestionSection[]).flatMap((s) => s.items)) {
      await as(http().put(`/api/puzzles/occasions/${occasionId}/answers/${item.code}`))
        .send({ value: answerFor(item) })
        .expect(200);
    }
    const done = await as(http().post(`/api/puzzles/occasions/${occasionId}/questionnaire/submit`))
      .send({ part: 'after' })
      .expect(201);
    expect(done.body.next).toBe('done');
    const course = await as(http().get(`/api/courses/${courseId}`)).expect(200);
    expect(course.body.modules[0].locked).toBe(false);
    const counts = await prisma.activityLog.groupBy({
      by: ['action'],
      where: {
        userId: studentId,
        action: { in: ['EF_TASK_STARTED', 'EF_TASK_COMPLETED', 'EF_OCCASION_COMPLETED'] },
      },
      _count: true,
    });
    expect(Object.fromEntries(counts.map((c) => [c.action, c._count]))).toEqual({
      EF_TASK_STARTED: 7,
      EF_TASK_COMPLETED: 5,
      EF_OCCASION_COMPLETED: 1,
    });
  });
});
