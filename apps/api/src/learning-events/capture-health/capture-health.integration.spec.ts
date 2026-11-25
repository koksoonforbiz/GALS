import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../prisma';
import { createTestApp, cleanDatabase } from '../../test/setup';

/** Capture health (Prompt B, P6): what a session's data is missing, for its teacher. */
const PASSWORD = 'Test-Passw0rd!';

describe('Capture health (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let teacher: string;
  let other: string;
  let courseId: string;
  let sessionId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanDatabase(prisma);
    const reg = async (email: string, role: string) =>
      (
        await http()
          .post('/api/auth/register')
          .send({ email, password: PASSWORD, termsAccepted: true, name: email, role })
      ).body;
    const t = await reg('ch-t@test.com', 'teacher');
    const o = await reg('ch-o@test.com', 'teacher');
    const s = await reg('ch-s@test.com', 'student');
    [teacher, other] = [t.accessToken, o.accessToken];
    courseId = (
      await prisma.course.create({
        data: { title: 'C', description: 'x', teacherId: t.user.id, status: 'PUBLISHED' },
      })
    ).id;
    sessionId = (
      await prisma.studentSession.create({
        data: { userId: s.user.id, courseId, endedAt: new Date(), closeReason: 'idle_timeout' },
      })
    ).id;
    await prisma.activityLog.createMany({
      data: [
        { sessionId, userId: s.user.id, action: 'PAGE_LEFT', metadata: { path: '/x' } },
        { sessionId, userId: s.user.id, action: 'PAGE_LEFT', metadata: {} }, // missing path
      ],
    });
    await prisma.captureQuality.create({
      data: { sessionId, stream: 'click_logs', kind: 'gap', fromSeq: 2, toSeq: 4, count: 3 },
    });
    await prisma.ingestIssue.create({
      data: {
        sessionId,
        stream: 'activity_log',
        kind: 'rejected',
        reason: 'action:invalid_enum_value',
        eventCount: 2,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.captureQuality.deleteMany({ where: { sessionId } });
    await prisma.ingestIssue.deleteMany({ where: { sessionId } });
    await cleanDatabase(prisma);
    await app.close();
  });

  it('reports schema problems, gaps, refusals and parse state', async () => {
    const r = await http()
      .get(`/api/learning-events/sessions/${sessionId}/capture-health`)
      .set('Authorization', `Bearer ${teacher}`)
      .expect(200);
    expect(r.body.session).toMatchObject({ closeReason: 'idle_timeout' });
    expect(r.body.actions).toEqual([
      expect.objectContaining({ action: 'PAGE_LEFT', count: 2, invalid: 1, invalidRate: 0.5 }),
    ]);
    expect(r.body.quality).toMatchObject({ gaps: 1, missingEvents: 3 });
    expect(r.body.ingest).toEqual([expect.objectContaining({ kind: 'rejected', events: 2 })]);
    expect(r.body.parse.parsed).toBe(false);
    expect(r.body.score.ok).toBe(false);
    expect(r.body.score.problems).toEqual(
      expect.arrayContaining([
        '3 event(s) missing (sequence gaps)',
        '2 event(s) refused, dropped or overflowed',
        'closed but never parsed',
      ]),
    );

    const course = await http()
      .get(`/api/learning-events/courses/${courseId}/capture-health`)
      .set('Authorization', `Bearer ${teacher}`)
      .expect(200);
    expect(course.body.summary).toMatchObject({ withGaps: 1, missingEvents: 3, refused: 2 });
    const csv = await http()
      .get(`/api/learning-events/courses/${courseId}/capture-health.csv`)
      .set('Authorization', `Bearer ${teacher}`)
      .expect(200);
    expect(csv.text.split('\n')[0]).toContain('sessionId');

    await http()
      .get(`/api/learning-events/sessions/${sessionId}/capture-health`)
      .set('Authorization', `Bearer ${other}`)
      .expect(403);
  });
});
