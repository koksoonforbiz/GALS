/**
 * One assessment occasion through the real HTTP stack (Phase 4): notice and
 * device record, form allocation, questionnaire autosave/validation/submit,
 * gate completion, colour check, abandonment and ownership. Every student
 * response is also checked for blinding (no construct names, no keys).
 */
import * as path from 'path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import type { PuzzleQuestionItem, PuzzleQuestionSection } from '@ats/shared';
import { PrismaService } from '../prisma';
import { createTestApp, cleanDatabase } from '../test/setup';
import { loadBatteryFiles } from './battery/battery-files';
import { seedBattery } from './battery/seed-battery';
import { EFA_NOTICE_VERSION } from './consent-notice';

const PASSWORD = 'Test-Passw0rd!';
const FORBIDDEN =
  /ADEXI|Stroop|Hayling|executive|inhibition|working memory|switch cost|EF_|"form"|orderCode/i;

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
  fullscreenAccepted: true,
};

/** A valid answer for any item, as the web form would send it. */
function answerFor(i: PuzzleQuestionItem): unknown {
  if (i.type === 'number') return i.min ?? 1;
  if (i.type === 'scale') return i.min;
  if (i.type === 'text') return 'English';
  if (i.type === 'text2') return { first: 'English', second: 'English' };
  return { option: i.options![0] };
}

