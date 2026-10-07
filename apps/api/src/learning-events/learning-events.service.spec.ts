import { BadRequestException } from '@nestjs/common';
import { LearningEventsService } from './learning-events.service';

const T0 = Date.UTC(2026, 9, 7, 9);

function row(id: string, action: string, sec: number, metadata: Record<string, unknown>) {
  return {
    id,
    action,
    occurredAt: new Date(T0 + sec * 1000),
    courseId: 'course-1',
    moduleItemId: 'item-1',
    interventionId: null,
    metadata: { libraryVersion: 'v2', ...metadata },
  };
}

function createPrisma(rows: ReturnType<typeof row>[]) {
  const learningEvent = {
    deleteMany: jest.fn().mockReturnValue('delete-op'),
    createMany: jest.fn().mockReturnValue('create-op'),
    groupBy: jest.fn().mockResolvedValue([{ ruleId: 'M05', sessionId: 's1' }]),
    findMany: jest.fn(),
  };
  return {
    studentSession: {
      findUnique: jest.fn().mockResolvedValue({ id: 's1', userId: 'stu-1', courseId: 'course-1' }),
      findMany: jest.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]),
    },
    learningEventParameterSet: {
      findFirst: jest.fn().mockResolvedValue({ version: 3, values: { T_rapid: 30_000 } }),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
      create: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve({ ...data, createdAt: new Date() })),
      findMany: jest.fn(),
    },
    activityLog: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }) => Promise.resolve(where.sessionId ? rows : [])),
      groupBy: jest.fn().mockResolvedValue([
        { sessionId: 's1', action: 'PREDICTION_COMMITTED' },
        { sessionId: 's2', action: 'SLIDE_ENTERED' },
      ]),
    },
    visibility_logs: { findMany: jest.fn().mockResolvedValue([]) },
    learningEvent,
    $transaction: jest.fn().mockResolvedValue([]),
  };
}

describe('LearningEventsService', () => {
  it('replaces a session’s rows in one transaction, stamped with library and parameter versions', async () => {
    const pred = row('r1', 'PREDICTION_COMMITTED', 0, {
      slideKey: 's1-3',
      kind: 'think',
      chars: 120,
      msOnSlide: 60_000,
      seq: 1,
    });
    const prisma = createPrisma([pred, { ...pred, id: 'r1-copy' }]);
    const service = new LearningEventsService(prisma as any);

    const res = await service.computeSession('s1');

    expect(res).toMatchObject({
      rawActions: 2,
      duplicatesRemoved: 1,
      parameterSetVersion: 3,
      byRule: { M05: 1 },
    });
    expect(prisma.learningEvent.deleteMany).toHaveBeenCalledWith({ where: { sessionId: 's1' } });
    const data = prisma.learningEvent.createMany.mock.calls[0][0].data;
    expect(data[0]).toMatchObject({
      ruleId: 'M05',
      studentId: 'stu-1',
      sessionId: 's1',
      courseId: 'course-1',
      slideKey: 's1-3',
      confidence: 'candidate',
      libraryVersion: 'v2',
      parameterSetVersion: 3,
      sourceActionIds: ['r1'],
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(['delete-op', 'create-op']);
  });

  it('reports coverage per rule, including no-input rules', async () => {
    const service = new LearningEventsService(createPrisma([]) as any);
    const cov = await service.coverage('course-1');
    const m05 = cov.rules.find((r) => r.ruleId === 'M05')!;
    expect(m05).toMatchObject({ sessions: 2, couldFire: 1, fired: 1, status: 'ok' });
    expect(cov.rules.find((r) => r.ruleId === 'M10')).toMatchObject({ status: 'no_input' });
    expect(cov.rules.find((r) => r.ruleId === 'M16')).toMatchObject({
      couldFire: 0,
      status: 'zero_coverage',
    });
    expect(cov.rules).toHaveLength(36);
  });

  it('new parameter sets extend the previous version and reject unknown keys', async () => {
    const prisma = createPrisma([]);
    const service = new LearningEventsService(prisma as any);
    const s = await service.createParameterSet(
      { T_idle: 300_000 },
      'sensitivity 300 s',
      'researcher-1',
    );
    expect(s).toMatchObject({ version: 4, values: { T_rapid: 30_000, T_idle: 300_000 } });
    expect(s.resolved.T_idle).toBe(300_000);
    await expect(service.createParameterSet({ T_bogus: 1 }, undefined, 'r')).rejects.toThrow(
      BadRequestException,
    );
  });
});
