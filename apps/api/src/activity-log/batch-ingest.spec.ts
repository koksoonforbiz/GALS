/**
 * CAP-40/41: no silent loss on POST /activity-log/batch.
 *  - one invalid event no longer loses the batch: it is rejected on its own
 *    and recorded (without content) in ingest_issues;
 *  - a refused insert falls back to row-by-row inserts and records the rows
 *    that still fail;
 *  - an unreachable database answers 503 so the client keeps and retries.
 */
import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ActivityLogController } from './activity-log.controller';
import { ActivityLogService } from './activity-log.service';

const SID = '11111111-1111-4111-8111-111111111111';
const COURSE = '22222222-2222-4222-8222-222222222222';
const at = '2026-11-25T10:00:00.000Z';

function fakePrisma() {
  return {
    activityLog: {
      createMany: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve({ count: data.length })),
      create: jest.fn().mockResolvedValue({}),
    },
    ingestIssue: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
}

function setup(prisma = fakePrisma()) {
  const service = new ActivityLogService(prisma as never, {} as never);
  const sessions = { assertOwnsSession: jest.fn().mockResolvedValue(undefined) };
  const controller = new ActivityLogController(
    service,
    sessions as never,
    {} as never,
    {} as never,
  );
  const req = { user: { id: 'u1', role: 'student' as const } };
  return { prisma, service, controller, req };
}

const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: 'test' });

describe('activity-log batch ingest', () => {
  it('keeps the valid events and records the invalid one without its content', async () => {
    const { prisma, controller, req } = setup();
    const res = await controller.batchLog(
      {
        sessionId: SID,
        events: [
          { action: 'MODULE_ITEM_VIEWED', occurredAt: at, courseId: null },
          { action: 'NOT_AN_ACTION', occurredAt: at, metadata: { secret: 'do not store' } },
          { action: 'MODULE_ITEM_VIEWED', occurredAt: at, courseId: COURSE },
        ],
      },
      req,
    );
    expect(res).toEqual({ ok: true, accepted: 2, rejected: 1, failed: 0 });
    expect(prisma.activityLog.createMany.mock.calls[0][0].data).toHaveLength(2);
    const issue = prisma.ingestIssue.createMany.mock.calls[0][0].data[0];
    expect(issue).toMatchObject({
      stream: 'activity_log',
      kind: 'rejected',
      sessionId: SID,
      userId: 'u1',
      action: 'NOT_AN_ACTION',
      reason: 'action:invalid_enum_value',
      eventCount: 1,
    });
    expect(JSON.stringify(issue)).not.toContain('do not store');
  });

  it('falls back to row-by-row inserts and records the rows that fail', async () => {
    const prisma = fakePrisma();
    prisma.activityLog.createMany.mockRejectedValue(known('P2007'));
    prisma.activityLog.create
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(known('P2007'))
      .mockResolvedValueOnce({});
    const { controller, req } = setup(prisma);
    const res = await controller.batchLog(
      {
        sessionId: SID,
        events: [1, 2, 3].map(() => ({ action: 'MODULE_ITEM_VIEWED', occurredAt: at })),
      },
      req,
    );
    expect(res).toEqual({ ok: true, accepted: 2, rejected: 0, failed: 1 });
    expect(prisma.ingestIssue.createMany.mock.calls[0][0].data[0]).toMatchObject({
      kind: 'insert_failed',
      action: 'MODULE_ITEM_VIEWED',
      reason: 'prisma:P2007',
      eventCount: 1,
    });
  });

  it('answers 503 when the database is unreachable, so the client retries', async () => {
    const prisma = fakePrisma();
    prisma.activityLog.createMany.mockRejectedValue(known('P1001'));
    const { controller, req } = setup(prisma);
    await expect(
      controller.batchLog(
        { sessionId: SID, events: [{ action: 'MODULE_ITEM_VIEWED', occurredAt: at }] },
        req,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.ingestIssue.createMany).not.toHaveBeenCalled();
  });

  it('never throws when recording an issue fails', async () => {
    const prisma = fakePrisma();
    prisma.ingestIssue.createMany.mockRejectedValue(new Error('down'));
    const { service } = setup(prisma);
    await expect(
      service.recordIngestIssues([
        { stream: 'activity_log', kind: 'rejected', reason: 'x', eventCount: 1 },
      ]),
    ).resolves.toBeUndefined();
  });
});
