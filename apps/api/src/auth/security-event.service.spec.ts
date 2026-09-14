import { SecurityEventService } from './security-event.service';

function createMockPrisma() {
  return {
    securityEvent: {
      create: jest.fn().mockResolvedValue({}),
    },
  };
}

describe('SecurityEventService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: SecurityEventService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new SecurityEventService(prisma as any);
  });

  it('writes the event with all provided fields', () => {
    service.record({
      type: 'PERMISSION_DENIED',
      userId: 'user-1',
      ipAddress: '203.0.113.1',
      userAgent: 'test-agent',
      metadata: { path: '/api/foo' },
    });

    expect(prisma.securityEvent.create).toHaveBeenCalledWith({
      data: {
        type: 'PERMISSION_DENIED',
        userId: 'user-1',
        identifier: null,
        ipAddress: '203.0.113.1',
        userAgent: 'test-agent',
        metadata: { path: '/api/foo' },
      },
    });
  });

  it('defaults optional fields to null when omitted', () => {
    service.record({ type: 'ACCOUNT_LOCKED_OUT', userId: 'user-2' });

    expect(prisma.securityEvent.create).toHaveBeenCalledWith({
      data: {
        type: 'ACCOUNT_LOCKED_OUT',
        userId: 'user-2',
        identifier: null,
        ipAddress: null,
        userAgent: null,
        metadata: undefined,
      },
    });
  });

  it('is fire-and-forget: never throws synchronously even when the write will fail', () => {
    prisma.securityEvent.create.mockRejectedValueOnce(new Error('db down'));

    expect(() => service.record({ type: 'FAILED_LOGIN_INVALID_PASSWORD' })).not.toThrow();
  });

  it('swallows a write failure without throwing (auth flow must never break because logging failed)', async () => {
    prisma.securityEvent.create.mockRejectedValueOnce(new Error('db down'));

    service.record({ type: 'FAILED_LOGIN_UNKNOWN_IDENTIFIER', identifier: 'a@b.com' });

    // Let the rejected promise's .catch() handler run.
    await new Promise((resolve) => setImmediate(resolve));

    expect(prisma.securityEvent.create).toHaveBeenCalled();
  });
});
