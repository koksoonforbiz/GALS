import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../prisma';
import { createTestApp, cleanDatabase } from '../test/setup';

/** Learner prompt switches (Prompt B, P5d): on by default, teacher switches per course. */
const PASSWORD = 'Test-Passw0rd!';

describe('Course flags (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let teacher: string;
  let student: string;
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
    const t = await reg('flags-t@test.com', 'teacher');
    const s = await reg('flags-s@test.com', 'student');
    teacher = t.accessToken;
    student = s.accessToken;
    courseId = (
      await prisma.course.create({
        data: { title: 'F', description: 'x', teacherId: t.user.id, status: 'PUBLISHED' },
      })
    ).id;
    await prisma.enrollment.create({ data: { studentId: s.user.id, courseId, status: 'ACTIVE' } });
  }, 60_000);

  afterAll(async () => {
    await prisma.courseFeatureFlag.deleteMany({ where: { courseId } });
    await cleanDatabase(prisma);
    await app.close();
  });

  it('all prompts are on by default; a teacher switch is kept with its history', async () => {
    const r = await http()
      .get(`/api/course-flags/${courseId}`)
      .set('Authorization', `Bearer ${student}`)
      .expect(200);
    expect(Object.values(r.body.flags).every(Boolean)).toBe(true);
    await http()
      .patch(`/api/course-flags/${courseId}`)
      .set('Authorization', `Bearer ${student}`)
      .send({ flag: 'goal_card', enabled: false })
      .expect(403);
    await http()
      .patch(`/api/course-flags/${courseId}`)
      .set('Authorization', `Bearer ${teacher}`)
      .send({ flag: 'goal_card', enabled: false })
      .expect(200);
    const after = await http()
      .get(`/api/course-flags/${courseId}`)
      .set('Authorization', `Bearer ${student}`)
      .expect(200);
    expect(after.body.flags).toMatchObject({ goal_card: false, progress_check: true });
    const h = await http()
      .get(`/api/course-flags/${courseId}/history`)
      .set('Authorization', `Bearer ${teacher}`)
      .expect(200);
    expect(h.body).toHaveLength(1);
  });
});
