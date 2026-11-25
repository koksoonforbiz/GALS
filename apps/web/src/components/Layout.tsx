import { Outlet, useNavigate } from 'react-router-dom';
import { REQUEST_SIGN_OUT_EVENT } from '../lib/signOut';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { PageContextProvider } from '../contexts/PageContext';
import { EmotionSurveyModal, type EmotionOption } from './EmotionSurveyModal';
import { SurveyHoldContext } from './surveyHold';
import { useAuth } from '../contexts/AuthContext';
import { usePageViewTracker, useActivityLog } from '../lib/activity-log';
import { LearnerPrompts } from './student/LearnerPrompts';
import { AnnouncementBanner } from './student/AnnouncementBanner';
import { currentCourseId, usePromptFlags } from '../lib/capture/learnerPrompts';

const SURVEY_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export function Layout() {
  const { user, stopBiometrics, finishLogout } = useAuth();
  const navigate = useNavigate();
  const { track, flush } = useActivityLog();
  usePageViewTracker();

  const [showSurvey, setShowSurvey] = useState(false);
  const [pendingLogout, setPendingLogout] = useState(false);
  // A page (the puzzles) may hold the periodic survey back; it shows afterwards.
  const [surveyHeld, setSurveyHeld] = useState(false);
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

  const proceedLogout = useCallback(() => {
    // Stop the webcam and close the session immediately on click, so the
    // (unskippable) exit survey below doesn't extend the recorded session.
    stopBiometrics();
    setPendingLogout(true);
    setShowSurvey(true);
  }, [stopBiometrics]);

  // End-of-session reflection (Prompt B, P5d; WP5 G9): asked once, before
  // the session closes, so it belongs to it. Skipping is logged too.
  const promptFlags = usePromptFlags(currentCourseId());
  const [reflecting, setReflecting] = useState(false);
  const reflectShownAt = useRef(0);
  const handleLogoutRequest = useCallback(() => {
    if (promptFlags.session_reflection && !reflecting) {
      reflectShownAt.current = Date.now();
      setReflecting(true);
      track('AFFORDANCE_SHOWN', { metadata: { affordance: 'session_reflection' } });
      return;
    }
    proceedLogout();
  }, [promptFlags.session_reflection, reflecting, proceedLogout, track]);
  const finishReflection = (answer: { learned: string; unclear: string } | null) => {
    if (answer) {
      track('SESSION_REFLECTION_SUBMITTED', {
        metadata: {
          learned: answer.learned,
          unclear: answer.unclear,
          learnedChars: answer.learned.length,
          unclearChars: answer.unclear.length,
        },
      });
    } else {
      track('AFFORDANCE_DISMISSED', {
        metadata: {
          affordance: 'session_reflection',
          msShown: Date.now() - reflectShownAt.current,
        },
      });
    }
    setReflecting(false);
    proceedLogout();
  };

  // Pages without the header's handler (e.g. "Take a break" after the
  // pre-course check) request the same sign-out flow by event.
  useEffect(() => {
    if (user?.role !== 'student') return;
    const onRequest = () => handleLogoutRequest();
    window.addEventListener(REQUEST_SIGN_OUT_EVENT, onRequest);
    return () => window.removeEventListener(REQUEST_SIGN_OUT_EVENT, onRequest);
  }, [user?.role, handleLogoutRequest]);

  return (
    <PageContextProvider>
      {/* Header is now a fixed top-left account button (see
          Header.tsx) instead of a top row, so it consumes no layout
          space at all — the row below always gets the full viewport.
          `main` still gets its own overflow-y-auto so pages taller than
          the viewport scroll internally (sidebar stays pinned) instead
          of the whole document scrolling. Pages that want to fill their
          exact available height (e.g. StudentCourseViewPage) can just
          use h-full / flex-1 on their own content. */}
      <div className="h-screen bg-gray-100 flex flex-col">
        <div className="flex flex-1 min-h-0">
          <Sidebar />
          <main className="flex-1 min-h-0 p-4 overflow-y-auto">
            <SurveyHoldContext.Provider value={setSurveyHeld}>
              <Outlet />
            </SurveyHoldContext.Provider>
          </main>
        </div>
      </div>
      <Header onLogoutRequest={user?.role === 'student' ? handleLogoutRequest : undefined} />
      {user?.role === 'student' && <AnnouncementBanner />}
      {user?.role === 'student' && <LearnerPrompts />}
      {reflecting && <ReflectionModal onDone={finishReflection} />}
      {showSurvey && (!surveyHeld || pendingLogout) && (
        <EmotionSurveyModal onAnswer={handleAnswer} signingOut={pendingLogout} />
      )}
    </PageContextProvider>
  );
}

/** "One thing you learned today, and one thing still unclear." (PLAN_B §5) */
function ReflectionModal({
  onDone,
}: {
  onDone: (answer: { learned: string; unclear: string } | null) => void;
}) {
  const [learned, setLearned] = useState('');
  const [unclear, setUnclear] = useState('');
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/40">
      <div
        className="w-[28rem] rounded-lg bg-white p-4 text-sm shadow-xl"
        role="dialog"
        aria-label="Reflection"
        data-testid="prompt-session_reflection"
      >
        <p className="mb-3 font-medium text-gray-800">
          One thing you learned today, and one thing still unclear.
        </p>
        <label className="mb-1 block text-xs text-gray-600" htmlFor="refl-learned">
          One thing I learned
        </label>
        <textarea
          id="refl-learned"
          className="mb-3 h-16 w-full rounded border border-gray-300 p-2"
          value={learned}
          onChange={(e) => setLearned(e.target.value)}
        />
        <label className="mb-1 block text-xs text-gray-600" htmlFor="refl-unclear">
          One thing still unclear
        </label>
        <textarea
          id="refl-unclear"
          className="mb-3 h-16 w-full rounded border border-gray-300 p-2"
          value={unclear}
          onChange={(e) => setUnclear(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-gray-300 px-3 py-1.5"
            onClick={() => onDone(null)}
          >
            Skip
          </button>
          <button
            type="button"
            className="rounded bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50"
            disabled={!learned.trim() && !unclear.trim()}
            onClick={() => onDone({ learned: learned.trim(), unclear: unclear.trim() })}
          >
            Save and sign out
          </button>
        </div>
      </div>
    </div>
  );
}
