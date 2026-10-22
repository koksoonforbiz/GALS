/**
 * Course gates through the real HTTP stack: every student content route
 * (choke points A–F of IMPLEMENTATION_PLAN §0) refuses a module behind an
 * incomplete gate with 403 MODULE_LOCKED; staff are unaffected; the staff
 * override opens it, is audited, and is not reachable on the public door.
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { createTestApp, cleanDatabase } from '../test/setup';

const PASSWORD = 'Test-Passw0rd!';

const lesson = {
  schemaVersion: 1,
  source: { file: 'test.html', sha256: 'x', importedAt: '2026-10-22T00:00:00Z' },
  session: { id: 1, title: 'S1', covers: '', bigq: '', core: [], appendix: false },
  slides: [
    { key: 's1-1', t: 'theory', contentHash: 'h1', heading: 'Intro', html: '<p>Hello</p>' },
    { key: 's1-2', t: 'exercise', contentHash: 'h2', heading: 'Lab', html: '<p>Try</p>' },
  ],
};

describe('Course gates (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let teacherToken: string;
  let studentToken: string;
  let otherStudentToken: string;
  let teacherId: string;
  let studentId: string;
  let courseId: string;
  let m1: string;
  let m2: string;
  let lesson1: string;
  let pdf2: string;
  let gateQ: string;
  let gateT: string;
  let sessionId: string;

  const http = () => request(app.getHttpServer());
  const as = (token: string) => (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanDatabase(prisma);

    const reg = async (email: string, role: 'teacher' | 'student') => {
      const r = await http()
        .post('/api/auth/register')
        .send({ email, password: PASSWORD, termsAccepted: true, name: email, role });
      return { token: r.body.accessToken as string, id: r.body.user.id as string };
    };
    ({ token: teacherToken, id: teacherId } = await reg('gate-teacher@test.com', 'teacher'));
    ({ token: studentToken, id: studentId } = await reg('gate-student@test.com', 'student'));
    ({ token: otherStudentToken } = await reg('gate-outsider@test.com', 'student'));

    courseId = (
      await prisma.course.create({
        data: { title: 'Gated course', description: 'gate test', teacherId, status: 'PUBLISHED' },
      })
    ).id;
    m1 = (
      await prisma.courseModule.create({ data: { courseId, title: 'Session 1', orderIndex: 0 } })
    ).id;
    m2 = (
      await prisma.courseModule.create({ data: { courseId, title: 'Session 2', orderIndex: 1 } })
    ).id;
    lesson1 = (
      await prisma.moduleItem.create({
        data: {
          moduleId: m1,
          type: 'INTERACTIVE_LESSON',
          title: 'S1',
          orderIndex: 0,
          lessonJson: lesson,
        },
      })
    ).id;
    pdf2 = (
      await prisma.moduleItem.create({
        data: {
          moduleId: m2,
          type: 'PDF',
          title: 'Reading',
          orderIndex: 0,
          pdfBlobKey: 'k/reading.pdf',
          pdfFilename: 'reading.pdf',
        },
      })
    ).id;
    await prisma.enrollment.create({ data: { studentId, courseId, status: 'ACTIVE' } });

    gateQ = (
      await prisma.courseGate.create({
        data: {
          courseId,
          kind: 'EF_QUESTIONNAIRE',
          occasion: 'T0',
          position: 'BEFORE_MODULE',
          moduleId: m1,
          sequence: 10,
        },
      })
    ).id;
    gateT = (
      await prisma.courseGate.create({
        data: {
          courseId,
          kind: 'EF_TESTS',
          occasion: 'T0',
          position: 'BEFORE_MODULE',
          moduleId: m1,
          sequence: 20,
        },
      })
    ).id;

    const open = await as(studentToken)(http().post('/api/activity-log/session/open')).expect(201);
    sessionId = open.body.sessionId;
    await as(studentToken)(http().patch('/api/activity-log/session/course'))
      .set('x-session-id', sessionId)
      .send({ courseId })
      .expect(200);
  }, 60_000);

  afterAll(async () => {
    await prisma.courseGate.deleteMany({ where: { courseId } });
    await cleanDatabase(prisma);
    await app.close();
  });

  describe('while T0 is incomplete', () => {
    it('A: course detail marks every module locked, strips item content, lists neutral steps', async () => {
      const r = await as(studentToken)(http().get(`/api/courses/${courseId}`)).expect(200);
      expect(r.body.modules.map((m: { locked: boolean }) => m.locked)).toEqual([true, true]);
      const pdf = r.body.modules[1].items[0];
      expect(pdf.title).toBe('Reading');
      expect(pdf.pdfBlobKey).toBeNull();
      expect(r.body.gateSteps).toEqual([
        expect.objectContaining({
          step: 'questionnaire',
          label: 'About you and how you feel today',
          next: true,
          done: false,
        }),
        expect.objectContaining({
          step: 'puzzles',
          label: 'Attention and memory puzzles',
          next: false,
          done: false,
        }),
      ]);
      // Blinding: no gate kind or construct name in the student payload.
      expect(JSON.stringify(r.body.gateSteps)).not.toMatch(/EF_|executive|kind/i);
    });

    it('A: a student who is not enrolled gets 403 (was: full course for anyone)', async () => {
      await as(otherStudentToken)(http().get(`/api/courses/${courseId}`)).expect(403);
    });

    it('C: lesson content → 403 MODULE_LOCKED', async () => {
      const r = await as(studentToken)(
        http().get(`/api/interactive-lessons/items/${lesson1}`),
      ).expect(403);
      expect(r.body.code).toBe('MODULE_LOCKED');
    });

    it('B: PDF download URL → 403 MODULE_LOCKED; not enrolled → 403', async () => {
      const r = await as(studentToken)(http().get(`/api/items/${pdf2}/download-url`)).expect(403);
      expect(r.body.code).toBe('MODULE_LOCKED');
      await as(otherStudentToken)(http().get(`/api/items/${pdf2}/download-url`)).expect(403);
    });

    it('D: Prompt Lab → 403 MODULE_LOCKED', async () => {
      const r = await as(studentToken)(
        http().get(`/api/prompt-lab/me?moduleItemId=${lesson1}&slideKey=s1-2`),
      ).expect(403);
      expect(r.body.code).toBe('MODULE_LOCKED');
    });

    it('E: Learning Assistant chat grounded on a locked item → 403 MODULE_LOCKED; outsider → 403', async () => {
      const body = {
        message: 'what is this about?',
        courseId,
        contentId: lesson1,
        conversationHistory: [],
      };
      const r = await as(studentToken)(http().post('/api/learning-interventions/chat'))
        .set('x-session-id', sessionId)
        .send(body)
        .expect(403);
      expect(r.body.code).toBe('MODULE_LOCKED');
      await as(otherStudentToken)(http().post('/api/learning-interventions/chat'))
        .send(body)
        .expect(403);
    });

    it('F: nudge evaluation → 403 MODULE_LOCKED', async () => {
      const r = await as(studentToken)(http().post('/api/nudges/evaluate'))
        .send({ moduleItemId: lesson1, sessionId, slideKey: 's1-1' })
        .expect(403);
      expect(r.body.code).toBe('MODULE_LOCKED');
    });

    it('staff are never locked out', async () => {
      await as(teacherToken)(http().get(`/api/interactive-lessons/items/${lesson1}`)).expect(200);
      const r = await as(teacherToken)(http().get(`/api/courses/${courseId}`)).expect(200);
      expect(r.body.modules[1].items[0].pdfBlobKey).toBe('k/reading.pdf');
    });
  });

  describe('staff override', () => {
    it('requires a reason', async () => {
      await as(teacherToken)(http().post(`/api/course-gates/${gateQ}/students/${studentId}/unlock`))
        .send({ reason: 'no' })
        .expect(400);
    });

    it('is refused for students and does not exist on the public door', async () => {
      await as(studentToken)(http().post(`/api/course-gates/${gateQ}/students/${studentId}/unlock`))
        .send({ reason: 'let me in please' })
        .expect(403);
      await as(teacherToken)(http().get(`/api/course-gates/courses/${courseId}`))
        .set('x-gals-door', 'public')
        .expect(404);
    });

    it('opening only the first gate keeps the course locked (strict sequence)', async () => {
      await as(teacherToken)(http().post(`/api/course-gates/${gateQ}/students/${studentId}/unlock`))
        .send({ reason: 'completed on paper with the facilitator' })
        .expect(201);
      const r = await as(studentToken)(
        http().get(`/api/interactive-lessons/items/${lesson1}`),
      ).expect(403);
      expect(r.body.code).toBe('MODULE_LOCKED');
    });

    it('opening both gates unlocks content, and is audited', async () => {
      await as(teacherToken)(http().post(`/api/course-gates/${gateT}/students/${studentId}/unlock`))
        .send({ reason: 'completed on paper with the facilitator' })
        .expect(201);
      await as(studentToken)(http().get(`/api/interactive-lessons/items/${lesson1}`)).expect(200);
      const r = await as(studentToken)(http().get(`/api/courses/${courseId}`)).expect(200);
      expect(r.body.modules.map((m: { locked: boolean }) => m.locked)).toEqual([false, false]);
      expect(r.body.gateSteps.every((s: { done: boolean }) => s.done)).toBe(true);

      // security_events is fire-and-forget: give it a moment.
      await new Promise((res) => setTimeout(res, 300));
      const audits = await prisma.securityEvent.findMany({
        where: { type: 'GATE_OVERRIDE', userId: teacherId },
      });
      expect(audits).toHaveLength(2);
      expect(audits[0]!.metadata).toEqual(
        expect.objectContaining({ studentId, reason: expect.any(String) }),
      );
      const logged = await prisma.activityLog.count({
        where: { userId: studentId, action: 'GATE_UNLOCKED' },
      });
      expect(logged).toBe(2);
      const completions = await prisma.studentGateCompletion.findMany({ where: { studentId } });
      expect(completions.every((c) => c.source === 'override' && c.overrideBy === teacherId)).toBe(
        true,
      );
    });

    it('a repeated unlock is idempotent and not re-audited', async () => {
      const r = await as(teacherToken)(
        http().post(`/api/course-gates/${gateT}/students/${studentId}/unlock`),
      )
        .send({ reason: 'again by mistake' })
        .expect(201);
      expect(r.body.alreadyComplete).toBe(true);
    });
  });
});
