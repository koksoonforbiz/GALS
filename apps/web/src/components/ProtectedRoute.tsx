import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LoadingSpinner } from './LoadingSpinner';
import type { ReactNode } from 'react';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Checklist item 5 — a forced password change (teacher/admin reset,
  // or 180-day expiry) blocks every other route until it's resolved.
  // The backend enforces the same thing server-side via RolesGuard;
  // this just gets the user there without waiting on a blocked request.
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  // Checklist item 12 — mandatory MFA for the roles the server lists in
  // MFA_REQUIRED_ROLES. Same pattern: RolesGuard enforces it server-side
  // (MFA_ENROLMENT_REQUIRED); this routes the user to enrolment first.
  // Runs after the password gate so a reset account changes its password
  // before being asked to enrol a factor.
  if (user.mustEnrolMfa && location.pathname !== '/account/security') {
    return <Navigate to="/account/security" replace />;
  }

  return <>{children}</>;
}
