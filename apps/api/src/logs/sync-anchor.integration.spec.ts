import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { createTestApp, cleanDatabase } from '../test/setup';
import { LogsService } from './logs.service';

/**
 * The sync anchor is the replay's t = 0 and the base of annotation offsets.
 * The client posts one on every page load; only the earliest may stand.
 */
describe('LogsService.upsertSyncAnchor — keeps the earliest anchor', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let logs: LogsService;
  let userId: string;
  let sessionId: string;

  const post = (wallClockMs: number) =>
    logs.upsertSyncAnchor({
      sessionId,
      userId,
      wallClockMs,
      monotonicMs: 100,
      timezone: 'UTC',
      userAgent: 'jest',
    });
  const stored = async () =>
    Number(
      (await prisma.session_sync_anchors.findUniqueOrThrow({ where: { sessionId } })).wallClockMs,
    );

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    logs = app.get(LogsService);
    await cleanDatabase(prisma);
    const user = await prisma.user.create({
      data: { email: 'anchor@test.com', name: 'Anchor', role: 'student', passwordHash: 'x' },
    });
    userId = user.id;
  }, 30_000);

  beforeEach(async () => {
    sessionId = (await prisma.studentSession.create({ data: { userId } })).id;
  });

  afterAll(async () => {
    await prisma.session_sync_anchors.deleteMany({ where: { userId } });
    await cleanDatabase(prisma);
    await app.close();
  });

  it('creates the anchor on first load', async () => {
    await post(1_000_000);
    expect(await stored()).toBe(1_000_000);
  });

  it('a later page load (reload) does not move t = 0', async () => {
    await post(1_000_000);
    await post(1_600_000);
    expect(await stored()).toBe(1_000_000);
  });

  it('concurrent first-load posts do not fail on the unique session', async () => {
    const results = await Promise.allSettled([post(1_200_000), post(1_000_000), post(1_100_000)]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    expect(await stored()).toBe(1_000_000);
  });

  it('an earlier anchor that arrives late still wins', async () => {
    await post(1_600_000);
    await post(1_000_000);
    expect(await stored()).toBe(1_000_000);
  });
});
