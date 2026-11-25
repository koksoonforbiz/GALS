import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../prisma';
import { createTestApp, cleanDatabase } from '../test/setup';
import { ActivityLogService } from './activity-log.service';
import { ActivityAction } from './activity-action.enum';

/**
 * Prompt B, P5 (CAP-01, CAP-23): every INTERVENTION_TRIGGERED row says who
 * started it, and the ledger holds learner launches and every nudge
 * evaluation, including the ones that show nothing.
 */
const PASSWORD = 'Test-Passw0rd!';

describe('Intervention ledger (DB)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let userId: string;
  let sessionId: string;
  let itemId: string;
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
    const teacher = await reg('ledger-t@test.com', 'teacher');
    const me = await reg('ledger-s@test.com', 'student');
    token = me.accessToken;
    userId = me.user.id;
    courseId = (
      await prisma.course.create({
        data: { title: 'L', description: 'x', teacherId: teacher.user.id, status: 'PUBLISHED' },
      })
    ).id;
    const m = await prisma.courseModule.create({ data: { courseId, title: 'M', orderIndex: 0 } });
    itemId = (
      await prisma.moduleItem.create({
        data: { moduleId: m.id, title: 'I', type: 'PAGE', orderIndex: 0 },
      })
    ).id;
    await prisma.enrollment.create({ data: { studentId: userId, courseId, status: 'ACTIVE' } });
    sessionId = (
      await http().post('/api/activity-log/session/open').set('Authorization', `Bearer ${token}`)
    ).body.sessionId;
  }, 60_000);

  afterAll(async () => {
    await prisma.interventionLedger.deleteMany({ where: { userId } });
    await cleanDatabase(prisma);
    await app.close();
  });

  it('a learner-launched strategy carries initiator=learner and is in the ledger', async () => {
    await app.get(ActivityLogService).record({
      sessionId,
      userId,
      action: ActivityAction.INTERVENTION_TRIGGERED,
      courseId,
      interventionId: '11111111-1111-4111-8111-111111111111',
      metadata: { interventionType: 'PRACTICE_TESTING', triggerReason: 'student_initiated' },
    });
    const row = await prisma.activityLog.findFirstOrThrow({
      where: { sessionId, action: 'INTERVENTION_TRIGGERED' },
    });
    expect(row.metadata).toMatchObject({ initiator: 'learner' });
    expect(
      await prisma.interventionLedger.findFirst({ where: { sessionId, decision: 'launched' } }),
    ).toMatchObject({
      initiator: 'learner',
      interventionType: 'PRACTICE_TESTING',
      reason: 'student_initiated',
    });
  });

  it('a nudge evaluation that shows nothing is a NO_ACTION ledger row', async () => {
    await http()
      .post('/api/nudges/evaluate')
      .set('Authorization', `Bearer ${token}`)
      .send({ moduleItemId: itemId, sessionId })
      .expect(201);
    expect(
      await prisma.interventionLedger.findFirst({ where: { sessionId, decision: 'no_action' } }),
    ).toMatchObject({ initiator: 'system', reason: 'no_policy', moduleItemId: itemId });
  });
});
