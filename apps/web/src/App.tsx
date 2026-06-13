import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './components/Toast';
import { ProtectedRoute } from './components/ProtectedRoute';
import { RoleRoute } from './components/RoleRoute';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import Health from './pages/Health';
import { ActivityLogProvider } from './lib/activity-log';

// Teacher pages
import { TeacherDashboard } from './pages/teacher/TeacherDashboard';
import { CoursesPage } from './pages/teacher/CoursesPage';
import { CourseBuilderPage } from './pages/teacher/CourseBuilderPage';
import { QuestionsPage } from './pages/teacher/QuestionsPage';
import { AssessmentsPage } from './pages/teacher/AssessmentsPage';
import { ReviewPage } from './pages/teacher/ReviewPage';
import { AttemptDetailPage } from './pages/teacher/AttemptDetailPage';
import { CourseStudioPage } from './pages/teacher/CourseStudioPage';
import { AiSettingsPage } from './pages/teacher/AiSettingsPage';
import { PromptSettingsPage } from './pages/teacher/PromptSettingsPage';
import { QuestionGenerationPage } from './pages/teacher/QuestionGenerationPage';
import { UserManagementPage } from './pages/teacher/UserManagementPage';
import { BulkUserProvisioningPage } from './pages/teacher/BulkUserProvisioningPage';
import { StudentLogPage } from './pages/teacher/student-logs/StudentLogPage';
import { SessionTimelinePage } from './pages/dashboard/SessionTimelinePage';
import { StudentTextMiningPage } from './features/text-mining/pages/StudentTextMiningPage';
// Prompt 05: the student-facing /change-password page was removed.
// Only teachers/admins reset passwords now, via UserManagementPage.

// Student pages
import { StudentDashboard } from './pages/student/StudentDashboard';
import { StudentAssessmentsPage } from './pages/student/StudentAssessmentsPage';
import { StudentResultsPage } from './pages/student/StudentResultsPage';
import { AttemptPage } from './pages/student/AttemptPage';
import { AssessmentAttemptPage } from './pages/student/AssessmentAttemptPage';
import { CatalogPage } from './pages/student/CatalogPage';
import { MyCoursesPage } from './pages/student/MyCoursesPage';
import { StudentCourseViewPage } from './pages/student/StudentCourseViewPage';
import { ReviewQueuePage } from './pages/student/ReviewQueuePage';
import { DialogueLearning } from './pages/student/DialogueLearning';
import { DialogueSessionHistory } from './pages/student/DialogueSessionHistory';
import { ChatHistoryPage } from './pages/student/ChatHistoryPage';
import { useState } from 'react';
import { BiometricsWrapper } from './components/student/BiometricsWrapper';
import { PermissionGate } from './components/student/PermissionGate';
import { LoggingProvider } from './components/LoggingProvider';
import { useAuth } from './contexts/AuthContext';
import { useActivityLog } from './lib/activity-log';
import { PERMISSION_SESSION_KEY } from './lib/biometrics/permittedStreams';

function getToken() {
  return localStorage.getItem('token');
}

