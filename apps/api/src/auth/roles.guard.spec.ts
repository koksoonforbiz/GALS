import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from './roles.decorator';
import { MfaPolicyService, parseMfaRequiredRoles } from './mfa-policy.service';

function forbiddenCode(fn: () => unknown): unknown {
  try {
    fn();
    throw new Error('expected fn() to throw');
  } catch (err) {
    if (!(err instanceof ForbiddenException)) throw err;
    const response = err.getResponse();
    return typeof response === 'object' && response !== null
      ? (response as Record<string, unknown>).code
      : undefined;
  }
}

function createMockReflector(requiredRoles: string[] | undefined) {
  return { getAllAndOverride: jest.fn().mockReturnValue(requiredRoles) } as any;
}

function createMockSecurityEvents() {
  return { record: jest.fn() };
}

// Checklist item 12 — MFA policy stubs. `noMfaPolicy` mirrors the default
// (MFA_REQUIRED_ROLES unset); `mfaRequiredFor` builds the real service
// against a fake ConfigService so the parsing path is exercised too.
function noMfaPolicy() {
  return new MfaPolicyService({ get: () => undefined } as any);
}
function mfaRequiredFor(roles: string) {
  return new MfaPolicyService({ get: () => roles } as any);
}

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows the request through when no roles are required on the route', () => {
    const guard = new RolesGuard(
      createMockReflector(undefined),
      createMockSecurityEvents() as any,
      noMfaPolicy(),
    );
    const ctx = createContext({ user: { id: 'u1', role: 'student' } });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('denies an unauthenticated request (no user on the request)', () => {
    const securityEvents = createMockSecurityEvents();
    const guard = new RolesGuard(
      createMockReflector(['teacher']),
      securityEvents as any,
      noMfaPolicy(),
    );
    const ctx = createContext({});

    expect(guard.canActivate(ctx)).toBe(false);
    // No user id to attribute the event to — nothing recorded.
    expect(securityEvents.record).not.toHaveBeenCalled();
  });

  it('allows a user whose role matches one of the required roles', () => {
    const securityEvents = createMockSecurityEvents();
    const guard = new RolesGuard(
      createMockReflector(['teacher', 'admin']),
      securityEvents as any,
      noMfaPolicy(),
    );
    const ctx = createContext({ user: { id: 'u1', role: 'teacher' } });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(securityEvents.record).not.toHaveBeenCalled();
  });

  it('denies a student hitting a teacher-only route and records a PERMISSION_DENIED event', () => {
    const securityEvents = createMockSecurityEvents();
    const guard = new RolesGuard(
      createMockReflector(['teacher']),
      securityEvents as any,
      noMfaPolicy(),
    );
    const ctx = createContext({
      user: { id: 'student-1', role: 'student' },
      method: 'DELETE',
      originalUrl: '/api/courses/abc',
      ip: '203.0.113.5',
    });

    expect(guard.canActivate(ctx)).toBe(false);
    expect(securityEvents.record).toHaveBeenCalledWith({
      type: 'PERMISSION_DENIED',
      userId: 'student-1',
      ipAddress: '203.0.113.5',
      metadata: {
        requiredRoles: ['teacher'],
        actualRole: 'student',
        method: 'DELETE',
        path: '/api/courses/abc',
      },
    });
  });

  // Checklist item 5 — forced change (teacher reset) and 180-day expiry.
  describe('password lifecycle', () => {
    it('blocks a request with PASSWORD_CHANGE_REQUIRED when isTemporaryPassword is set, even on a route with no @Roles() requirement', () => {
      const guard = new RolesGuard(
        createMockReflector(undefined),
        createMockSecurityEvents() as any,
        noMfaPolicy(),
      );
      const ctx = createContext({
        user: {
          id: 'u1',
          role: 'student',
          isTemporaryPassword: true,
          passwordChangedAt: null,
          createdAt: new Date(),
        },
      });

      expect(forbiddenCode(() => guard.canActivate(ctx))).toBe('PASSWORD_CHANGE_REQUIRED');
    });

    it('blocks a request once passwordChangedAt is more than 180 days old', () => {
      const guard = new RolesGuard(
        createMockReflector(undefined),
        createMockSecurityEvents() as any,
        noMfaPolicy(),
      );
      const staleDate = new Date(Date.now() - 181 * 24 * 60 * 60 * 1000);
      const ctx = createContext({
        user: {
          id: 'u1',
          role: 'student',
          isTemporaryPassword: false,
          passwordChangedAt: staleDate,
          createdAt: staleDate,
        },
      });

      expect(forbiddenCode(() => guard.canActivate(ctx))).toBe('PASSWORD_CHANGE_REQUIRED');
    });

    it('allows a request when the password is recent and not temporary', () => {
      const guard = new RolesGuard(
        createMockReflector(undefined),
        createMockSecurityEvents() as any,
        noMfaPolicy(),
      );
      const ctx = createContext({
        user: {
          id: 'u1',
          role: 'student',
          isTemporaryPassword: false,
          passwordChangedAt: new Date(),
          createdAt: new Date(),
        },
      });

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('falls back to createdAt when passwordChangedAt is null (pre-existing self-registered account)', () => {
      const guard = new RolesGuard(
        createMockReflector(undefined),
        createMockSecurityEvents() as any,
        noMfaPolicy(),
      );
      const staleDate = new Date(Date.now() - 181 * 24 * 60 * 60 * 1000);
      const ctx = createContext({
        user: {
          id: 'u1',
          role: 'student',
          isTemporaryPassword: false,
          passwordChangedAt: null,
          createdAt: staleDate,
        },
      });

      expect(forbiddenCode(() => guard.canActivate(ctx))).toBe('PASSWORD_CHANGE_REQUIRED');
    });
  });
});

