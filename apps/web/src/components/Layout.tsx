import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { PageContextProvider } from '../contexts/PageContext';
import { FloatingChatbot } from './FloatingChatbot';
import { useAuth } from '../contexts/AuthContext';

export function Layout() {
  const { user } = useAuth();

  return (
    <PageContextProvider>
      <div className="min-h-screen bg-gray-100">
        <Header />
        <div className="flex">
          <Sidebar />
          <main className="flex-1 p-6">
            <Outlet />
          </main>
        </div>
      </div>
      {user && <FloatingChatbot />}
    </PageContextProvider>
  );
}
