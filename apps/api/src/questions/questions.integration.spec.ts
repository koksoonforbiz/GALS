import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { createTestApp, cleanDatabase } from '../test/setup';

describe('Questions Integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let teacherToken: string;
  let topicId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  }, 30000);

  beforeEach(async () => {
    await cleanDatabase(prisma);

    // Register a teacher
    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'teacher@test.com',
        password: 'password123',
        name: 'Teacher',
        role: 'teacher',
      });
    teacherToken = registerRes.body.accessToken;
    const teacherId = registerRes.body.user.id;

    // Create course and topic via Prisma
    const course = await prisma.course.create({
      data: { title: 'Test Course', description: 'desc', teacherId },
    });
    const topic = await prisma.topic.create({
      data: { courseId: course.id, title: 'Test Topic', description: 'desc', orderIndex: 0 },
    });
    topicId = topic.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('teacher should create a question version', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/questions')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        topicId,
        prompt: 'What is 2+2?',
        type: 'text',
        maxScore: 5,
      })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.prompt).toBe('What is 2+2?');
    expect(res.body.type).toBe('text');
    expect(res.body.maxScore).toBe(5);
    expect(res.body.version).toBe(1);
  });

  it('student should not be able to create a question', async () => {
    const studentRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'student@test.com',
        password: 'password123',
        name: 'Student',
        role: 'student',
      });

    await request(app.getHttpServer())
      .post('/api/questions')
      .set('Authorization', `Bearer ${studentRes.body.accessToken}`)
      .send({
        topicId,
        prompt: 'What is 2+2?',
        type: 'text',
        maxScore: 5,
      })
      .expect(403);
  });
});
