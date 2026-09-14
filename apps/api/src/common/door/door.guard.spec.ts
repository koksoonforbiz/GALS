import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DoorGuard } from './door.guard';
import { PublicDoor, PrivateDoor, requestDoor, DOOR_HEADER } from './door.decorator';
import { Roles } from '../../auth/roles.decorator';

// Real decorators on real classes, read back through a real Reflector —
// the guard's whole job is metadata precedence, so mocking the reflector
// would test nothing.
class PlainController {
  noMetadata() {}
  @Roles('student') studentOnly() {}
  @Roles('teacher', 'admin') staffOnly() {}
  @Roles('student', 'teacher') both() {}
  @PublicDoor() explicitlyPublic() {}
}

@PublicDoor()
class PublicController {
  noMetadata() {}
  @Roles('teacher', 'admin') staffMethod() {}
  @PrivateDoor() explicitlyPrivate() {}
}

@Roles('student')
class StudentController {
  noMetadata() {}
  @Roles('teacher') staffOverride() {}
}

function createContext(
  cls: new () => object,
  method: string,
  headers: Record<string, string>,
  type: 'http' | 'ws' = 'http',
): ExecutionContext {
  const request = { headers, method: 'GET', originalUrl: `/api/${method}`, ip: '127.0.0.1' };
  return {
    getType: () => type,
    getHandler: () => cls.prototype[method as keyof object] as unknown as () => void,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function createGuard() {
  const securityEvents = { record: jest.fn() };
  const guard = new DoorGuard(new Reflector(), securityEvents as any);
  return { guard, securityEvents };
}

const PUBLIC = { [DOOR_HEADER]: 'public' };
const PRIVATE = { [DOOR_HEADER]: 'private' };

describe('requestDoor', () => {
  it('is public only for an exact "public" header', () => {
    expect(requestDoor(PUBLIC)).toBe('public');
    expect(requestDoor(PRIVATE)).toBe('private');
    expect(requestDoor({})).toBe('private');
    expect(requestDoor(undefined)).toBe('private');
    expect(requestDoor({ [DOOR_HEADER]: 'Public' })).toBe('private');
    expect(requestDoor({ [DOOR_HEADER]: ['public'] })).toBe('public');
  });
});

describe('DoorGuard', () => {
  describe('outside the public door', () => {
    it.each([
      ['private header', PRIVATE],
      ['no header (dev / tests)', {}],
    ])('allows everything with %s', (_label, headers) => {
      const { guard, securityEvents } = createGuard();
      for (const method of ['noMetadata', 'studentOnly', 'staffOnly', 'both']) {
        expect(guard.canActivate(createContext(PlainController, method, headers))).toBe(true);
      }
      expect(securityEvents.record).not.toHaveBeenCalled();
    });

    it('ignores non-HTTP contexts', () => {
      const { guard } = createGuard();
      expect(guard.canActivate(createContext(PlainController, 'staffOnly', PUBLIC, 'ws'))).toBe(
        true,
      );
    });
  });

  describe('on the public door', () => {
    it('derives the answer from @Roles: student → allowed, staff-only → 404, mixed → allowed', () => {
      const { guard } = createGuard();
      expect(guard.canActivate(createContext(PlainController, 'studentOnly', PUBLIC))).toBe(true);
      expect(guard.canActivate(createContext(PlainController, 'both', PUBLIC))).toBe(true);
      expect(() => guard.canActivate(createContext(PlainController, 'staffOnly', PUBLIC))).toThrow(
        NotFoundException,
      );
    });

    it('defaults to private when a route carries no metadata at all', () => {
      const { guard, securityEvents } = createGuard();
      expect(() => guard.canActivate(createContext(PlainController, 'noMetadata', PUBLIC))).toThrow(
        NotFoundException,
      );
      expect(securityEvents.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PERMISSION_DENIED',
          metadata: expect.objectContaining({ reason: 'PRIVATE_ROUTE_VIA_PUBLIC_DOOR' }),
        }),
      );
    });

    it('honours a handler-level @PublicDoor on a route with no @Roles', () => {
      const { guard } = createGuard();
      expect(guard.canActivate(createContext(PlainController, 'explicitlyPublic', PUBLIC))).toBe(
        true,
      );
    });

    it('opens a whole controller with a class-level @PublicDoor', () => {
      const { guard } = createGuard();
      expect(guard.canActivate(createContext(PublicController, 'noMetadata', PUBLIC))).toBe(true);
    });

    it('lets a staff-only @Roles inside a @PublicDoor controller stay private', () => {
      const { guard } = createGuard();
      expect(() =>
        guard.canActivate(createContext(PublicController, 'staffMethod', PUBLIC)),
      ).toThrow(NotFoundException);
    });

    it('lets a handler-level @PrivateDoor override a class-level @PublicDoor', () => {
      const { guard } = createGuard();
      expect(() =>
        guard.canActivate(createContext(PublicController, 'explicitlyPrivate', PUBLIC)),
      ).toThrow(NotFoundException);
    });

    it('uses class-level @Roles when the handler has none, and handler @Roles when it does', () => {
      const { guard } = createGuard();
      expect(guard.canActivate(createContext(StudentController, 'noMetadata', PUBLIC))).toBe(true);
      expect(() =>
        guard.canActivate(createContext(StudentController, 'staffOverride', PUBLIC)),
      ).toThrow(NotFoundException);
    });
  });
});
