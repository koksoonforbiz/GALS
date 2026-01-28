import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '@ats/shared';
import type { ReactNode } from 'react';

export interface RoleRouteProps {
  allowedRoles: UserRole[];
  children: ReactNode;
}

export function RoleRoute({ allowedRoles, children }: RoleRouteProps) {
  const { user } = useAuth();

  if (!user || !allowedRoles.includes(user.role)) {
    // Redirect to appropriate dashboard based on role
    if (user?.role === 'teacher' || user?.role === 'admin') {
      return <Navigate to="/teacher" replace />;
    }
    if (user?.role === 'student') {
      return <Navigate to="/student" replace />;
    }
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
