import type { RouteObject } from 'react-router-dom';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { Layout } from '../components/Layout';
import { AuthenticatedLoggingWrapper } from '../app/AuthenticatedLoggingWrapper';
import { AccountSecurityPage } from '../pages/AccountSecurityPage';

/**
 * The authenticated layout route: ProtectedRoute › sensing spine
 * (AuthenticatedLoggingWrapper) › Layout. All role-specific routes nest
 * under it so the same logging/biometrics behaviour applies on both
 * doors. Account settings sit here directly because any authenticated
 * role may use them.
 */
export function protectedLayoutRoute(children: RouteObject[]): RouteObject {
  return {
    element: (
      <ProtectedRoute>
        <AuthenticatedLoggingWrapper>
          <Layout />
        </AuthenticatedLoggingWrapper>
      </ProtectedRoute>
    ),
    children: [{ path: '/account/security', element: <AccountSecurityPage /> }, ...children],
  };
}
