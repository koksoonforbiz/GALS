// Checklist item 5 — single source of truth for "does this account need
// to change its password before continuing," shared by RolesGuard
// (server-side enforcement) and AuthService (so login/me responses can
// tell the client to redirect immediately, without waiting for a
// blocked request). Measured from passwordChangedAt, falling back to
// createdAt for accounts that self-registered before this field
// existed (passwordChangedAt is only ever null for those — every
// teacher-driven create/reset path sets it).
export const PASSWORD_EXPIRY_MS = 180 * 24 * 60 * 60 * 1000;

export interface PasswordLifecycleUser {
  isTemporaryPassword: boolean;
  passwordChangedAt: Date | string | null;
  createdAt: Date | string;
}

export function mustChangePassword(user: PasswordLifecycleUser): boolean {
  if (user.isTemporaryPassword) {
    return true;
  }
  const reference = user.passwordChangedAt ?? user.createdAt;
  return Date.now() - new Date(reference).getTime() > PASSWORD_EXPIRY_MS;
}
