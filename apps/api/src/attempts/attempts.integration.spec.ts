import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { createTestApp, cleanDatabase } from '../test/setup';

describe('Attempts Integration — submit triggers event', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  }, 30000);

  afterEach(async () => {
    await cleanDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('submitting an attempt creates a grade_submission event', async () => {
    // Setup: teacher, course, topic, question, student, enrollment
    const teacherRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'teacher@test.com',
        password: 'password123',
        name: 'Teacher',
        role: 'teacher',
      });
    const teacherId = teacherRes.body.user.id;

    const studentRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'student@test.com',
        password: 'password123',
        name: 'Student',
        role: 'student',
      });
    const studentToken = studentRes.body.accessToken;
    const studentId = studentRes.body.user.id;

    const course = await prisma.course.create({
      data: { title: 'Course', description: 'desc', teacherId },
    });
    await prisma.enrollment.create({
      data: { studentId, courseId: course.id },
    });
    const topic = await prisma.topic.create({
      data: { courseId: course.id, title: 'Topic', description: 'desc', orderIndex: 0 },
    });
    const question = await prisma.question.create({
      data: {
        topicId: topic.id,
        prompt: 'Explain photosynthesis.',
        type: 'text',
        maxScore: 10,
        rubricJson: { answer_key: ['photosynthesis'] },
      },
    });

    // Create attempt
    const attemptRes = await request(app.getHttpServer())
      .post('/api/attempts')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ questionId: question.id })
      .expect(201);

    const attemptId = attemptRes.body.id;

    // Submit attempt
    await request(app.getHttpServer())
      .post(`/api/attempts/${attemptId}/submit`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ textResponse: 'My answer about photosynthesis' })
      .expect(201);

    // Verify event was created in event_queue
    const events = await prisma.eventQueue.findMany({
      where: { topic: 'grade_submission' },
    });
    expect(events).toHaveLength(1);
    expect((events[0]!.payload as Record<string, unknown>).attemptId).toBe(attemptId);
  });

  it('should not allow submitting someone else\'s attempt', async () => {
    // Setup two students
    const teacherRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'teacher2@test.com',
        password: 'password123',
        name: 'Teacher',
        role: 'teacher',
      });
    const teacherId = teacherRes.body.user.id;

    const student1Res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'student1@test.com',
        password: 'password123',
        name: 'Student1',
        role: 'student',
      });
    const student1Token = student1Res.body.accessToken;
    const student1Id = student1Res.body.user.id;

    const student2Res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'student2@test.com',
        password: 'password123',
        name: 'Student2',
        role: 'student',
      });
    const student2Token = student2Res.body.accessToken;
    const student2Id = student2Res.body.user.id;

    const course = await prisma.course.create({
      data: { title: 'Course', description: 'desc', teacherId },
    });
    await prisma.enrollment.createMany({
      data: [
        { studentId: student1Id, courseId: course.id },
        { studentId: student2Id, courseId: course.id },
      ],
    });
    const topic = await prisma.topic.create({
      data: { courseId: course.id, title: 'Topic', description: 'desc', orderIndex: 0 },
    });
    const question = await prisma.question.create({
      data: { topicId: topic.id, prompt: 'Q?', type: 'text', maxScore: 10 },
    });

    // Student 1 creates an attempt
    const attemptRes = await request(app.getHttpServer())
      .post('/api/attempts')
      .set('Authorization', `Bearer ${student1Token}`)
      .send({ questionId: question.id })
      .expect(201);

    // Student 2 tries to submit Student 1's attempt
    await request(app.getHttpServer())
      .post(`/api/attempts/${attemptRes.body.id}/submit`)
      .set('Authorization', `Bearer ${student2Token}`)
      .send({ textResponse: 'Hacked answer' })
      .expect(403);
  });
});