// Sanity: confirms the guard reads the same metadata key the
// @Roles() decorator writes, so a future rename of one without the
// other fails loudly here instead of silently disabling every guard.
it('RolesGuard and the @Roles() decorator agree on the reflection key', () => {
  expect(ROLES_KEY).toBe('roles');
});

// Checklist item 12 — mandatory MFA for MFA_REQUIRED_ROLES.
describe('RolesGuard — mandatory MFA enrolment (checklist item 12)', () => {
  const base = {
    id: 'u1',
    isTemporaryPassword: false,
    passwordChangedAt: new Date(),
    createdAt: new Date(),
  };

  it('is a no-op when MFA_REQUIRED_ROLES is unset', () => {
    const guard = new RolesGuard(
      createMockReflector(undefined),
      createMockSecurityEvents() as any,
      noMfaPolicy(),
    );
    const ctx = createContext({ user: { ...base, role: 'admin', twoFactorMethod: null } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('blocks an un-enrolled account of a required role with MFA_ENROLMENT_REQUIRED, even on a route with no @Roles()', () => {
    const guard = new RolesGuard(
      createMockReflector(undefined),
      createMockSecurityEvents() as any,
      mfaRequiredFor('admin, teacher'),
    );
    const ctx = createContext({ user: { ...base, role: 'teacher', twoFactorMethod: null } });
    expect(forbiddenCode(() => guard.canActivate(ctx))).toBe('MFA_ENROLMENT_REQUIRED');
  });

  it('lets an enrolled account of a required role through', () => {
    const guard = new RolesGuard(
      createMockReflector(['teacher']),
      createMockSecurityEvents() as any,
      mfaRequiredFor('admin,teacher'),
    );
    const ctx = createContext({ user: { ...base, role: 'teacher', twoFactorMethod: 'totp' } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('does not gate roles outside the list', () => {
    const guard = new RolesGuard(
      createMockReflector(undefined),
      createMockSecurityEvents() as any,
      mfaRequiredFor('admin,teacher'),
    );
    const ctx = createContext({ user: { ...base, role: 'student', twoFactorMethod: null } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('the password-change gate takes precedence over the MFA gate', () => {
    const guard = new RolesGuard(
      createMockReflector(undefined),
      createMockSecurityEvents() as any,
      mfaRequiredFor('admin'),
    );
    const ctx = createContext({
      user: { ...base, role: 'admin', twoFactorMethod: null, isTemporaryPassword: true },
    });
    expect(forbiddenCode(() => guard.canActivate(ctx))).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('rejects an unknown role name in MFA_REQUIRED_ROLES at startup', () => {
    expect(() => parseMfaRequiredRoles('admin,superuser')).toThrow(/unknown role "superuser"/);
    expect([...parseMfaRequiredRoles(' Admin ,teacher,, ')]).toEqual(['admin', 'teacher']);
    expect(parseMfaRequiredRoles(undefined).size).toBe(0);
  });
});
