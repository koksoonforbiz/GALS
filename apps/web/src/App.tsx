import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './components/Toast';
import { ProtectedRoute } from './components/ProtectedRoute';
import { RoleRoute } from './components/RoleRoute';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import Health from './pages/Health';

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

// Student pages
import { StudentDashboard } from './pages/student/StudentDashboard';
import { StudentAssessmentsPage } from './pages/student/StudentAssessmentsPage';
import { StudentResultsPage } from './pages/student/StudentResultsPage';
import { AttemptPage } from './pages/student/AttemptPage';
import { CatalogPage } from './pages/student/CatalogPage';
import { MyCoursesPage } from './pages/student/MyCoursesPage';
import { StudentCourseViewPage } from './pages/student/StudentCourseViewPage';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/health" element={<Health />} />

            {/* Protected routes with layout */}
            <Route
              element={
                <ProtectedRoute>
                  <Layout />
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
                    <AttemptPage />
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
                    <StudentCourseViewPage />
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
    </BrowserRouter>
  );
}

export default App;
