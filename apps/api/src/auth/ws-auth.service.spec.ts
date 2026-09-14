import { WsAuthService, wsUser, wsIsStaff } from './ws-auth.service';
import { DOOR_HEADER } from '../common/door/door.decorator';

const ACTIVE_STUDENT = {
  id: 'student-1',
  role: 'student',
  isActive: true,
  isTemporaryPassword: false,
  passwordChangedAt: new Date(),
  createdAt: new Date(),
};

function createService(user: Record<string, unknown> | null = ACTIVE_STUDENT) {
  const jwt = {
    verifyAsync: jest.fn(async (token: string) => {
      if (token === 'valid') return { sub: 'student-1' };
      throw new Error('bad token');
    }),
  };
  const prisma = { user: { findUnique: jest.fn(async () => user) } };
  const securityEvents = { record: jest.fn() };
  const service = new WsAuthService(jwt as any, prisma as any, securityEvents as any);
  return { service, jwt, prisma, securityEvents };
}

function createSocket(opts: {
  token?: string;
  authorization?: string;
  door?: 'public' | 'private';
}): any {
  const headers: Record<string, string> = {};
  if (opts.authorization) headers.authorization = opts.authorization;
  if (opts.door) headers[DOOR_HEADER] = opts.door;
  return {
    id: 'sock-1',
    data: {},
    handshake: { auth: opts.token ? { token: opts.token } : {}, headers, address: '127.0.0.1' },
  };
}

/** Runs the middleware and resolves with the `next` error (undefined = accepted). */
function run(
  service: WsAuthService,
  socket: any,
  publicDoor: 'student' | 'never' = 'student',
): Promise<Error | undefined> {
  return new Promise((resolve) => {
    service.middleware({ namespace: 'test', publicDoor })(socket, (err) => resolve(err));
  });
}

describe('WsAuthService.middleware', () => {
  it('accepts a valid handshake token and stores the user on socket.data', async () => {
    const { service } = createService();
    const socket = createSocket({ token: 'valid' });

    expect(await run(service, socket)).toBeUndefined();
    expect(wsUser(socket)).toEqual({ id: 'student-1', role: 'student' });
    expect(wsIsStaff(socket)).toBe(false);
  });

  it('accepts a Bearer header for non-browser clients', async () => {
    const { service } = createService();
    const socket = createSocket({ authorization: 'Bearer valid' });

    expect(await run(service, socket)).toBeUndefined();
  });

  it('refuses a missing token before touching the database', async () => {
    const { service, prisma } = createService();
    const err = await run(service, createSocket({}));

    expect(err?.message).toMatch(/missing token/);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('refuses an invalid token', async () => {
    const { service } = createService();
    const err = await run(service, createSocket({ token: 'forged' }));

    expect(err?.message).toMatch(/invalid token/);
  });

  it('refuses a token for a user that no longer exists', async () => {
    const { service } = createService(null);
    const err = await run(service, createSocket({ token: 'valid' }));

    expect(err?.message).toMatch(/user not found/);
  });

  it('refuses a deactivated account and records the reuse', async () => {
    const { service, securityEvents } = createService({ ...ACTIVE_STUDENT, isActive: false });
    const err = await run(service, createSocket({ token: 'valid' }));

    expect(err?.message).toMatch(/deactivated/);
    expect(securityEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DEACTIVATED_TOKEN_REUSE', userId: 'student-1' }),
    );
  });

  it('refuses an account with an outstanding forced password change', async () => {
    const { service } = createService({ ...ACTIVE_STUDENT, isTemporaryPassword: true });
    const err = await run(service, createSocket({ token: 'valid' }));

    expect(err?.message).toMatch(/password change required/);
  });

  describe('door policy', () => {
    it('lets a student through the public door on a student namespace', async () => {
      const { service } = createService();
      expect(await run(service, createSocket({ token: 'valid', door: 'public' }))).toBeUndefined();
    });

    it('refuses a teacher through the public door and records it', async () => {
      const { service, securityEvents } = createService({ ...ACTIVE_STUDENT, role: 'teacher' });
      const err = await run(service, createSocket({ token: 'valid', door: 'public' }));

      expect(err?.message).toBe('Not found');
      expect(securityEvents.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PERMISSION_DENIED',
          metadata: expect.objectContaining({ reason: 'PRIVATE_NAMESPACE_VIA_PUBLIC_DOOR' }),
        }),
      );
    });

    it('refuses everyone through the public door on a publicDoor: never namespace', async () => {
      const { service } = createService();
      const err = await run(service, createSocket({ token: 'valid', door: 'public' }), 'never');

      expect(err?.message).toBe('Not found');
    });

    it('does not restrict the private door or door-less connections by role', async () => {
      const { service } = createService({ ...ACTIVE_STUDENT, role: 'teacher' });
      expect(
        await run(service, createSocket({ token: 'valid', door: 'private' }), 'never'),
      ).toBeUndefined();
      expect(await run(service, createSocket({ token: 'valid' }), 'never')).toBeUndefined();
    });
  });
});