function AuthenticatedLoggingWrapper({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { sessionId } = useActivityLog();
  const [permissionsGranted, setPermissionsGranted] = useState(
    () => sessionStorage.getItem(PERMISSION_SESSION_KEY) === '1',
  );

  if (user?.role === 'student' && !permissionsGranted) {
    return <PermissionGate onGranted={() => setPermissionsGranted(true)} />;
  }

  if (!user || !sessionId) return <>{children}</>;

  return (
    {/* captureDom intentionally OFF for the 2026-06-13 study to keep
        snapshot storage under control. Pixel screenshots + activity
        logs still capture the full session — the loss is the ability
        to inspect the DOM tree on replay (text selection targets,
        hover behaviour, click target inference). Flip to `true` when
        DOM analysis is required and disk space allows. */}
    <LoggingProvider sessionId={sessionId} userId={user.id} captureDom={false}>
      {children}
    </LoggingProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ActivityLogProvider getToken={getToken}>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              {/* Prompt 05: /change-password removed (no student self-
                  service password flow). Teacher/admin resets only. */}
              <Route path="/health" element={<Health />} />

              {/* Protected routes with layout */}
              <Route
                element={
                  <ProtectedRoute>
                    <AuthenticatedLoggingWrapper>
                      <Layout />
                    </AuthenticatedLoggingWrapper>
                  </ProtectedRoute>
                }
              >
                {/* Teacher routes */}
                <Route
                  path="/teacher"
                  element={
                    <RoleRoute allowedRoles={['teacher', 'admin']}>
                      <TeacherDashboard />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/teacher/courses"
                  element={
                    <RoleRoute allowedRoles={['teacher', 'admin']}>
                      <CoursesPage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/teacher/courses/:courseId"
                  element={
                    <RoleRoute allowedRoles={['teacher', 'admin']}>
                      <CourseBuilderPage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/teacher/studio/:courseId"
                  element={
                    <RoleRoute allowedRoles={['teacher', 'admin']}>
                      <CourseStudioPage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/teacher/courses/:courseId/prompts"
                  element={
                    <RoleRoute allowedRoles={['teacher', 'admin']}>
                      <PromptSettingsPage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/teacher/courses/:courseId/generate-questions"
                  element={
                    <RoleRoute allowedRoles={['teacher', 'admin']}>
                      <QuestionGenerationPage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/teacher/ai-settings"
                  element={
                    <RoleRoute allowedRoles={['teacher', 'admin']}>
                      <AiSettingsPage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/teacher/questions"
                  element={
                    <RoleRoute allowedRoles={['teacher', 'admin']}>
                      <QuestionsPage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/teacher/assessments"
                  element={
                    <RoleRoute allowedRoles={['teacher', 'admin']}>
                      <AssessmentsPage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/teacher/review"
                  element={
                    <RoleRoute allowedRoles={['teacher', 'admin']}>
                      <ReviewPage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/teacher/attempt/:attemptId"
                  element={
                    <RoleRoute allowedRoles={['teacher', 'admin']}>
                      <AttemptDetailPage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/teacher/user-management"
                  element={
                    <RoleRoute allowedRoles={['teacher', 'admin']}>
                      <UserManagementPage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/teacher/users/bulk"
                  element={
                    <RoleRoute allowedRoles={['teacher', 'admin']}>
                      <BulkUserProvisioningPage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/teacher/students/:studentId/logs"
                  element={
                    <RoleRoute allowedRoles={['teacher', 'admin']}>
                      <StudentLogPage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/teacher/students/:studentId/text-mining"
                  element={
                    <RoleRoute allowedRoles={['teacher', 'admin']}>
                      <StudentTextMiningPage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/dashboard/sessions/:sessionId/timeline"
                  element={
                    <RoleRoute allowedRoles={['teacher', 'admin']}>
                      <SessionTimelinePage />
                    </RoleRoute>
                  }
                />

                {/* Student routes */}
                <Route
                  path="/student"
                  element={
                    <RoleRoute allowedRoles={['student']}>
                      <StudentDashboard />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/student/assessments"
                  element={
                    <RoleRoute allowedRoles={['student']}>
                      <StudentAssessmentsPage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/student/results"
                  element={
                    <RoleRoute allowedRoles={['student']}>
                      <StudentResultsPage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/student/attempt/:attemptId"
                  element={
                    <RoleRoute allowedRoles={['student']}>
                      <BiometricsWrapper>
                        <AttemptPage />
                      </BiometricsWrapper>
                    </RoleRoute>
                  }
                />
                <Route
                  path="/student/courses/:courseId/assessment/:assessmentId"
                  element={
                    <RoleRoute allowedRoles={['student']}>
                      <BiometricsWrapper>
                        <AssessmentAttemptPage />
                      </BiometricsWrapper>
                    </RoleRoute>
                  }
                />
                <Route
                  path="/student/catalog"
                  element={
                    <RoleRoute allowedRoles={['student']}>
                      <CatalogPage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/student/courses"
                  element={
                    <RoleRoute allowedRoles={['student']}>
                      <MyCoursesPage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/student/courses/:courseId"
                  element={
                    <RoleRoute allowedRoles={['student']}>
                      <BiometricsWrapper>
                        <StudentCourseViewPage />
                      </BiometricsWrapper>
                    </RoleRoute>
                  }
                />
                <Route
                  path="/student/review-queue"
                  element={
                    <RoleRoute allowedRoles={['student']}>
                      <ReviewQueuePage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/student/courses/:courseId/dialogue"
                  element={
                    <RoleRoute allowedRoles={['student']}>
                      <BiometricsWrapper>
                        <DialogueLearning />
                      </BiometricsWrapper>
                    </RoleRoute>
                  }
                />
                <Route
                  path="/student/courses/:courseId/dialogue/sessions"
                  element={
                    <RoleRoute allowedRoles={['student']}>
                      <DialogueSessionHistory />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/student/chat-history"
                  element={
                    <RoleRoute allowedRoles={['student']}>
                      <ChatHistoryPage />
                    </RoleRoute>
                  }
                />
              </Route>

              {/* Redirect root to appropriate dashboard */}
              <Route path="/" element={<Navigate to="/login" replace />} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </ActivityLogProvider>
    </BrowserRouter>
  );
}

export default App;
