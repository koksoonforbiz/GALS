/**
 * Phase 7 over HTTP: EF settings and gate placement, the progress
 * dashboard with the administration log, task reset (audited, items
 * re-exposed), reopening an expired occasion, gate unlock, rater assignment.
 */
import * as path from 'path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import type {
  EfaProgressView,
  EfaSettingsView,
  PuzzleQuestionItem,
  PuzzleQuestionSection,
  PuzzleStepView,
} from '@ats/shared';
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
  fullscreenAccepted: true,
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

describe('EF staff: settings, progress, reset, raters (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let outsiderToken: string;
  let studentToken: string;
  let ownerId: string;
  let outsiderId: string;
  let studentId: string;
  let courseId: string;
  let sessionId: string;
  let modules: string[];
  let occasionId: string;

  const http = () => request(app.getHttpServer());
  const as = (token: string, r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const asStudent = (r: request.Test) => as(studentToken, r).set('x-session-id', sessionId);
  const admin = (p: string) => `/api/efa-admin${p}`;
  const studentView = async () =>
    (await asStudent(http().get(`/api/puzzles/courses/${courseId}/occasions/T0`)).expect(200)).body;

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
    const owner = await reg('p7-owner@test.com', 'teacher');
    const outsider = await reg('p7-outsider@test.com', 'teacher');
    const student = await reg('p7-student@test.com', 'student');
    [ownerToken, outsiderToken, studentToken] = [owner, outsider, student].map(
      (u) => u.accessToken,
    );
    [ownerId, outsiderId, studentId] = [owner, outsider, student].map((u) => u.user.id);
    courseId = (
      await prisma.course.create({
        data: { title: 'P7 course', description: 'x', teacherId: ownerId, status: 'PUBLISHED' },
      })
    ).id;
    modules = [];
    for (let i = 0; i < 6; i++) {
      modules.push(
        (
          await prisma.courseModule.create({
            data: { courseId, title: `Session ${i + 1}`, orderIndex: i },
          })
        ).id,
      );
    }
    await prisma.enrollment.create({ data: { studentId, courseId, status: 'ACTIVE' } });
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
    assertSafeToWipe(); // before any delete-by-id (ids are undefined if setup was refused)
    await prisma.efaRaterAssignment.deleteMany({ where: { courseId } });
    await prisma.courseGate.deleteMany({ where: { courseId } });
    await prisma.efaOccasion.deleteMany({ where: { courseId } });
    await prisma.efaCourseConfig.deleteMany({ where: { courseId } });
    await prisma.efaAllocationSlot.deleteMany();
    await prisma.efaStimulusSet.deleteMany();
    await cleanDatabase(prisma);
    await app.close();
  });

  it('only the course owner (or an admin) reaches the staff routes', async () => {
    await as(studentToken, http().get(admin(`/courses/${courseId}/settings`))).expect(403);
    await as(outsiderToken, http().get(admin(`/courses/${courseId}/settings`))).expect(403);
    await as(outsiderToken, http().get(admin(`/courses/${courseId}/progress`))).expect(403);
  });

  it('defaults: T0 before the first session, T1 before Session 5, T2 after the last; nothing placed yet', async () => {
    const s: EfaSettingsView = (
      await as(ownerToken, http().get(admin(`/courses/${courseId}/settings`))).expect(200)
    ).body;
    expect(s.usingDefaults).toBe(true);
    expect(s.enabledOccasions).toEqual({ T0: true, T1: false, T2: true });
    expect(s.positions).toEqual({ T0: modules[0], T1: modules[4], T2: modules[5] });
    expect(s.gates).toHaveLength(0);
    expect(s.modules.map((m) => m.title)).toEqual([
      'Session 1',
      'Session 2',
      'Session 3',
      'Session 4',
      'Session 5',
      'Session 6',
    ]);
  });

  it('saving places the gates with the plan sequences; disabling an untouched occasion removes them', async () => {
    const body = {
      enabledOccasions: { T0: true, T1: true, T2: true },
      enabledTasks: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'],
      showDiagnosisItem: false,
      adexiAtT2: true,
      t2MinMinutesAfterPrevious: 30,
      positions: { T0: modules[0], T1: modules[2], T2: modules[5] },
    };
    let s: EfaSettingsView = (
      await as(ownerToken, http().put(admin(`/courses/${courseId}/settings`)))
        .send(body)
        .expect(200)
    ).body;
    expect(s.usingDefaults).toBe(false);
    expect(s.gates.map((g) => [g.occasion, g.kind, g.position, g.sequence, g.moduleId])).toEqual([
      ['T0', 'EF_QUESTIONNAIRE', 'BEFORE_MODULE', 10, modules[0]],
      ['T0', 'EF_TESTS', 'BEFORE_MODULE', 20, modules[0]],
      ['T1', 'EF_QUESTIONNAIRE', 'BEFORE_MODULE', 110, modules[2]],
      ['T1', 'EF_TESTS', 'BEFORE_MODULE', 120, modules[2]],
      ['T2', 'EF_QUESTIONNAIRE', 'AFTER_MODULE', 910, modules[5]],
      ['T2', 'EF_TESTS', 'AFTER_MODULE', 920, modules[5]],
    ]);
    expect(s.adexiAtT2).toBe(true);

    s = (
      await as(ownerToken, http().put(admin(`/courses/${courseId}/settings`)))
        .send({ ...body, enabledOccasions: { T0: true, T1: false, T2: true } })
        .expect(200)
    ).body;
    expect(s.gates.filter((g) => g.occasion === 'T1')).toHaveLength(0);

    await as(ownerToken, http().put(admin(`/courses/${courseId}/settings`)))
      .send({ ...body, positions: { ...body.positions, T1: null } })
      .expect(400);
    await as(ownerToken, http().put(admin(`/courses/${courseId}/settings`)))
      .send({ ...body, enabledTasks: [] })
      .expect(400);

    // Session 1 is locked for the student now.
    const course = (await asStudent(http().get(`/api/courses/${courseId}`)).expect(200)).body;
    expect(course.gateSteps.length).toBeGreaterThan(0);
  });

  it('progress lists the student, gates and the administration log', async () => {
    occasionId = (
      await asStudent(http().post(`/api/puzzles/courses/${courseId}/occasions/T0/start`))
        .send({ noticeVersion: EFA_NOTICE_VERSION, accepted: true, device })
        .expect(201)
    ).body.occasionId;
    const q = await asStudent(
      http().get(`/api/puzzles/occasions/${occasionId}/questionnaire?part=before`),
    );
    for (const item of (q.body.sections as PuzzleQuestionSection[]).flatMap((x) => x.items)) {
      await asStudent(http().put(`/api/puzzles/occasions/${occasionId}/answers/${item.code}`)).send(
        { value: answerFor(item) },
      );
    }
    await asStudent(http().post(`/api/puzzles/occasions/${occasionId}/questionnaire/submit`))
      .send({ part: 'before' })
      .expect(201);
    await asStudent(http().post(`/api/puzzles/occasions/${occasionId}/colour-check`))
      .send({ answers: (['red', 'green', 'blue'] as const).map((c) => ({ shown: c, chosen: c })) })
      .expect(201);

    const p: EfaProgressView = (
      await as(ownerToken, http().get(admin(`/courses/${courseId}/progress`))).expect(200)
    ).body;
    expect(p.gates.map((g) => g.label)).toEqual([
      'T0 questionnaire',
      'T0 puzzles',
      'T2 questionnaire',
      'T2 puzzles',
    ]);
    const st = p.students.find((x) => x.studentId === studentId)!;
    expect(st.gates.map((g) => g.done)).toEqual([true, false, false, false]);
    const o = st.occasions[0]!;
    expect(o).toEqual(expect.objectContaining({ occasion: 'T0', status: 'questionnaire_done' }));
    expect(o.form).toMatch(/^[ABC]$/);
    expect(o.log).toEqual(
      expect.objectContaining({
        fullscreenAccepted: true,
        sensingPaused: true,
        focusLostSec: 0,
        completedAt: null,
      }),
    );
    expect(o.log.device).toEqual(expect.objectContaining({ userAgent: 'jest' }));
  });

  it('reset: audited, the student does the puzzle again with the same form, flagged items_reexposed', async () => {
    const b = await asStudent(
      http().post(`/api/puzzles/occasions/${occasionId}/tasks/w1/begin`),
    ).expect(201);
    const step: PuzzleStepView = b.body.step;
    await asStudent(http().post(`/api/puzzles/runs/${b.body.runId}/steps`))
      .send({
        stepId: step.id,
        attempt: step.attempt,
        result: {
          kind: 'sequence',
          response: '0',
          shownMs: [800, 800],
          onsetMs: 1,
          firstInputMs: 2,
          submitMs: 3,
          focusLostMs: 0,
        },
      })
      .expect(201);

    await as(outsiderToken, http().post(admin(`/runs/${b.body.runId}/reset`)))
      .send({ reason: 'student felt unwell' })
      .expect(403);
    await as(ownerToken, http().post(admin(`/runs/${b.body.runId}/reset`)))
      .send({ reason: 'x' })
      .expect(400);
    await as(ownerToken, http().post(admin(`/runs/${b.body.runId}/reset`)))
      .send({ reason: 'student felt unwell' })
      .expect(201);

    const old = await prisma.efaTaskRun.findUniqueOrThrow({ where: { id: b.body.runId } });
    expect(old).toEqual(
      expect.objectContaining({
        status: 'interrupted',
        resetReason: 'student felt unwell',
        resetBy: ownerId,
      }),
    );
    const ev = await prisma.securityEvent.findFirst({
      where: { type: 'EF_TASK_RESET', userId: ownerId },
    });
    expect(ev?.metadata).toEqual(
      expect.objectContaining({
        scope: 'task',
        task: 'w1',
        studentId,
        reason: 'student felt unwell',
      }),
    );

    expect((await studentView()).task.code).toBe('w1');
    const again = await asStudent(
      http().post(`/api/puzzles/occasions/${occasionId}/tasks/w1/begin`),
    ).expect(201);
    const run2 = await prisma.efaTaskRun.findUniqueOrThrow({ where: { id: again.body.runId } });
    expect(run2).toEqual(
      expect.objectContaining({ attemptNo: 2, flags: { items_reexposed: true } }),
    );
    expect(again.body.step.payload.items).toEqual(step.payload.items); // same form

    // only the latest attempt can be reset
    await as(ownerToken, http().post(admin(`/runs/${b.body.runId}/reset`)))
      .send({ reason: 'student felt unwell' })
      .expect(409);
    const p: EfaProgressView = (
      await as(ownerToken, http().get(admin(`/courses/${courseId}/progress`))).expect(200)
    ).body;
    const w1 = p.students[0]!.occasions[0]!.runs.find((r) => r.task === 'w1')!;
    expect(w1).toEqual(expect.objectContaining({ attempt: 2, attempts: 2, status: 'in_progress' }));
  });

  it('reopen: an expired occasion can be reopened (audited); an open one cannot', async () => {
    await as(ownerToken, http().post(admin(`/occasions/${occasionId}/reopen`)))
      .send({ reason: 'was ill for two days' })
      .expect(409);
    // Expired under the old 24 h rule (no longer set by idleness).
    await prisma.efaOccasion.update({
      where: { id: occasionId },
      data: { status: 'abandoned', abandonedAt: new Date() },
    });
    await as(ownerToken, http().post(admin(`/occasions/${occasionId}/reopen`)))
      .send({ reason: 'was ill for two days' })
      .expect(201);
    const v = await studentView();
    expect(v.next).toBe('tasks');
    const o = await prisma.efaOccasion.findUniqueOrThrow({ where: { id: occasionId } });
    expect(o).toEqual(
      expect.objectContaining({
        status: 'in_progress',
        abandonedAt: null,
        flags: expect.objectContaining({ reopened: true }),
      }),
    );
    expect(
      await prisma.securityEvent.count({ where: { type: 'EF_TASK_RESET', userId: ownerId } }),
    ).toBe(2);
  });

  it('gate unlock (course-gates override) shows on the dashboard as an override with its reason', async () => {
    const p: EfaProgressView = (
      await as(ownerToken, http().get(admin(`/courses/${courseId}/progress`))).expect(200)
    ).body;
    const tests = p.gates.find((g) => g.label === 'T0 puzzles')!;
    await as(ownerToken, http().post(`/api/course-gates/${tests.id}/students/${studentId}/unlock`))
      .send({ reason: 'device problems, will redo at T1' })
      .expect(201);
    const after: EfaProgressView = (
      await as(ownerToken, http().get(admin(`/courses/${courseId}/progress`))).expect(200)
    ).body;
    expect(after.students[0]!.gates.find((g) => g.gateId === tests.id)).toEqual(
      expect.objectContaining({
        done: true,
        source: 'override',
        reason: 'device problems, will redo at T1',
      }),
    );
  });

  it('disabling an occasion whose gate students already passed keeps it, not required', async () => {
    const s: EfaSettingsView = (
      await as(ownerToken, http().get(admin(`/courses/${courseId}/settings`))).expect(200)
    ).body;
    const out: EfaSettingsView = (
      await as(ownerToken, http().put(admin(`/courses/${courseId}/settings`)))
        .send({ ...s, enabledOccasions: { T0: false, T1: false, T2: true } })
        .expect(200)
    ).body;
    const t0 = out.gates.filter((g) => g.occasion === 'T0');
    expect(t0.map((g) => [g.required, g.completions])).toEqual([
      [false, 1],
      [false, 1],
    ]);
  });

  it('rater assignments: staff only', async () => {
    await as(ownerToken, http().put(admin(`/courses/${courseId}/raters`)))
      .send({ w4: [studentId], w5: [] })
      .expect(400);
    const r = (
      await as(ownerToken, http().put(admin(`/courses/${courseId}/raters`)))
        .send({ w4: [ownerId, outsiderId], w5: [ownerId] })
        .expect(200)
    ).body;
    expect(r.assignments.w4.sort()).toEqual([ownerId, outsiderId].sort());
    expect(r.assignments.w5).toEqual([ownerId]);
    expect(r.staff.map((x: { id: string }) => x.id)).not.toContain(studentId);
    // the assigned outsider may now code, but still not manage the course
    await as(outsiderToken, http().get(admin(`/courses/${courseId}/coding/summary`))).expect(200);
    await as(outsiderToken, http().get(admin(`/courses/${courseId}/progress`))).expect(403);
  });
});
