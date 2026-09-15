import { useRoutes } from 'react-router-dom';
import { AppShell } from './AppShell';
import type { NavConfig } from '../nav/NavConfigContext';
import { studentNavItems } from '../nav/studentNav';
import { authRoutes, fallbackRoutes } from '../routes/authRoutes';
import { protectedLayoutRoute } from '../routes/shell';
import { studentRoutes } from '../routes/studentRoutes';

/**
 * Public door. Student + auth routes only — no /register, no /health, no
 * teacher tree. Teacher/admin accounts have no `homePath` here, so a
 * staff login lands on /wrong-door instead of being redirected to a
 * route this bundle doesn't have.
 */
const navConfig: NavConfig = {
  items: { student: studentNavItems },
  homePath: { student: '/student' },
};

const routes = [...authRoutes, protectedLayoutRoute(studentRoutes), ...fallbackRoutes];

function StudentRoutes() {
  return useRoutes(routes);
}

export function StudentApp() {
  return (
    <AppShell navConfig={navConfig}>
      <StudentRoutes />
    </AppShell>
  );
}
