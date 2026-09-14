import type { RouteObject } from 'react-router-dom';
import { Navigate } from 'react-router-dom';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { Login } from '../pages/Login';
import { Terms } from '../pages/Terms';
import { ChangePasswordPage } from '../pages/ChangePasswordPage';
import { WrongDoorPage } from '../pages/WrongDoorPage';
import { WRONG_DOOR_PATH } from '../door';

/**
 * Routes every door serves: sign-in, terms, forced password change, and
 * the wrong-door screen. `/register` and `/health` are admin-door only
 * (see routes/adminOnlyRoutes.tsx) so their pages never enter the student
 * bundle.
 */
export const authRoutes: RouteObject[] = [
  { path: '/login', element: <Login /> },
  { path: '/terms', element: <Terms /> },
  {
    path: '/change-password',
    element: (
      <ProtectedRoute>
        <ChangePasswordPage />
      </ProtectedRoute>
    ),
  },
  { path: WRONG_DOOR_PATH, element: <WrongDoorPage /> },
];

/** Root + catch-all. Must be last. */
export const fallbackRoutes: RouteObject[] = [
  { path: '/', element: <Navigate to="/login" replace /> },
  { path: '*', element: <Navigate to="/login" replace /> },
];
