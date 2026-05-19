import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { createTestApp, cleanDatabase } from '../test/setup';

describe('Auth Integration', () => {
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

  describe('POST /api/auth/register', () => {
    it('should register a new user and return accessToken + user', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'password123',
          name: 'Test User',
          role: 'student',
        })
        .expect(201);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body.user).toMatchObject({
        email: 'test@example.com',
        name: 'Test User',
        role: 'student',
      });
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });

    it('should reject duplicate email with 409', async () => {
      const payload = {
        email: 'dup@example.com',
        password: 'password123',
        name: 'User One',
        role: 'student',
      };
      await request(app.getHttpServer()).post('/api/auth/register').send(payload).expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(payload)
        .expect(409);

      expect(res.body.statusCode).toBe(409);
    });

    it('should reject invalid payload with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email: 'bad' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with correct credentials', async () => {
      await request(app.getHttpServer()).post('/api/auth/register').send({
        email: 'login@example.com',
        password: 'password123',
        name: 'Login User',
        role: 'student',
      });

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'login@example.com', password: 'password123' })
        .expect(201);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body.user.email).toBe('login@example.com');
    });

    it('should reject wrong password with 401', async () => {
      await request(app.getHttpServer()).post('/api/auth/register').send({
        email: 'wrong@example.com',
        password: 'password123',
        name: 'User',
        role: 'student',
      });

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'wrong@example.com', password: 'wrongpass' })
        .expect(401);
    });

    it('should reject non-existent email with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'password123' })
        .expect(401);
    });
  });
});
