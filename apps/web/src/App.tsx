import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { RoleRoute } from './components/RoleRoute';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import Health from './pages/Health';

// Teacher pages
import { TeacherDashboard } from './pages/teacher/TeacherDashboard';
import { CoursesPage } from './pages/teacher/CoursesPage';
import { QuestionsPage } from './pages/teacher/QuestionsPage';
import { AssessmentsPage } from './pages/teacher/AssessmentsPage';
import { ReviewPage } from './pages/teacher/ReviewPage';

// Student pages
import { StudentDashboard } from './pages/student/StudentDashboard';
import { StudentAssessmentsPage } from './pages/student/StudentAssessmentsPage';
import { StudentResultsPage } from './pages/student/StudentResultsPage';
import { AttemptPage } from './pages/student/AttemptPage';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
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
          </Route>

          {/* Redirect root to appropriate dashboard */}
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
