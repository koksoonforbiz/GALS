import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { createTestApp, cleanDatabase } from '../test/setup';
import { SessionTimeoutSweeper, SESSION_IDLE_TIMEOUT_MS } from './session-timeout.sweeper';

/**
 * Sessions the student never logged out of are closed after 2 h without
 * activity (events or replay snapshots), dated at the last activity, with
 * SESSION_END { reason: 'timeout' }; active and already-closed ones are left alone.
 */
describe('SessionTimeoutSweeper', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sweeper: SessionTimeoutSweeper;
  let userId: string;
  const H = 3600_000;
  const now = new Date();
  const ago = (ms: number) => new Date(now.getTime() - ms);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    sweeper = app.get(SessionTimeoutSweeper);
    await cleanDatabase(prisma);
    userId = (
      await prisma.user.create({
        data: { email: 'sweep@test.com', name: 'Sweep', role: 'student', passwordHash: 'x' },
      })
    ).id;
  }, 30_000);

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  const session = (startedAt: Date, endedAt?: Date) =>
    prisma.studentSession.create({ data: { userId, startedAt, endedAt } });
  const event = (sessionId: string, occurredAt: Date) =>
    prisma.activityLog.create({
      data: { sessionId, userId, action: 'SLIDE_ENTERED', occurredAt },
    });

  it('closes only sessions idle for longer than the timeout', async () => {
    const idle = await session(ago(5 * H));
    await event(idle.id, ago(3 * H));
    const active = await session(ago(5 * H));
    await event(active.id, ago(10 * 60_000));
    const watching = await session(ago(5 * H)); // only replay snapshots recently
    await prisma.sessionReplaySnapshot.create({
      data: {
        sessionId: watching.id,
        userId,
        pageUrl: '/student',
        width: 100,
        height: 100,
        capturedAt: BigInt(now.getTime()),
        trigger: 'periodic',
        createdAt: ago(60_000),
      },
    });
    const fresh = await session(ago(SESSION_IDLE_TIMEOUT_MS / 2)); // no events yet
    const closed = await session(ago(6 * H), ago(5 * H));

    expect(await sweeper.sweep(now)).toBe(1);

    const got = await prisma.studentSession.findUniqueOrThrow({ where: { id: idle.id } });
    expect(got.endedAt?.getTime()).toBe(ago(3 * H).getTime());
    expect(got.durationSecs).toBe(2 * 3600);
    const end = await prisma.activityLog.findFirstOrThrow({
      where: { sessionId: idle.id, action: 'SESSION_END' },
    });
    expect(end.metadata).toEqual(expect.objectContaining({ reason: 'timeout' }));

    for (const s of [active, watching, fresh]) {
      const row = await prisma.studentSession.findUniqueOrThrow({ where: { id: s.id } });
      expect(row.endedAt).toBeNull();
    }
    const keep = await prisma.studentSession.findUniqueOrThrow({ where: { id: closed.id } });
    expect(keep.endedAt?.getTime()).toBe(ago(5 * H).getTime());
    expect(await sweeper.sweep(now)).toBe(0);
  });
});
