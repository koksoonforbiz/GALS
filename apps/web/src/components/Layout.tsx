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
  const { user, stopBiometrics, finishLogout } = useAuth();
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
        // Webcam/session were already stopped in handleLogoutRequest, at
        // click-time — just complete the auth transition.
        finishLogout();
        navigate('/login');
      } else {
        setLastAnsweredAt(Date.now());
      }
    },
    [track, flush, pendingLogout, finishLogout, navigate],
  );

  const handleLogoutRequest = useCallback(() => {
    // Stop the webcam and close the session immediately on click, so the
    // (unskippable) exit survey below doesn't extend the recorded session.
    stopBiometrics();
    setPendingLogout(true);
    setShowSurvey(true);
  }, [stopBiometrics]);

  return (
    <PageContextProvider>
      {/* h-screen + flex-col pins Header at its natural height and gives
          the row below it exactly the remaining viewport height via
          flex-1 — no `calc(100vh - Npx)` guessing anywhere. `main` gets
          its own overflow-y-auto so pages taller than the viewport
          scroll internally (header/sidebar stay pinned) instead of the
          whole document scrolling. Pages that want to fill their exact
          available height (e.g. StudentCourseViewPage) can now just use
          h-full / flex-1 on their own content. */}
      <div className="h-screen bg-gray-100 flex flex-col">
        <Header onLogoutRequest={user?.role === 'student' ? handleLogoutRequest : undefined} />
        <div className="flex flex-1 min-h-0">
          <Sidebar />
          <main className="flex-1 min-h-0 p-4 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
      {user && <FloatingChatbot />}
      {showSurvey && <EmotionSurveyModal onAnswer={handleAnswer} />}
    </PageContextProvider>
  );
}
