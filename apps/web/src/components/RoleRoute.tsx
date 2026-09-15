import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useHomePath } from '../nav/NavConfigContext';
import { WRONG_DOOR_PATH } from '../door';
import type { UserRole } from '@ats/shared';
import type { ReactNode } from 'react';

export interface RoleRouteProps {
  allowedRoles: UserRole[];
  children: ReactNode;
}

export function RoleRoute({ allowedRoles, children }: RoleRouteProps) {
  const { user } = useAuth();
  // Two-door split: the role's landing page on THIS door (null = the door
  // doesn't serve this role), so no teacher path is hardcoded here.
  const homePath = useHomePath(user?.role);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!allowedRoles.includes(user.role)) {
    // Redirect to the role's own dashboard — or, if this bundle has no
    // home for the role, to the wrong-door screen instead of a route
    // that would fall through the `*` catch-all and loop via /login.
    return <Navigate to={homePath ?? WRONG_DOOR_PATH} replace />;
  }

  return <>{children}</>;
}
