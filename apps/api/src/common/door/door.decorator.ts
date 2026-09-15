import { SetMetadata } from '@nestjs/common';

/**
 * Two-door split (docs/two-door/api-classification.md).
 *
 * nginx tells the API which door a request came through via the
 * `X-GALS-Door` header (`public` = student hostname, `private` = staff
 * hostname). nginx sets the header unconditionally with proxy_set_header,
 * so a browser cannot forge it; a request with NO header did not come
 * through a door at all (local dev on :3000, tests) and is treated as
 * private, i.e. exactly today's behaviour.
 *
 * DoorGuard decides, on the public door only, whether a route may be
 * served. Precedence:
 *   1. handler-level @PublicDoor / @PrivateDoor
 *   2. @Roles (handler or class): includes 'student' → public, else private
 *   3. class-level @PublicDoor / @PrivateDoor
 *   4. default → private (404 on the public door)
 * So the decorator is only needed on routes with no @Roles at all, and a
 * whole controller can be opened with one class-level @PublicDoor() while
 * a single teacher method inside it stays private via its @Roles.
 */
export const DOOR_KEY = 'gals:door';
export const DOOR_HEADER = 'x-gals-door';

export type RequestDoor = 'public' | 'private';
export type DoorPolicy = 'public' | 'private';

/** Route (or whole controller) that the public student door may serve. */
export const PublicDoor = () => SetMetadata<string, DoorPolicy>(DOOR_KEY, 'public');

/** Route that must NOT be served on the public door even if its controller is @PublicDoor(). */
export const PrivateDoor = () => SetMetadata<string, DoorPolicy>(DOOR_KEY, 'private');

/** Which door the request came through; `private` when the header is absent or unrecognised. */
export function requestDoor(headers: Record<string, unknown> | undefined): RequestDoor {
  const raw = headers?.[DOOR_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === 'public' ? 'public' : 'private';
}
