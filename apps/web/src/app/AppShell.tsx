import type { ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { ActivityLogProvider } from '../lib/activity-log';
import { AuthProvider } from '../contexts/AuthContext';
import { ToastProvider } from '../components/Toast';
import { NavConfigProvider, type NavConfig } from '../nav/NavConfigContext';

function getToken() {
  return localStorage.getItem('token');
}

/**
 * Provider stack shared by both doors, in the same order App.tsx used:
 * Router › ActivityLog › Auth › Toast, plus the door's NavConfig.
 */
export function AppShell({ navConfig, children }: { navConfig: NavConfig; children: ReactNode }) {
  return (
    <BrowserRouter>
      <ActivityLogProvider getToken={getToken}>
        <AuthProvider>
          <ToastProvider>
            <NavConfigProvider config={navConfig}>{children}</NavConfigProvider>
          </ToastProvider>
        </AuthProvider>
      </ActivityLogProvider>
    </BrowserRouter>
  );
}
