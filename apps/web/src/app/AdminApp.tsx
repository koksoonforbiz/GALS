import { useRoutes } from 'react-router-dom';
import { AppShell } from './AppShell';
import type { NavConfig } from '../nav/NavConfigContext';
import { studentNavItems } from '../nav/studentNav';
import { teacherNavItems } from '../nav/teacherNav';
import { authRoutes, fallbackRoutes } from '../routes/authRoutes';
import { adminOnlyRoutes } from '../routes/adminOnlyRoutes';
import { protectedLayoutRoute } from '../routes/shell';
import { studentRoutes } from '../routes/studentRoutes';
import { teacherRoutes } from '../routes/teacherRoutes';

/**
 * Private door: the full application, exactly the route set the old
 * App.tsx served. Student routes stay here so staff can still exercise
 * the student experience from the private hostname (and so plain `vite`
 * dev keeps working unchanged).
 */
const navConfig: NavConfig = {
  items: { student: studentNavItems, teacher: teacherNavItems, admin: teacherNavItems },
  homePath: { student: '/student', teacher: '/teacher', admin: '/teacher' },
};

const routes = [
  ...authRoutes,
  ...adminOnlyRoutes,
  protectedLayoutRoute([...teacherRoutes, ...studentRoutes]),
  ...fallbackRoutes,
];

function AdminRoutes() {
  return useRoutes(routes);
}

export function AdminApp() {
  return (
    <AppShell navConfig={navConfig}>
      <AdminRoutes />
    </AppShell>
  );
}