describe('Puzzles occasion flow (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let otherToken: string;
  let studentId: string;
  let courseId: string;
  let sessionId: string;
  let occasionId: string;

  const http = () => request(app.getHttpServer());
  const student = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('x-session-id', sessionId);
  const noLeak = (body: unknown) => expect(JSON.stringify(body)).not.toMatch(FORBIDDEN);
  const base = () => `/api/puzzles/courses/${courseId}/occasions/T0`;

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
    const t = await reg('pz-teacher@test.com', 'teacher');
    const s = await reg('pz-student@test.com', 'student');
    token = s.accessToken;
    studentId = s.user.id;
    const o = await reg('pz-other@test.com', 'student');
    otherToken = o.accessToken;

    courseId = (
      await prisma.course.create({
        data: {
          title: 'Puzzle course',
          description: 'x',
          teacherId: t.user.id,
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
    await prisma.enrollment.createMany({
      data: [
        { studentId, courseId, status: 'ACTIVE' },
        { studentId: o.user.id, courseId, status: 'ACTIVE' },
      ],
    });
    sessionId = (
      await http().post('/api/activity-log/session/open').set('Authorization', `Bearer ${token}`)
    ).body.sessionId;
    await student(http().patch('/api/activity-log/session/course')).send({ courseId }).expect(200);
  }, 60_000);

  afterAll(async () => {
    await prisma.courseGate.deleteMany({ where: { courseId } });
    await prisma.efaOccasion.deleteMany({ where: { courseId } });
    await prisma.efaAllocationSlot.deleteMany();
    await prisma.efaStimulusSet.deleteMany();
    await cleanDatabase(prisma);
    await app.close();
  });

  it('before starting: next step is the notice, with its text and version', async () => {
    const r = await student(http().get(base())).expect(200);
    expect(r.body).toEqual(
      expect.objectContaining({ next: 'consent', occasionId: null, puzzleCount: 7 }),
    );
    expect(r.body.notice.version).toBe(EFA_NOTICE_VERSION);
    noLeak(r.body);
  });

  it('start requires acceptance, the current notice version and the keyboard confirmation', async () => {
    await student(http().post(`${base()}/start`))
      .send({ noticeVersion: EFA_NOTICE_VERSION, accepted: false, device })
      .expect(400);
    await student(http().post(`${base()}/start`))
      .send({ noticeVersion: 'old', accepted: true, device })
      .expect(400);
    await student(http().post(`${base()}/start`))
      .send({
        noticeVersion: EFA_NOTICE_VERSION,
        accepted: true,
        device: { ...device, keyboardConfirmed: false },
      })
      .expect(400);
  });

  it('start records consent and device, allocates a form, and logs the start server-side', async () => {
    const r = await student(http().post(`${base()}/start`))
      .send({ noticeVersion: EFA_NOTICE_VERSION, accepted: true, device })
      .expect(201);
    expect(r.body.next).toBe('questionnaire');
    noLeak(r.body);
    occasionId = r.body.occasionId;
    const o = await prisma.efaOccasion.findUniqueOrThrow({ where: { id: occasionId } });
    const slot = await prisma.efaAllocationSlot.findFirstOrThrow({
      where: { claimedStudentId: studentId },
    });
    expect(o.form).toBe(slot.t0);
    expect(o.orderCode).toBe(slot.orderCode);
    expect(o.consentVersion).toBe(EFA_NOTICE_VERSION);
    expect(o.stimuliSha256).toBe(
      'a705e66707fb0f67f7d73241957dc12b73a0c61eca0b204584d251a97e2dd832',
    );
    expect(o.sensingPaused).toBe(true);
    expect(
      await prisma.activityLog.count({
        where: { userId: studentId, action: 'EF_OCCASION_STARTED' },
      }),
    ).toBe(1);
    // Starting again resumes instead of re-allocating.
    await student(http().post(`${base()}/start`))
      .send({ noticeVersion: EFA_NOTICE_VERSION, accepted: true, device })
      .expect(201);
    expect(await prisma.efaAllocationSlot.count({ where: { claimedStudentId: studentId } })).toBe(
      1,
    );
  });

  let sections: PuzzleQuestionSection[];

  it('questionnaire (before): background, habits, today — 33 items at T0', async () => {
    const r = await student(
      http().get(`/api/puzzles/occasions/${occasionId}/questionnaire?part=before`),
    ).expect(200);
    sections = r.body.sections;
    expect(sections.map((s) => s.key)).toEqual(['about', 'usually', 'today']);
    expect(sections.flatMap((s) => s.items)).toHaveLength(33);
    expect(r.body.title).toBe('About you and how you feel today');
    noLeak(r.body);
  });

  it('autosave validates each answer', async () => {
    await student(http().put(`/api/puzzles/occasions/${occasionId}/answers/C1`))
      .send({ value: 30 })
      .expect(400);
    await student(http().put(`/api/puzzles/occasions/${occasionId}/answers/C1`))
      .send({ value: 7.5 })
      .expect(200);
    await student(http().put(`/api/puzzles/occasions/${occasionId}/answers/C8`))
      .send({ value: 5 })
      .expect(400); // not this step
  });

  it('submit lists what is missing, then completes the questionnaire gate', async () => {
    const miss = await student(
      http().post(`/api/puzzles/occasions/${occasionId}/questionnaire/submit`),
    )
      .send({ part: 'before' })
      .expect(400);
    expect(miss.body.message).toMatch(/every question/);

    for (const item of sections.flatMap((s) => s.items)) {
      await student(http().put(`/api/puzzles/occasions/${occasionId}/answers/${item.code}`))
        .send({ value: answerFor(item) })
        .expect(200);
    }
    const r = await student(
      http().post(`/api/puzzles/occasions/${occasionId}/questionnaire/submit`),
    )
      .send({ part: 'before' })
      .expect(201);
    expect(r.body.next).toBe('colour');

    const course = await student(http().get(`/api/courses/${courseId}`)).expect(200);
    expect(course.body.gateSteps.map((s: { done: boolean }) => s.done)).toEqual([true, false]);
    expect(course.body.modules[0].locked).toBe(true); // puzzles still to do
    expect(
      await prisma.activityLog.count({
        where: { userId: studentId, action: 'EF_QUESTIONNAIRE_SUBMITTED' },
      }),
    ).toBe(1);
  });

  it('a failed colour check skips the colour puzzle and moves on', async () => {
    const r = await student(http().post(`/api/puzzles/occasions/${occasionId}/colour-check`))
      .send({
        answers: [
          { shown: 'red', chosen: 'red' },
          { shown: 'green', chosen: 'blue' },
          { shown: 'blue', chosen: 'blue' },
        ],
      })
      .expect(201);
    expect(r.body.next).toBe('tasks');
    noLeak(r.body);
    const run = await prisma.efaTaskRun.findFirstOrThrow({ where: { occasionId, taskCode: 'w6' } });
    expect(run).toEqual(
      expect.objectContaining({ status: 'skipped', skipReason: 'colour_check_failed' }),
    );
    const o = await prisma.efaOccasion.findUniqueOrThrow({ where: { id: occasionId } });
    expect(o.flags).toEqual(expect.objectContaining({ colourCheckFailed: true }));
    await student(http().post(`/api/puzzles/occasions/${occasionId}/colour-check`))
      .send({
        answers: [
          { shown: 'red', chosen: 'red' },
          { shown: 'green', chosen: 'green' },
          { shown: 'blue', chosen: 'blue' },
        ],
      })
      .expect(409);
  });

  it('the after-questions are refused until the puzzles are done', async () => {
    await student(http().post(`/api/puzzles/occasions/${occasionId}/questionnaire/submit`))
      .send({ part: 'after' })
      .expect(409);
  });

  it('another student cannot read or write this occasion', async () => {
    await http()
      .get(`/api/puzzles/occasions/${occasionId}/questionnaire?part=before`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    await http()
      .put(`/api/puzzles/occasions/${occasionId}/answers/C1`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ value: 8 })
      .expect(404);
  });

  it('works on the public door; staff and clients cannot use it', async () => {
    await student(http().get(base())).set('x-gals-door', 'public').expect(200);
    const teacher = await http()
      .post('/api/auth/login')
      .send({ identifier: 'pz-teacher@test.com', password: PASSWORD });
    await http().get(base()).set('Authorization', `Bearer ${teacher.body.accessToken}`).expect(403);
  });

  it('an occasion idle for more than 24 h simply continues (flagged for the analysis)', async () => {
    await prisma.efaOccasion.update({
      where: { id: occasionId },
      data: { lastActivityAt: new Date(Date.now() - 25 * 3600_000) },
    });
    const r = await student(http().get(base())).expect(200);
    expect(r.body.next).not.toBe('abandoned');
    const answer = await student(
      http().put(`/api/puzzles/occasions/${occasionId}/answers/C8`),
    ).send({ value: 5 });
    expect(answer.status).not.toBe(409); // not "expired"
    const o = await prisma.efaOccasion.findUniqueOrThrow({ where: { id: occasionId } });
    expect(o.status).not.toBe('abandoned');
    expect(o.flags).toEqual(expect.objectContaining({ resumedAfterIdle: true }));
  });

  it('an occasion expired under the old 24 h rule reopens by itself', async () => {
    await prisma.efaOccasion.update({
      where: { id: occasionId },
      data: { status: 'abandoned', abandonedAt: new Date() },
    });
    const r = await student(http().get(base())).expect(200);
    expect(r.body.next).not.toBe('abandoned');
    const o = await prisma.efaOccasion.findUniqueOrThrow({ where: { id: occasionId } });
    expect(o.abandonedAt).toBeNull();
  });
});
