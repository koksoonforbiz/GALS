import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../prisma';
import { createTestApp, cleanDatabase } from '../test/setup';

/** Announcements: teachers post to own courses, students see and acknowledge them. */
const PASSWORD = 'Test-Passw0rd!';

describe('Announcements (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let teacher: string;
  let student: string;
  let outsider: string;
  let courseId: string;
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
    const t = await reg('ann-t@test.com', 'teacher');
    const s = await reg('ann-s@test.com', 'student');
    const o = await reg('ann-o@test.com', 'student');
    [teacher, student, outsider] = [t.accessToken, s.accessToken, o.accessToken];
    courseId = (
      await prisma.course.create({
        data: { title: 'A', description: 'x', teacherId: t.user.id, status: 'PUBLISHED' },
      })
    ).id;
    await prisma.enrollment.create({ data: { studentId: s.user.id, courseId, status: 'ACTIVE' } });
  }, 60_000);

  afterAll(async () => {
    await prisma.announcement.deleteMany({});
    await cleanDatabase(prisma);
    await app.close();
  });

  it('a teacher posts to a course; enrolled students see it and acknowledge it', async () => {
    const as = (t: string) => (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
    await as(teacher)(http().post('/api/announcements'))
      .send({ kind: 'info', severity: 'info', title: 'Everyone', body: 'x' })
      .expect(403); // only an admin posts to every student
    const created = await as(teacher)(http().post('/api/announcements'))
      .send({
        kind: 'security_incident',
        severity: 'info',
        title: 'Password reset needed',
        body: 'Please change your password.',
        courseId,
      })
      .expect(201);
    expect(created.body).toMatchObject({ severity: 'critical', requireAck: true });

    const seen = await as(student)(http().get('/api/announcements/active')).expect(200);
    expect(seen.body).toEqual([
      expect.objectContaining({ title: 'Password reset needed', acknowledgedAt: null }),
    ]);
    expect((await as(outsider)(http().get('/api/announcements/active')).expect(200)).body).toEqual(
      [],
    );
    await as(student)(http().post(`/api/announcements/${created.body.id}/ack`)).expect(201);
    await as(student)(http().post(`/api/announcements/${created.body.id}/ack`)).expect(201);
    const after = await as(student)(http().get('/api/announcements/active')).expect(200);
    expect(after.body[0].acknowledgedAt).not.toBeNull();
    const list = await as(teacher)(http().get('/api/announcements')).expect(200);
    expect(list.body[0]).toMatchObject({ acks: 1 });

    await as(teacher)(http().delete(`/api/announcements/${created.body.id}`)).expect(200);
    expect((await as(student)(http().get('/api/announcements/active')).expect(200)).body).toEqual(
      [],
    );
  });
});
