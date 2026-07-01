import { Outlet, useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { PageContextProvider } from '../contexts/PageContext';
import { FloatingChatbot } from './FloatingChatbot';
import { EmotionSurveyModal, type EmotionOption } from './EmotionSurveyModal';
import { useAuth } from '../contexts/AuthContext';
import { usePageViewTracker, useActivityLog } from '../lib/activity-log';

const SURVEY_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { track, flush } = useActivityLog();
  usePageViewTracker();

  const [showSurvey, setShowSurvey] = useState(false);
  const [pendingLogout, setPendingLogout] = useState(false);
  // Each time the student answers, update this timestamp to restart the 15-min clock.
  const [lastAnsweredAt, setLastAnsweredAt] = useState(() => Date.now());

  useEffect(() => {
    if (user?.role !== 'student') return;
    const timer = setTimeout(() => setShowSurvey(true), SURVEY_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [user?.role, lastAnsweredAt]);

  const handleAnswer = useCallback(
    (emotion: EmotionOption) => {
      track('EMOTION_SELF_REPORT', { metadata: { emotion } });
      void flush();
      setShowSurvey(false);
      if (pendingLogout) {
        setPendingLogout(false);
        logout();
        navigate('/login');
      } else {
        setLastAnsweredAt(Date.now());
      }
    },
    [track, flush, pendingLogout, logout, navigate],
  );

  const handleLogoutRequest = useCallback(() => {
    setPendingLogout(true);
    setShowSurvey(true);
  }, []);

  return (
    <PageContextProvider>
      <div className="min-h-screen bg-gray-100">
        <Header onLogoutRequest={user?.role === 'student' ? handleLogoutRequest : undefined} />
        <div className="flex">
          <Sidebar />
          <main className="flex-1 p-6">
            <Outlet />
          </main>
        </div>
      </div>
      {user && <FloatingChatbot />}
      {showSurvey && <EmotionSurveyModal onAnswer={handleAnswer} />}
    </PageContextProvider>
  );
}
