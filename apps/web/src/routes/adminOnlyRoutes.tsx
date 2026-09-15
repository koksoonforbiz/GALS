import type { RouteObject } from 'react-router-dom';
import { Register } from '../pages/Register';
import Health from '../pages/Health';

/**
 * Unauthenticated routes that only the private admin door serves.
 *  - /register: self-registration is a staff workflow; students get a
 *    generated login ID + temporary password from their teacher.
 *  - /health: the frontend health page hits internal API details; the
 *    public door has no use for it (decision: private).
 */
export const adminOnlyRoutes: RouteObject[] = [
  { path: '/register', element: <Register /> },
  { path: '/health', element: <Health /> },
];
