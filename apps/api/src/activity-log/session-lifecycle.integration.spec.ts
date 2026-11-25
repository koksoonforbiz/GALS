import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma';
import { createTestApp, cleanDatabase } from '../test/setup';
import { SessionService } from './session.service';

/**
 * Prompt B, P2: a return after T2 starts a new, linked session; every close
 * is parsed and the run recorded; late events for a closed session are
 * stored and trigger a re-parse.
 */
const PASSWORD = 'Test-Passw0rd!';

describe('Session lifecycle (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let userId: string;

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const open = async (body?: object) =>
    (
      await auth(http().post('/api/activity-log/session/open'))
        .send(body ?? {})
        .expect(201)
    ).body as {
      sessionId: string;
      idleTimeoutMs: number;
    };
  const waitFor = async <T>(fn: () => Promise<T | null | undefined>, ms = 10_000): Promise<T> => {
    const until = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > until) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanDatabase(prisma);
    const me = (
      await http().post('/api/auth/register').send({
        email: 'lifecycle@test.com',
        password: PASSWORD,
        termsAccepted: true,
        name: 'L',
        role: 'student',
      })
    ).body;
    token = me.accessToken;
    userId = me.user.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.sessionParseRun.deleteMany({});
    await cleanDatabase(prisma);
    await app.close();
  });

  it('a return after T2 closes the old session at its last input and links the new one', async () => {
    const first = await open();
    expect(first.idleTimeoutMs).toBe(30 * 60_000);
    const lastInput = new Date(Date.now() - 45 * 60_000);
    await prisma.activityLog.create({
      data: {
        sessionId: first.sessionId,
        userId,
        action: 'SLIDE_ENTERED',
        occurredAt: lastInput,
      },
    });

    const second = await open({ previousSessionId: first.sessionId });
    const old = await prisma.studentSession.findUniqueOrThrow({ where: { id: first.sessionId } });
    expect(old.endedAt?.getTime()).toBe(lastInput.getTime());
    expect(old.closeReason).toBe('idle_timeout');
    const next = await prisma.studentSession.findUniqueOrThrow({ where: { id: second.sessionId } });
    expect(next).toMatchObject({
      previousSessionId: first.sessionId,
      paramsVersion: 'session-v1',
    });
    expect(next.episodeKey).toMatch(new RegExp(`^${userId}\\|-\\|\\d{4}-\\d{2}-\\d{2}$`));

    // The close was parsed, and the run recorded.
    const run = await waitFor(() =>
      prisma.sessionParseRun.findFirst({
        where: { sessionId: first.sessionId, trigger: 'close', status: 'ok' },
      }),
    );
    expect(run.finishedAt).toBeInstanceOf(Date);
  });

  it('late events for a closed session are stored and re-parsed', async () => {
    const { sessionId } = await open();
    await auth(http().post('/api/activity-log/session/close'))
      .set('x-session-id', sessionId)
      .expect(201);
    const sessions = app.get(SessionService);
    const spy = jest.spyOn(sessions, 'scheduleReparse').mockImplementation((id) => {
      // no 5-minute wait in the test
      (sessions as unknown as { events: { emit: (e: string, p: object) => void } }).events.emit(
        'session.reparse',
        { sessionId: id, trigger: 'late_events' },
      );
    });
    await auth(http().post('/api/activity-log/batch'))
      .set('x-session-id', sessionId)
      .send({
        sessionId,
        events: [
          {
            action: 'SLIDE_ENTERED',
            occurredAt: new Date().toISOString(),
            clientEventId: randomUUID(),
          },
        ],
      })
      .expect(201);
    expect(spy).toHaveBeenCalledWith(sessionId);
    await waitFor(() =>
      prisma.sessionParseRun.findFirst({
        where: { sessionId, trigger: 'late_events', status: 'ok' },
      }),
    );
    expect(await prisma.activityLog.count({ where: { sessionId, action: 'SLIDE_ENTERED' } })).toBe(
      1,
    );
    spy.mockRestore();
  });
});
