import type { Prisma } from '@prisma/client';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { createTestApp, cleanDatabase } from '../test/setup';
import { LearningEventsService } from './learning-events.service';

/**
 * Prompt B, P4 against a real database: detection keys survive a recompute;
 * a new parameter version or library keeps the earlier rows (not current);
 * a coverage record is written per version.
 */
describe('Learning-event provenance (DB)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let parser: LearningEventsService;
  let sessionId: string;
  let userId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    parser = app.get(LearningEventsService);
    await cleanDatabase(prisma);
    userId = (
      await prisma.user.create({
        data: { email: 'prov@test.com', name: 'P', role: 'student', passwordHash: 'x' },
      })
    ).id;
    sessionId = (await prisma.studentSession.create({ data: { userId } })).id;
    const t0 = Date.now() - 3_600_000;
    const at = (s: number) => new Date(t0 + s * 1000);
    const meta = (m: Record<string, unknown>) => ({ libraryVersion: 'v2', ...m });
    await prisma.activityLog.createMany({
      data: [
        {
          action: 'SLIDE_ENTERED',
          occurredAt: at(0),
          metadata: meta({ slideKey: 's1-1', slideType: 'objectives', seq: 1 }),
        },
        {
          action: 'SLIDE_EXITED',
          occurredAt: at(20),
          metadata: meta({ slideKey: 's1-1', slideType: 'objectives', dwellMs: 20_000, seq: 2 }),
        },
        {
          action: 'PREDICTION_COMMITTED',
          occurredAt: at(40),
          metadata: meta({ slideKey: 's1-8', kind: 'think', chars: 22, msOnSlide: 5_000, seq: 3 }),
        },
        { action: 'IDLE_STARTED', occurredAt: at(60), metadata: meta({ seq: 4 }) },
        { action: 'IDLE_ENDED', occurredAt: at(260), metadata: meta({ idleMs: 200_000, seq: 5 }) },
      ].map((r) => ({ ...r, sessionId, userId })) as Prisma.ActivityLogCreateManyInput[],
    });
  }, 30_000);

  afterAll(async () => {
    await prisma.learningEventCoverage.deleteMany({ where: { sessionId } });
    await cleanDatabase(prisma);
    await app.close();
  });

  const current = () =>
    prisma.learningEvent.findMany({
      where: { sessionId, isCurrent: true },
      orderBy: { detectionKey: 'asc' },
    });

  it('stores provenance, and a recompute of the same version gives the same keys', async () => {
    const first = await parser.computeSession(sessionId);
    expect(first.libraryVersion).toBe('v2.1');
    const a = await current();
    expect(a.length).toBeGreaterThan(0);
    for (const e of a) {
      expect(e.detectionKey).toMatch(/^[0-9a-f]{64}$/);
      expect(e).toMatchObject({
        libraryHash: first.libraryHash,
        parameterHash: first.parameterHash,
        libraryVersion: 'v2.1',
      });
      expect(e.computedValues).toEqual(
        expect.objectContaining({ measured: expect.any(Object), thresholds: expect.any(Object) }),
      );
    }
    // The low-effort think prediction (no reveal) is kept by v2.1 M05.
    expect(a.map((e) => `${e.ruleId}:${e.outcome}`)).toContain('M05:think_low_effort');

    await parser.computeSession(sessionId);
    const b = await current();
    expect(b.map((e) => e.detectionKey)).toEqual(a.map((e) => e.detectionKey));
    expect(await prisma.learningEvent.count({ where: { sessionId } })).toBe(a.length);
    expect(
      await prisma.parameterSetSnapshot.findUnique({ where: { hash: first.parameterHash } }),
    ).not.toBeNull();
  });

  it('a new parameter version keeps the earlier rows, not current; so does v2', async () => {
    const before = await current();
    const latest = await prisma.learningEventParameterSet.findFirst({
      orderBy: { version: 'desc' },
    });
    const set = await prisma.learningEventParameterSet.create({
      data: {
        version: (latest?.version ?? 0) + 1,
        values: { T_rapid: 1 },
        note: 'provenance test',
        createdBy: userId,
      },
    });
    const r = await parser.computeSession(sessionId, set.version);
    expect(r.parameterHash).not.toBe(before[0]!.parameterHash);
    const old = await prisma.learningEvent.findMany({
      where: { sessionId, parameterHash: before[0]!.parameterHash },
    });
    expect(old).toHaveLength(before.length);
    expect(old.every((e) => !e.isCurrent)).toBe(true);
    expect((await current()).every((e) => e.parameterHash === r.parameterHash)).toBe(true);

    const v2 = await parser.computeSession(sessionId, set.version, { library: 'v2' });
    expect(v2.libraryVersion).toBe('v2');
    expect(await prisma.learningEvent.count({ where: { sessionId, libraryVersion: 'v2.1' } })).toBe(
      old.length + r.learningEvents,
    );
    const cov = await prisma.learningEventCoverage.findMany({ where: { sessionId } });
    expect(cov.filter((c) => c.isCurrent)).toHaveLength(1);
    expect(cov.length).toBeGreaterThanOrEqual(3);
    await prisma.learningEventParameterSet.delete({ where: { version: set.version } });
  });
});
