import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { createTestApp, cleanDatabase } from '../test/setup';
import { SessionTimeoutSweeper, SESSION_IDLE_TIMEOUT_MS } from './session-timeout.sweeper';

/**
 * Sessions the student never logged out of are closed after T2 (30 min)
 * without learner input (Prompt B, P2): activity events, clicks, keystrokes,
 * scrolling or cursor movement. Periodic replay snapshots of an untouched
 * tab don't count. The close is dated at the last input, with reason
 * idle_timeout, or tab_closed when the last event was PAGE_LEFT. Active and
 * already-closed sessions are left alone.
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
    await prisma.click_logs.deleteMany({ where: { userId } });
    await cleanDatabase(prisma);
    await app.close();
  });

  const session = (startedAt: Date, endedAt?: Date) =>
    prisma.studentSession.create({ data: { userId, startedAt, endedAt } });
  const event = (
    sessionId: string,
    occurredAt: Date,
    action: 'SLIDE_ENTERED' | 'PAGE_LEFT' = 'SLIDE_ENTERED',
  ) => prisma.activityLog.create({ data: { sessionId, userId, action, occurredAt } });

  it('closes sessions with no learner input for T2, with the right reason', async () => {
    expect(SESSION_IDLE_TIMEOUT_MS).toBe(30 * 60_000);
    const idle = await session(ago(5 * H));
    await event(idle.id, ago(3 * H));
    const active = await session(ago(5 * H));
    await event(active.id, ago(10 * 60_000));
    const clicking = await session(ago(5 * H)); // old events, recent clicks
    await event(clicking.id, ago(2 * H));
    await prisma.click_logs.create({
      data: {
        sessionId: clicking.id,
        userId,
        x: 1,
        y: 1,
        pageUrl: '/p',
        elementSelector: 'button',
        timestamp: BigInt(ago(5 * 60_000).getTime()),
      },
    });
    const watching = await session(ago(5 * H)); // only replay snapshots recently: idle
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
    const tabClosed = await session(ago(5 * H));
    await event(tabClosed.id, ago(2 * H + 60_000));
    await event(tabClosed.id, ago(2 * H), 'PAGE_LEFT');
    const fresh = await session(ago(SESSION_IDLE_TIMEOUT_MS / 2)); // no events yet
    const closed = await session(ago(6 * H), ago(5 * H));

    expect(await sweeper.sweep(now)).toBe(3);

    const got = await prisma.studentSession.findUniqueOrThrow({ where: { id: idle.id } });
    expect(got.endedAt?.getTime()).toBe(ago(3 * H).getTime());
    expect(got.durationSecs).toBe(2 * 3600);
    expect(got.closeReason).toBe('idle_timeout');
    const end = await prisma.activityLog.findFirstOrThrow({
      where: { sessionId: idle.id, action: 'SESSION_END' },
    });
    expect(end.metadata).toEqual(expect.objectContaining({ reason: 'idle_timeout' }));

    const w = await prisma.studentSession.findUniqueOrThrow({ where: { id: watching.id } });
    expect(w.closeReason).toBe('idle_timeout');
    expect(w.endedAt?.getTime()).toBe(ago(5 * H).getTime()); // never had input
    const t = await prisma.studentSession.findUniqueOrThrow({ where: { id: tabClosed.id } });
    expect(t.closeReason).toBe('tab_closed');
    expect(t.endedAt?.getTime()).toBe(ago(2 * H).getTime());

    for (const s of [active, clicking, fresh]) {
      const row = await prisma.studentSession.findUniqueOrThrow({ where: { id: s.id } });
      expect(row.endedAt).toBeNull();
    }
    const keep = await prisma.studentSession.findUniqueOrThrow({ where: { id: closed.id } });
    expect(keep.endedAt?.getTime()).toBe(ago(5 * H).getTime());
    expect(await sweeper.sweep(now)).toBe(0);
  });
});
